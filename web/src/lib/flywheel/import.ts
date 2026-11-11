// Flywheel F8: Sheets tracker → fw_pages / fw_citations mapping. Pure: no
// server imports, so it runs in vitest on header fixtures and in the client
// preview. The server (importServer.ts) reads the sheet / CSV, calls
// planImport() with the program's clusters, pages and channels, then writes
// pages and citations keyed on import_ref and the review list for anything
// it could not place. Nothing is guessed: an unknown header is reported,
// a row with no recognisable channel or on-site page goes to review.

import type { CitationStatus, PageStatus } from './shared';

// ---------------------------------------------------------------- fields

export const IMPORT_FIELDS = ['asset_type', 'title', 'url', 'keyword', 'cluster', 'page', 'status', 'posted_on', 'poster', 'notes'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
	asset_type: 'Asset type / channel',
	title: 'Title',
	url: 'Live URL',
	keyword: 'Keyword',
	cluster: 'Cluster',
	page: 'Page (number, keyword or URL)',
	status: 'Status',
	posted_on: 'Date published',
	poster: 'Posted by / account',
	notes: 'Notes',
};

/** Header aliases per field, lower-cased and whitespace-folded. First field whose alias matches wins. */
const ALIASES: Record<ImportField, string[]> = {
	asset_type: ['asset type', 'asset', 'type', 'channel', 'platform', 'content type', 'asset kind', 'kind', 'format', 'where'],
	title: ['title', 'asset title', 'headline', 'name', 'post title', 'article title', 'piece'],
	url: ['url', 'live url', 'link', 'live link', 'published url', 'asset url', 'post url', 'citation url', 'page url', 'permalink'],
	keyword: ['keyword', 'target keyword', 'anchor keyword', 'primary keyword', 'kw', 'keyword phrase', 'verbatim keyword'],
	cluster: ['cluster', 'cluster #', 'cluster number', 'cluster no', 'cluster id'],
	page: ['page', 'page #', 'page number', 'page no', 'target page', 'on-site page', 'onsite page', 'source page', 'parent page', 'page keyword', 'linked page'],
	// "Published" on its own holds a date in every real tracker (MINT / FCU
	// Page Inventory, the XX inventory template's Articles tab); only the
	// question form "Published?" is a yes / no status column.
	status: ['status', 'state', 'published?', 'live?', 'is live', 'progress'],
	posted_on: ['date', 'published', 'date published', 'published date', 'publish date', 'date posted', 'posted', 'posted on', 'live date', 'go live date', 'published on', 'date live'],
	poster: ['posted by', 'poster', 'account', 'handle', 'author', 'profile', 'posted from', 'owner', 'who'],
	notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'details'],
};

export const norm = (s: string) => s.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface HeaderMapping {
	/** field → 0-based column index. Only fields found in the header. */
	mapping: Partial<Record<ImportField, number>>;
	/** Headers (as written) that matched no alias. Reported, never guessed. */
	unknown: string[];
	/** Fields the importer needs and did not find. */
	missing: ImportField[];
}

/**
 * Match a header row to fields by alias. Exact alias match first; a header
 * that CONTAINS an alias (e.g. "Live URL (Medium)") is taken only when no
 * exact match exists for that field and the alias is 3+ characters.
 */
export function mapHeaders(headers: string[]): HeaderMapping {
	const mapping: Partial<Record<ImportField, number>> = {};
	const used = new Set<number>();
	const normed = headers.map((h) => norm(h ?? ''));
	for (const field of IMPORT_FIELDS) {
		let hit = -1;
		for (const alias of ALIASES[field]) {
			const i = normed.findIndex((h, idx) => !used.has(idx) && h === alias);
			if (i >= 0) {
				hit = i;
				break;
			}
		}
		if (hit < 0) {
			for (const alias of ALIASES[field]) {
				if (alias.length < 3) continue;
				const i = normed.findIndex((h, idx) => !used.has(idx) && h.length > 0 && (h.startsWith(alias + ' ') || h.endsWith(' ' + alias) || h.startsWith(alias + ' (') || h.includes(' ' + alias + ' ')));
				if (i >= 0) {
					hit = i;
					break;
				}
			}
		}
		if (hit >= 0) {
			mapping[field] = hit;
			used.add(hit);
		}
	}
	const unknown = headers.filter((h, i) => !used.has(i) && norm(h ?? '').length > 0);
	const missing: ImportField[] = [];
	// A row can be placed from a URL alone (channel from the host), or from
	// an asset type; without either there is nothing to classify on.
	if (mapping.url == null && mapping.asset_type == null) missing.push('url');
	return { mapping, unknown, missing };
}

