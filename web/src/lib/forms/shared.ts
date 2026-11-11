// Public forms vocabulary (0158). No server imports: the hosted page, the
// embed, the builder's "share" panel and the email all read from here.

import type { FormField, FormValues } from './logic';

/**
 * Inbox triage. The generic ladder is new -> reviewed -> accepted / declined;
 * `pass` (not a fit) and `booked` (on the calendar) are Alex's OverPressure
 * guest vocabulary and apply to any request form.
 */
export const SUBMISSION_STATUSES = ['new', 'reviewed', 'booked', 'accepted', 'pass', 'declined'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const STATUS_LABELS: Record<SubmissionStatus, string> = { new: 'New', reviewed: 'Reviewed', booked: 'Booked', accepted: 'Accepted', pass: 'Pass', declined: 'Declined' };

/** utm_* keys the public door keeps from the page the form sat on. */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** The honeypot key: a hidden input bots fill. Real browsers never send it. */
export const HONEYPOT_KEY = 'company_url';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** What the public door (GET /api/f/<slug>) returns and the renderer consumes. */
export interface PublicFormDef {
	slug: string;
	title: string;
	description: string | null;
	fields: FormField[];
	/** page number per field key (multi-page forms; default 1). */
	pages: Record<string, number>;
	submit_label: string;
	brand_label: string;
	success_message: string | null;
	redirect_url: string | null;
	/** Optional button on the thank-you screen (lead magnets). */
	success_cta_label: string | null;
	success_cta_url: string | null;
	/** Cloudflare Turnstile site key when the env is set; null = no widget. */
	turnstile_site_key: string | null;
}

export interface UploadedFile {
	key: string;
	path: string;
	name: string;
	size: number;
	type: string;
}

export interface SubmitResult {
	ok: true;
	submission_id: string;
	success_message: string | null;
	redirect_url: string | null;
	success_cta_label?: string | null;
	success_cta_url?: string | null;
	/** Set when the form also feeds the Revenue Engine (rev_form_links). */
	routing?: string | null;
}

export function appUrl(): string {
	return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com').replace(/\/$/, '');
}

function trimBase(base: string): string {
	return base.replace(/\/+$/, '');
}

export function hostedUrl(slug: string, base = appUrl()): string {
	return `${trimBase(base)}/f/${slug}`;
}

export function embedUrl(slug: string, base = appUrl()): string {
	return `${trimBase(base)}/f/${slug}/embed`;
}

/**
 * The iframe snippet for an outside site. The script (/f/embed.js) listens
 * for `or-form:height` messages from the frame and sets the iframe height,
 * so the embed never scrolls inside itself.
 */
export function embedSnippet(slug: string, base = appUrl()): string {
	return [
		`<iframe src="${embedUrl(slug, base)}" data-or-form="${slug}" title="${slug}" style="width:100%;border:0;min-height:480px" loading="lazy" allow="clipboard-write"></iframe>`,
		`<script src="${trimBase(base)}/f/embed.js" async></script>`,
	].join('\n');
}

/** Pull utm_* out of a URL (the page the embed sat on). */
export function utmFromUrl(url: string | null | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!url) return out;
	try {
		const u = new URL(url);
		for (const k of UTM_KEYS) {
			const v = u.searchParams.get(k);
			if (v) out[k] = v.slice(0, 200);
		}
	} catch {
		/* not a URL */
	}
	return out;
}

/** One answer as display text (inbox cells, CSV, email). */
export function answerText(field: FormField | undefined, v: FormValues[string], files?: UploadedFile[]): string {
	if (v === undefined || v === null || v === '') return '';
	if (field?.type === 'file' && files) {
		const f = files.find((x) => x.key === field.key);
		return f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : String(v);
	}
	if (Array.isArray(v)) return v.join(', ');
	if (typeof v === 'boolean') return v ? 'Yes' : 'No';
	return String(v);
}

export function csvEscape(s: string): string {
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV for an inbox export: fixed columns, then one per field. */
export function submissionsCsv(
	fields: FormField[],
	rows: { id: string; created_at: string; status: string; source_url: string | null; utm: Record<string, string>; data: FormValues; files: UploadedFile[] }[],
): string {
	const head = ['id', 'submitted_at', 'status', 'source_url', ...UTM_KEYS, ...fields.map((f) => f.label)];
	const lines = [head.map(csvEscape).join(',')];
	for (const r of rows) {
		const cells = [r.id, r.created_at, r.status, r.source_url ?? '', ...UTM_KEYS.map((k) => r.utm?.[k] ?? ''), ...fields.map((f) => answerText(f, r.data?.[f.key], r.files))];
		lines.push(cells.map(csvEscape).join(','));
	}
	return lines.join('\r\n');
}
