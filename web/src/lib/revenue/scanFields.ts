// Scan AI (Prospects) — the pure half: which fields a scan may fill, how a
// page becomes text, how the AI's answer is validated, and the diff the rep
// reviews before anything is written. No I/O here, so all of it is tested.
//
// Rules the scan never breaks:
//   * Only whitelisted fields, only strings, trimmed and capped.
//   * Email and phone are kept only when they appear literally in the source
//     text: the model may find them, never invent them.
//   * A found value equal to the current one is not shown.

export type ScanTarget = 'person' | 'brand';
export type ScanSource = 'website' | 'linkedin';

export const PERSON_SCAN_FIELDS = {
	title: 'Title',
	location: 'Location',
	email: 'Email',
	phone: 'Phone',
	linkedin_url: 'LinkedIn',
	website: 'Website',
	instagram: 'Instagram',
	facebook: 'Facebook',
	tiktok: 'TikTok',
	x_handle: 'X',
} as const;

export const BRAND_SCAN_FIELDS = {
	website: 'Website',
	industry: 'Industry',
	vertical: 'Vertical',
	description: 'Description',
	'socials.instagram': 'Instagram',
	'socials.facebook': 'Facebook',
	'socials.tiktok': 'TikTok',
	'socials.x': 'X',
	'socials.linkedin': 'LinkedIn',
	'socials.youtube': 'YouTube',
} as const;

export type PersonScanKey = keyof typeof PERSON_SCAN_FIELDS;
export type BrandScanKey = keyof typeof BRAND_SCAN_FIELDS;

export function scanFieldLabels(target: ScanTarget): Record<string, string> {
	return target === 'person' ? PERSON_SCAN_FIELDS : BRAND_SCAN_FIELDS;
}

export interface ScanField {
	key: string;
	label: string;
	current: string | null;
	found: string;
	source: ScanSource;
}

const MAX_VALUE = 600;

/** Visible text of an HTML page: scripts, styles and tags out, entities decoded, whitespace collapsed. */
export function htmlToText(html: string, max = 12_000): string {
	return html
		.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.trim()
		.slice(0, max);
}

const SUBPAGE = /(about|team|leadership|founder|people|staff|contact|our-story|who-we-are)/i;

/** Up to `limit` same-site About / Team / Contact pages linked from the homepage. */
export function pickSubpages(html: string, baseUrl: string, limit = 2): string[] {
	let base: URL;
	try {
		base = new URL(baseUrl);
	} catch {
		return [];
	}
	const host = base.hostname.replace(/^www\./, '');
	const out: string[] = [];
	for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
		let u: URL;
		try {
			u = new URL(m[1], base);
		} catch {
			continue;
		}
		if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
		if (!SUBPAGE.test(u.pathname)) continue;
		u.hash = '';
		const href = u.toString();
		if (href !== base.toString() && !out.includes(href)) out.push(href);
		if (out.length >= limit) break;
	}
	return out;
}

/** True for URLs the server may fetch: http(s) to a public-looking host (no localhost / private ranges). */
export function isFetchableUrl(raw: string): boolean {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	if (!/^https?:$/.test(u.protocol)) return false;
	const h = u.hostname.toLowerCase();
	if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
	if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
		const [a, b] = h.split('.').map(Number);
		if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
	}
	if (h.startsWith('[')) return false; // IPv6 literals
	return true;
}

/** The first JSON object in a model's answer (it may wrap it in prose or a code fence). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const v = JSON.parse(text.slice(start, end + 1));
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Email / phone survive only if the source text contains them. */
export function literalInSource(key: string, value: string, sourceText: string): boolean {
	if (key === 'email') return sourceText.toLowerCase().includes(value.toLowerCase());
	if (key === 'phone') {
		// Compare the national number: "+1 (615) 555-0100" matches "615.555.0100" on the page.
		const d = digits(value);
		const core = d.length > 10 ? d.slice(-10) : d;
		return core.length >= 7 && digits(sourceText).includes(core);
	}
	return true;
}

/**
 * The model's JSON reduced to allowed, non-empty string fields. Nested
 * `socials: { instagram }` is flattened to `socials.instagram` for brands.
 * Email / phone are dropped unless literally present in `sourceText`.
 */
export function cleanFound(target: ScanTarget, raw: Record<string, unknown> | null, sourceText: string): Record<string, string> {
	if (!raw) return {};
	const allowed = scanFieldLabels(target);
	const flat: Record<string, unknown> = { ...raw };
	if (target === 'brand' && raw.socials && typeof raw.socials === 'object' && !Array.isArray(raw.socials)) {
		for (const [k, v] of Object.entries(raw.socials as Record<string, unknown>)) flat[`socials.${k}`] = v;
	}
	const out: Record<string, string> = {};
	for (const key of Object.keys(allowed)) {
		const v = flat[key];
		if (typeof v !== 'string') continue;
		const s = v.trim().slice(0, MAX_VALUE);
		if (!s || /^(n\/a|none|null|unknown|not found|-)$/i.test(s)) continue;
		if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) continue;
		if (!literalInSource(key, s, sourceText)) continue;
		out[key] = s;
	}
	return out;
}

const same = (a: string | null, b: string) => (a ?? '').trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '');

/** Rows for the review table: only fields where the scan found something different. */
export function buildDiff(target: ScanTarget, current: Record<string, string | null>, found: Partial<Record<string, { value: string; source: ScanSource }>>): ScanField[] {
	const labels = scanFieldLabels(target);
	const rows: ScanField[] = [];
	for (const [key, label] of Object.entries(labels)) {
		const f = found[key];
		if (!f || same(current[key] ?? null, f.value)) continue;
		rows.push({ key, label, current: current[key] ?? null, found: f.value, source: f.source });
	}
	return rows;
}

/** Keep only the keys of `values` that a scan may write for this target. */
export function allowedValues(target: ScanTarget, values: Record<string, unknown>): Record<string, string> {
	const labels = scanFieldLabels(target);
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(values)) if (k in labels && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, MAX_VALUE);
	return out;
}