// ---------------------------------------------------------------- channel + page detection

export type ChannelKey = 'medium' | 'linkedin' | 'quora_space' | 'quora_answer' | 'reddit' | 'shorts' | 'faq_schema' | 'podcast';
export const ON_SITE = 'on_site' as const;
export type Placement = ChannelKey | typeof ON_SITE;

const CHANNEL_WORDS: [RegExp, ChannelKey][] = [
	[/\bmedium\b/, 'medium'],
	[/\blinked ?in\b/, 'linkedin'],
	[/\bquora\b.*\b(space|blog|post)\b|\b(space|blog)\b.*\bquora\b/, 'quora_space'],
	[/\bquora\b/, 'quora_answer'],
	[/\breddit\b/, 'reddit'],
	[/\b(shorts?|reels?|tiktok|youtube short|yt short|vertical video)\b/, 'shorts'],
	[/\bfaq\b|\bschema\b|\bsyndicat/, 'faq_schema'],
	[/\bpodcast\b|\bepisode\b|\bspotify\b|\bapple podcasts?\b/, 'podcast'],
];

const ON_SITE_WORDS = /\b(on[- ]?site|website|web page|webpage|site page|blog post|blog|article|pillar|question page|aeo page|landing page|page)\b/;

/**
 * the org's publisher network: the WordPress sites that carry the "FAQ-schema
 * syndication" citations (channel faq_schema, poster_default 'network').
 * Taken from the live trackers, not guessed: MINT's and FCU's Page
 * Inventory list these domains as their Prong 2 assets, each with FAQPage
 * schema + an entity anchor (FCU's Drive deliverables are named
 * Pillar_04-06 "WordPress FAQ"). A host not on this list and not on the
 * program's domain still goes to the review list. Add a domain here when
 * the network grows.
 */
export const NETWORK_FAQ_HOSTS = ['authoritymaximizer.com', 'bookedimpact.com', 'livelovehobby.com', 'newyorkpostdaily.com', 'thelanote.com', 'thoughtleadersethos.com', 'trendingconsumerism.com'] as const;

export function hostOf(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const u = new URL(url.trim().match(/^https?:\/\//i) ? url.trim() : `https://${url.trim()}`);
		return u.hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return null;
	}
}

export function channelFromUrl(url: string | null | undefined): ChannelKey | null {
	const host = hostOf(url);
	if (!host) return null;
	const path = (() => {
		try {
			return new URL(url!.trim().match(/^https?:\/\//i) ? url!.trim() : `https://${url!.trim()}`).pathname.toLowerCase();
		} catch {
			return '';
		}
	})();
	if (host === 'medium.com' || host.endsWith('.medium.com')) return 'medium';
	if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
	if (host === 'quora.com' || host.endsWith('.quora.com')) {
		// <space>.quora.com is a Space; a two-letter subdomain is a language site (pt.quora.com), same as quora.com.
		const isLangSite = host === 'quora.com' || /^[a-z]{2}\.quora\.com$/.test(host);
		return path.startsWith('/q/') || !isLangSite ? 'quora_space' : 'quora_answer';
	}
	if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'reddit';
	if ((host === 'youtube.com' || host.endsWith('.youtube.com')) && path.startsWith('/shorts/')) return 'shorts';
	if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return null; // long-form video: not a citation channel, leave to asset type
	if (host === 'instagram.com' && (path.startsWith('/reel') || path.startsWith('/reels'))) return 'shorts';
	if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'shorts';
	if (host.endsWith('spotify.com') || host === 'podcasts.apple.com' || host.endsWith('buzzsprout.com') || host.endsWith('anchor.fm') || host.endsWith('podbean.com') || host.endsWith('transistor.fm')) return 'podcast';
	if ((NETWORK_FAQ_HOSTS as readonly string[]).some((h) => host === h || host.endsWith('.' + h))) return 'faq_schema';
	return null;
}

export function channelFromText(text: string | null | undefined): ChannelKey | null {
	if (!text) return null;
	const t = norm(text);
	for (const [re, key] of CHANNEL_WORDS) if (re.test(t)) return key;
	return null;
}

/**
 * Where a row belongs. Asset type wins when it names a channel; the URL
 * host decides otherwise; a URL on the program's own domain, or an asset
 * type that says page / blog / article, is an on-site page.
 */
export function classifyPlacement(assetType: string | null | undefined, url: string | null | undefined, primaryHost: string | null): Placement | null {
	const fromText = channelFromText(assetType);
	if (fromText) return fromText;
	const fromUrl = channelFromUrl(url);
	if (fromUrl) return fromUrl;
	const host = hostOf(url);
	if (host && primaryHost && (host === primaryHost || host.endsWith('.' + primaryHost))) return ON_SITE;
	if (assetType && ON_SITE_WORDS.test(norm(assetType))) return ON_SITE;
	return null;
}

// ---------------------------------------------------------------- cells

export function parseClusterNumber(cell: string | null | undefined): number | null {
	if (!cell) return null;
	const t = norm(cell);
	// Only a bare number or one introduced by "cluster" / "c" / "#": a label
	// like "2-Inch / Long Barrel" names a topic, not cluster 2.
	const m = t.match(/^(?:cluster|c)?\s*#?\s*(\d{1,2})$/) ?? t.match(/^cluster\s*#?\s*(\d{1,2})\b/);
	if (!m) return null;
	const n = Number(m[1]);
	return n >= 1 && n <= 99 ? n : null;
}

export function parsePageNumber(cell: string | null | undefined): number | null {
	if (!cell) return null;
	const t = norm(cell);
	if (/^(p|pg|page)?\s*#?\s*\d{1,2}$/.test(t)) {
		const n = Number(t.replace(/\D/g, ''));
		return n >= 1 && n <= 20 ? n : null;
	}
	return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** ISO date from an ISO string, M/D/YYYY, "Sep 12, 2026", "12 Sep 2026" or a Sheets serial. Null when unreadable. */
export function parseDate(cell: string | number | null | undefined): string | null {
	if (cell == null || cell === '') return null;
	if (typeof cell === 'number') {
		if (cell < 20000 || cell > 80000) return null; // Sheets serial days since 1899-12-30
		const d = new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86400000);
		return d.toISOString().slice(0, 10);
	}
	const s = cell.trim();
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
	m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
	if (m) {
		const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
		return iso(y, Number(m[1]), Number(m[2]));
	}
	m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
	if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
	m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
	if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
	if (/^\d{5}$/.test(s)) return parseDate(Number(s));
	return null;
}

function iso(y: number, mo: number, d: number): string | null {
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
	const dt = new Date(Date.UTC(y, mo - 1, d));
	if (dt.getUTCMonth() !== mo - 1) return null;
	return dt.toISOString().slice(0, 10);
}

export function pageStatusFrom(statusCell: string | null | undefined, hasUrl: boolean): PageStatus {
	const t = norm(statusCell ?? '');
	if (/\b(live|published|public|done|complete|posted|up)\b/.test(t)) return 'live';
	if (hasUrl && !/\b(draft|review|planned|pending|wip|in progress|scheduled)\b/.test(t)) return 'live';
	if (/\bhanded? ?off\b|\bsent to (dev|client|developer)\b|\bwith (dev|client)\b/.test(t)) return 'handed_off';
	if (/\bapproved?\b/.test(t)) return 'approved';
	if (/\bchanges?\b|\brevis/.test(t)) return 'changes_requested';
	if (/\bawaiting\b|\bwith client\b|\bclient review\b/.test(t)) return 'awaiting_client';
	if (/\bverif/.test(t)) return 'verification';
	if (/\breview\b/.test(t)) return 'in_review';
	if (/\bdraft|\bwriting|\bin progress|\bwip\b/.test(t)) return 'drafting';
	return 'planned';
}

export function citationStatusFrom(statusCell: string | null | undefined, hasUrl: boolean): CitationStatus {
	const t = norm(statusCell ?? '');
	if (/\b(verified|live|indexed|confirmed)\b/.test(t)) return 'live';
	if (/\b(removed|deleted|taken down|banned)\b/.test(t)) return 'removed';
	if (/\b(rejected|declined|failed)\b/.test(t)) return 'rejected';
	if (hasUrl) return 'posted';
	if (/\b(posted|published|done|complete)\b/.test(t)) return 'posted';
	if (/\bqueued?\b|\bscheduled\b/.test(t)) return 'queued';
	if (/\bapproved?\b/.test(t)) return 'approved';
	if (/\bverif/.test(t)) return 'verification';
	if (/\breview\b/.test(t)) return 'in_review';
	if (/\bdraft|\bwriting|\bin progress|\bwip\b/.test(t)) return 'drafting';
	return 'planned';
}

export function importRef(spreadsheetId: string, tab: string, rowNumber: number): string {
	return `${spreadsheetId}!${tab}!${rowNumber}`;
}

// ---------------------------------------------------------------- plan

export interface PlanContext {
	programId: string;
	primaryUrl: string | null;
	channels: { key: string; label: string; poster_default?: string | null }[];
	clusters: { id: string; number: number; anchor_keyword: string | null; status: string }[];
	pages: { id: string; cluster_id: string; number: number; keyword: string; live_url: string | null; import_ref: string | null }[];
	/** Existing citations by lower-cased URL, to report ledger collisions with rows that are not this import_ref. */
	citationsByUrl?: Map<string, { id: string; import_ref: string | null }>;
}

export interface PlannedPage {
	import_ref: string;
	row_number: number;
	cluster_id: string;
	number: number;
	keyword: string;
	title: string | null;
	status: PageStatus;
	live_url: string | null;
	live_at: string | null;
	notes_md: string | null;
	/** Set when an existing fw_pages row (by import_ref) will be updated instead of inserted. */
	existing_id: string | null;
}

export interface PlannedCitation {
	import_ref: string;
	row_number: number;
	channel_key: ChannelKey;
	cluster_id: string | null;
	page_id: string | null;
	/** When the page is one of the pages planned in this same run (not yet in the DB), its import_ref. */
	page_import_ref: string | null;
	status: CitationStatus;
	title: string | null;
	url: string | null;
	posted_on: string | null;
	keyword: string | null;
	poster_handle: string | null;
	/** The channel's poster_default (faq_schema → 'network', podcast → 'fourth_pillar'); 'person' otherwise. */
	poster_kind: PosterKind;
	notes_md: string | null;
}

export type PosterKind = 'person' | 'network' | 'fourth_pillar';

export interface ReviewRow {
	import_ref: string;
	row_number: number;
	raw: Record<string, string>;
	reason: string;
}

export interface ImportPlan {
	header: HeaderMapping;
	pages: PlannedPage[];
	citations: PlannedCitation[];
	review: ReviewRow[];
	/** Rows that were entirely blank (ignored, not reviewed). */
	blank: number;
}

export interface PlanInput {
	spreadsheetId: string;
	tab: string;
	headers: string[];
	/** Data rows, row i is sheet row i + 2 (header is row 1). */
	rows: (string | number | null)[][];
	ctx: PlanContext;
}

const cell = (row: (string | number | null)[], idx: number | undefined): string | null => {
	if (idx == null) return null;
	const v = row[idx];
	if (v == null) return null;
	const s = String(v).trim();
	return s.length ? s : null;
};

/**
 * Classify every row. Deterministic; the same input always yields the same
 * plan, and import_ref makes the write idempotent.
 */
export function planImport(input: PlanInput): ImportPlan {
	const header = mapHeaders(input.headers);
	const m = header.mapping;
	const ctx = input.ctx;
	const primaryHost = hostOf(ctx.primaryUrl);
	const channelKeys = new Set(ctx.channels.map((c) => c.key));
	const pages: PlannedPage[] = [];
	const citations: PlannedCitation[] = [];
	const review: ReviewRow[] = [];
	let blank = 0;

	// Page numbers already taken per cluster (DB + this run) so new pages get the next free slot.
	const taken = new Map<string, Set<number>>();
	for (const p of ctx.pages) {
		if (!taken.has(p.cluster_id)) taken.set(p.cluster_id, new Set());
		taken.get(p.cluster_id)!.add(p.number);
	}
	const byRef = new Map(ctx.pages.filter((p) => p.import_ref).map((p) => [p.import_ref!, p]));
	const plannedPagesByRef = new Map<string, PlannedPage>();
	const sortedClusters = [...ctx.clusters].sort((a, b) => a.number - b.number);
	const openClusters = sortedClusters.filter((c) => c.status !== 'closed');

	const resolveCluster = (clusterCell: string | null): { cluster: PlanContext['clusters'][number] | null; reason: string | null } => {
		const n = parseClusterNumber(clusterCell);
		if (n != null) {
			const c = sortedClusters.find((x) => x.number === n);
			return c ? { cluster: c, reason: null } : { cluster: null, reason: `cluster ${n} does not exist on this program` };
		}
		if (clusterCell) {
			const t = norm(clusterCell);
			const c = sortedClusters.find((x) => x.anchor_keyword && norm(x.anchor_keyword) === t);
			if (c) return { cluster: c, reason: null };
			return { cluster: null, reason: `cluster "${clusterCell}" matches no cluster number or anchor keyword` };
		}
		if (openClusters.length === 1) return { cluster: openClusters[0], reason: null };
		if (sortedClusters.length === 1) return { cluster: sortedClusters[0], reason: null };
		if (sortedClusters.length === 0) return { cluster: null, reason: 'program has no cluster yet (scaffold cluster 1 first)' };
		return { cluster: null, reason: 'no cluster column and the program has several clusters' };
	};

	const findPage = (pageCell: string | null, keyword: string | null, url: string | null, cluster: PlanContext['clusters'][number] | null) => {
		const inCluster = (p: { cluster_id: string }) => !cluster || p.cluster_id === cluster.id;
		const n = parsePageNumber(pageCell);
		if (n != null && cluster) {
			const hit = ctx.pages.find((p) => p.cluster_id === cluster.id && p.number === n);
			if (hit) return { id: hit.id, cluster_id: hit.cluster_id, ref: null as string | null };
			const planned = pages.find((p) => p.cluster_id === cluster.id && p.number === n);
			if (planned) return { id: null, cluster_id: planned.cluster_id, ref: planned.import_ref };
		}
		const cands = [pageCell, keyword].filter(Boolean) as string[];
		for (const c of cands) {
			const t = norm(c);
			const host = hostOf(c);
			const hit = ctx.pages.find((p) => inCluster(p) && (norm(p.keyword) === t || (host && p.live_url && norm(p.live_url) === norm(c))));
			if (hit) return { id: hit.id, cluster_id: hit.cluster_id, ref: null };
			const planned = pages.find((p) => inCluster(p) && (norm(p.keyword) === t || (p.live_url && norm(p.live_url) === norm(c))));
			if (planned) return { id: null, cluster_id: planned.cluster_id, ref: planned.import_ref };
		}
		void url;
		return null;
	};

	input.rows.forEach((row, i) => {
		const rowNumber = i + 2;
		if (row.every((v) => v == null || String(v).trim() === '')) {
			blank += 1;
			return;
		}
		if (isTotalsRow(row, m.url)) {
			// "TOTAL" / "Total" footer under the inventory (MINT Page Inventory row 15): not an asset.
			blank += 1;
			return;
		}
		const ref = importRef(input.spreadsheetId, input.tab, rowNumber);
		const raw: Record<string, string> = {};
		input.headers.forEach((h, idx) => {
			const v = row[idx];
			if (v != null && String(v).trim() !== '') raw[h || `col${idx + 1}`] = String(v);
		});
		const assetType = cell(row, m.asset_type);
		const url = cell(row, m.url);
		const title = cell(row, m.title);
		const keyword = cell(row, m.keyword);
		const clusterCell = cell(row, m.cluster);
		const pageCell = cell(row, m.page);
		const statusCell = cell(row, m.status);
		const dateRaw = m.posted_on == null ? null : row[m.posted_on];
		const poster = cell(row, m.poster);
		const notes = cell(row, m.notes);
		const cleanUrl = url && /^(https?:\/\/|www\.)/i.test(url) ? (url.startsWith('www.') ? `https://${url}` : url) : url && hostOf(url) && url.includes('.') && !url.includes(' ') ? `https://${url}` : null;

		const placement = classifyPlacement(assetType, cleanUrl, primaryHost);
		if (!placement) {
			review.push({ import_ref: ref, row_number: rowNumber, raw, reason: assetType || cleanUrl ? `no channel or on-site page recognised (asset type "${assetType ?? ''}", url host "${hostOf(cleanUrl) ?? ''}")` : 'no asset type and no URL on the row' });
			return;
		}

		if (placement === ON_SITE) {
			const { cluster, reason } = resolveCluster(clusterCell);
			if (!cluster) {
				review.push({ import_ref: ref, row_number: rowNumber, raw, reason: `on-site page: ${reason}` });
				return;
			}
			const kw = keyword ?? title;
			if (!kw) {
				review.push({ import_ref: ref, row_number: rowNumber, raw, reason: 'on-site page with no keyword and no title' });
				return;
			}
			const existing = byRef.get(ref) ?? null;
			let number = existing?.number ?? parsePageNumber(pageCell);
			const set = taken.get(cluster.id) ?? new Set<number>();
			taken.set(cluster.id, set);
			if (number != null && !existing && set.has(number)) {
				// the slot is held by a page from another source; keep the sheet's row but fall to the next free number
				number = null;
			}
			if (number == null) {
				for (let n = 1; n <= 20; n++) if (!set.has(n)) { number = n; break; }
			}
			if (number == null) {
				review.push({ import_ref: ref, row_number: rowNumber, raw, reason: `cluster ${cluster.number} already has 20 pages` });
				return;
			}
			set.add(number);
			const status = pageStatusFrom(statusCell, Boolean(cleanUrl));
			const posted = parseDate(dateRaw as string | number | null);
			const planned: PlannedPage = {
				import_ref: ref,
				row_number: rowNumber,
				cluster_id: cluster.id,
				number,
				keyword: kw,
				title: title && title !== kw ? title : null,
				status,
				live_url: cleanUrl,
				live_at: status === 'live' && posted ? `${posted}T12:00:00Z` : null,
				notes_md: notes,
				existing_id: existing?.id ?? null,
			};
			pages.push(planned);
			plannedPagesByRef.set(ref, planned);
			return;
		}

		// citation
		if (!channelKeys.has(placement)) {
			review.push({ import_ref: ref, row_number: rowNumber, raw, reason: `channel "${placement}" is not in the program's channel template` });
			return;
		}
		const { cluster } = resolveCluster(clusterCell);
		const page = findPage(pageCell, keyword, cleanUrl, cluster);
		if (cleanUrl && ctx.citationsByUrl) {
			const dup = ctx.citationsByUrl.get(cleanUrl.toLowerCase());
			if (dup && dup.import_ref !== ref) {
				review.push({ import_ref: ref, row_number: rowNumber, raw, reason: `URL is already on the ledger (${dup.import_ref ? `imported from ${dup.import_ref}` : 'entered in the app'})` });
				return;
			}
		}
		const resolvedCluster = page?.cluster_id ?? cluster?.id ?? null;
		// A cluster the program does not have yet (MINT's "Ceramic Curling Iron")
		// is kept on the citation's notes so re-linking later loses nothing.
		const notesMd = !resolvedCluster && clusterCell ? [`Sheet cluster: ${clusterCell}`, notes].filter(Boolean).join('\n\n') : notes;
		const posterDefault = ctx.channels.find((c) => c.key === placement)?.poster_default;
		citations.push({
			import_ref: ref,
			row_number: rowNumber,
			channel_key: placement,
			cluster_id: resolvedCluster,
			page_id: page?.id ?? null,
			page_import_ref: page?.ref ?? null,
			status: citationStatusFrom(statusCell, Boolean(cleanUrl)),
			// No title column (MINT / FCU Page Inventory): the unplaced cluster
			// label is the only human name the row has, so it labels the ledger row.
			title: title ?? (!resolvedCluster && clusterCell ? clusterCell : null),
			url: cleanUrl,
			posted_on: parseDate(dateRaw as string | number | null),
			keyword,
			poster_handle: poster,
			poster_kind: posterDefault === 'network' || posterDefault === 'fourth_pillar' ? posterDefault : 'person',
			notes_md: notesMd,
		});
	});

	return { header, pages, citations, review, blank };
}

/** A footer row: its first non-empty cell says total / sum and there is no URL on it. */
export function isTotalsRow(row: (string | number | null)[], urlIdx: number | undefined): boolean {
	const first = row.find((v) => v != null && String(v).trim() !== '');
	if (first == null || !/^(grand\s+)?(sub)?totals?:?$|^sum:?$/i.test(String(first).trim())) return false;
	const url = urlIdx == null ? null : row[urlIdx];
	return url == null || String(url).trim() === '';
}

/** Pull the Google spreadsheet id out of a pasted URL or return the id as given. */
export function spreadsheetIdFrom(input: string): string | null {
	const s = input.trim();
	const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
	if (m) return m[1];
	return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

/**
 * A whole tab (row 1 first) → header + data rows. The header is the first
 * row with 2+ non-empty cells; title / note rows above it are kept as blank
 * padding so planImport's row numbers (and import_ref) stay the sheet's own.
 */
export function gridToRows(grid: (string | number | null)[][]): { headers: string[]; rows: (string | number | null)[][] } {
	let headerIdx = grid.findIndex((r) => r.filter((c) => c != null && String(c).trim() !== '').length >= 2);
	if (headerIdx < 0) headerIdx = 0;
	const headers = (grid[headerIdx] ?? []).map((c) => (c == null ? '' : String(c).trim()));
	const width = headers.length;
	const rows = grid.slice(headerIdx + 1).map((r) => {
		const out = r.slice(0, width);
		while (out.length < width) out.push(null);
		return out;
	});
	const pad: (string | number | null)[][] = Array.from({ length: headerIdx }, () => Array<string | number | null>(width).fill(null));
	return { headers, rows: [...pad, ...rows] };
}

export function summarizePlan(plan: ImportPlan): string {
	const parts = [`${plan.pages.length} page${plan.pages.length === 1 ? '' : 's'}`, `${plan.citations.length} citation${plan.citations.length === 1 ? '' : 's'}`, `${plan.review.length} to review`];
	if (plan.blank) parts.push(`${plan.blank} blank`);
	if (plan.header.unknown.length) parts.push(`${plan.header.unknown.length} unknown header${plan.header.unknown.length === 1 ? '' : 's'}`);
	return parts.join(' · ');
}

/** What the preview panel renders; built by the server action from a plan (serialisable, no ids beyond cluster). */
export interface PreviewPayload {
	summary: string;
	headers: string[];
	mapping: Record<string, number>;
	unknown: string[];
	missing: string[];
	pages: { row: number; cluster_id: string; number: number; keyword: string; status: string; url: string | null; update: boolean }[];
	citations: { row: number; channel: string; status: string; url: string | null; keyword: string | null; page_known: boolean }[];
	review: { row: number; reason: string }[];
	blank: number;
	source: { kind: 'sheets' | 'csv'; title: string };
}

export interface ApplyCounts {
	rows: number;
	pages_inserted: number;
	pages_updated: number;
	citations_inserted: number;
	citations_updated: number;
	review: number;
	blank: number;
}

export interface ImportBatchRow {
	id: string;
	program_id: string;
	source_kind: 'sheets' | 'csv';
	spreadsheet_id: string | null;
	tab: string | null;
	file_name: string | null;
	header: string[];
	unknown_headers: string[];
	mode: 'preview' | 'apply';
	counts: Partial<ApplyCounts> & { pages?: number; citations?: number; error?: string };
	created_by: string | null;
	created_at: string;
}

export interface ImportReviewRow {
	id: string;
	program_id: string;
	batch_id: string | null;
	import_ref: string;
	row_number: number;
	raw: Record<string, string>;
	reason: string;
	status: 'unmatched' | 'resolved' | 'ignored';
	resolved_kind: 'page' | 'citation' | null;
	resolved_id: string | null;
	created_at: string;
	updated_at: string;
}
