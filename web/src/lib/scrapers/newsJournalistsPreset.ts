// Media Scraper preset: news_journalists (fetch_cat/google-news-journalist-lead-finder).
//
// Google News query per beat ("sustainable packaging") -> one row per
// article-backed media lead: journalist name, outlet, domain, public email(s)
// when a publisher exposes one, and the article as evidence. That evidence is
// what makes the review queue fast to triage: the reviewer sees WHY this
// journalist matched.
//
// Input schema and output shape read from the live Apify store on 2026-09-19
// (build 0.1.8, scripts/apify_schema_dump.py). The plan flagged this actor as
// new (5 users, 40/43 successful runs in the last 30 days), so nothing here
// is from memory. Required input: `queries` (1-20 strings). The actor bounds
// itself with maxArticlesPerQuery (1-25) and runTimeSecs (30-270), so a run
// can never cost more than queries x 25 rows.
//
// COST (pay per event, Free tier): $0.12 per run start + $0.0023 per saved row.
// Status rows (no_public_contact, article_unavailable) are charged too because
// they preserve a reviewable outcome; includeNoContact stays true because a
// journalist without a public email is still a lead (the email_waterfall
// preset exists for exactly that gap).
//
// Same queue, same cron, same staging table as the lead presets — only the
// kind ('media'), the row kind ('media_contact' / 'media_outlet') and the
// mapper differ. No worker, no Realtime.

export const NEWS_JOURNALISTS_ACTOR = 'fetch_cat/google-news-journalist-lead-finder';
export const NEWS_JOURNALISTS_PRESET = 'news_journalists' as const;
export const MEDIA_KIND = 'media' as const;

export const USD_PER_RUN_START = 0.12;
export const USD_PER_LEAD = 0.0023;

/** The actor's own ceilings (input schema). */
export const MAX_QUERIES = 20;
export const MAX_ARTICLES_PER_QUERY = 25;
export const MIN_FRESHNESS_DAYS = 1;
export const MAX_FRESHNESS_DAYS = 365;

/** What the UI collects and what we persist in scrape_jobs.params. */
export interface NewsJournalistsParams {
	/** Beats / topics, 1-20. Each becomes one Google News search. */
	queries: string[];
	/** Articles per query, 1-25 (actor default 10). */
	maxArticlesPerQuery?: number;
	/** Freshness window in days, 1-365 (actor default 7). */
	freshnessDays?: number;
	/** Two letter Google market code (US, GB, DE...). */
	country?: string;
	/** Google language code (en, es, pt...). */
	language?: string;
	/** 0-2 linked author/press/contact pages per article (actor default 1). */
	maxExtraPagesPerArticle?: number;
	/** Keep rows with no public email (default true). */
	includeNoContact?: boolean;
}

/**
 * Cost estimate for the form. The actor saves at most queries x
 * maxArticlesPerQuery rows, and the job's max_results caps what we import,
 * so the bill is bounded by the smaller of the two plus the start fee.
 */
export function estimateNewsJournalistsCostUsd(params: NewsJournalistsParams, maxResults: number): number {
	const perQuery = clampInt(params.maxArticlesPerQuery ?? 10, 1, MAX_ARTICLES_PER_QUERY);
	const rows = Math.min(maxResults, Math.max(1, params.queries.length) * perQuery);
	return Math.round((USD_PER_RUN_START + rows * USD_PER_LEAD) * 1000) / 1000;
}

function clampInt(n: number, lo: number, hi: number): number {
	if (!Number.isFinite(n)) return lo;
	return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Translate our params into the actor's input. Keys and ranges are the
 * actor's own; anything outside its schema either errors the run or is
 * ignored, and an ignored knob bills for the wrong rows.
 *
 * maxArticlesPerQuery is derived from max_results when the operator did not
 * set it, so asking for 50 rows across 2 beats asks for 25 per beat, not the
 * default 10 (which would return 20 and leave the ceiling unreached).
 */
export function buildNewsJournalistsInput(params: NewsJournalistsParams, maxResults: number): Record<string, unknown> {
	const queries = params.queries.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES);
	const perQuery =
		params.maxArticlesPerQuery !== undefined
			? clampInt(params.maxArticlesPerQuery, 1, MAX_ARTICLES_PER_QUERY)
			: clampInt(Math.ceil(maxResults / Math.max(1, queries.length)), 1, MAX_ARTICLES_PER_QUERY);
	const input: Record<string, unknown> = {
		queries,
		maxArticlesPerQuery: perQuery,
		freshnessDays: clampInt(params.freshnessDays ?? 7, MIN_FRESHNESS_DAYS, MAX_FRESHNESS_DAYS),
		enrichPublisherPages: true,
		maxExtraPagesPerArticle: clampInt(params.maxExtraPagesPerArticle ?? 1, 0, 2),
		includeNoContact: params.includeNoContact ?? true,
	};
	if (params.country?.trim()) input.country = params.country.trim().toUpperCase().slice(0, 2);
	if (params.language?.trim()) input.language = params.language.trim().toLowerCase().slice(0, 5);
	return input;
}

/** A run with no beat would bill for nothing useful; at least one query. */
export function hasNewsJournalistsTargeting(params: NewsJournalistsParams): boolean {
	return params.queries.some((q) => q.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

/** One article evidence entry, as stored in scraped_records.evidence. */
export interface ArticleEvidence {
	title: string | null;
	url: string | null;
	date: string | null;
	/** Where the email was found, when the actor tells us. */
	source_url?: string | null;
}

/** A staged media row, ready for the scraped_records upsert. */
export interface MediaRecord {
	kind: 'media_contact' | 'media_outlet';
	dedupKey: string;
	fullName: string | null;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	emailStatus: string | null;
	jobTitle: string | null;
	outletName: string | null;
	outletDomain: string | null;
	companyWebsite: string | null;
	companyLinkedin: string | null;
	linkedinUrl: string | null;
	beats: string[];
	evidence: ArticleEvidence[];
	sourceUrl: string | null;
	raw: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);

/** Strip protocol, www and path; lowercase. */
export function normalizeDomain(v: unknown): string | null {
	const s = str(v);
	if (!s) return null;
	let host = s.toLowerCase();
	try {
		host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
	} catch {
		host = host.replace(/^[a-z]+:\/\//, '').split('/')[0];
	}
	host = host.replace(/^www\./, '').replace(/[.:]+$/, '');
	return host && host.includes('.') ? host : null;
}

/** Newsroom mailboxes are outlet contacts, not a journalist's. */
const ROLE_MAILBOX = /^(news(room|desk|tips)?|editor(s|ial)?|tips|press|media|info|contact|hello|pr|desk|letters|feedback|support|admin|staff)@/i;

export function isRoleMailbox(email: string): boolean {
	return ROLE_MAILBOX.test(email);
}

/** First and last from a display name. Anything with one token is first only. */
export function splitName(full: string | null): { first: string | null; last: string | null } {
	if (!full) return { first: null, last: null };
	const parts = full.replace(/\s+/g, ' ').trim().split(' ');
	if (parts.length === 1) return { first: parts[0], last: null };
	return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Map one actor item to zero, one or two staging rows.
 *
 * The actor returns one row per ARTICLE, not per journalist. A journalist
 * with two articles in a run yields two items; the dedup key (lower(email),
 * else name + outlet domain) folds them into one staged row and the
 * unique (job_id, dedup_key) keeps the second from inserting. The evidence
 * of the second is lost inside one run (a known, small loss: the reviewer
 * still sees one article), and merged across runs on approve.
 *
 *   - journalist name present            -> media_contact, email = the primary
 *     email unless it is a role mailbox (newsroom@), which is the OUTLET's
 *   - no journalist, but a role mailbox   -> media_outlet with contact_email
 *   - no journalist, no email             -> media_outlet (name + domain only),
 *     still worth staging: it feeds media_outlets and the outlet_crawl preset
 *   - article_unavailable with no outlet  -> skipped
 */
export function normalizeNewsJournalistItem(item: Record<string, unknown>, beat: string | null): MediaRecord[] {
	const status = str(item.status);
	const outletName = str(item.outletName);
	const outletDomain = normalizeDomain(item.publicationDomain) ?? normalizeDomain(item.outletUrl) ?? normalizeDomain(item.articleUrl);
	const journalist = str(item.journalistName);
	const query = str(item.query) ?? beat;
	const beats = query ? [query] : [];

	if (!outletName && !outletDomain) return [];
	if (status === 'article_unavailable' && !journalist && !outletDomain) return [];

	const emails = strArr(item.publicEmails).map((e) => e.toLowerCase());
	const primary = str(item.primaryEmail)?.toLowerCase() ?? emails[0] ?? null;
	const personal = [primary, ...emails].find((e): e is string => !!e && !isRoleMailbox(e)) ?? null;
	const roleMailbox = [primary, ...emails].find((e): e is string => !!e && isRoleMailbox(e)) ?? null;
	const socials = strArr(item.socialLinks);
	const personLinkedin = socials.find((s) => /linkedin\.com\/in\//i.test(s)) ?? null;
	const outletLinkedin = socials.find((s) => /linkedin\.com\/company\//i.test(s)) ?? null;
	const contactSources = strArr(item.contactSourceUrls);
	const evidence: ArticleEvidence[] = [
		{
			title: str(item.headline),
			url: str(item.articleUrl) ?? str(item.googleNewsUrl),
			date: str(item.publishedAt),
			source_url: contactSources[0] ?? null,
		},
	];
	const confidence = str(item.contactConfidence);
	const emailStatus = personal ? (confidence && confidence !== 'none' ? confidence : 'verified') : 'not_found';

	if (journalist) {
		const { first, last } = splitName(journalist);
		const dedupKey = personal ?? `name:${journalist.toLowerCase()}|${outletDomain ?? outletName?.toLowerCase() ?? ''}`;
		return [
			{
				kind: 'media_contact',
				dedupKey: dedupKey.slice(0, 400),
				fullName: journalist,
				firstName: first,
				lastName: last,
				email: personal,
				emailStatus,
				jobTitle: null,
				outletName,
				outletDomain,
				companyWebsite: str(item.outletUrl),
				companyLinkedin: outletLinkedin,
				linkedinUrl: personLinkedin,
				beats,
				evidence,
				sourceUrl: str(item.authorProfileUrl) ?? str(item.articleUrl),
				raw: item,
			},
		];
	}

	return [
		{
			kind: 'media_outlet',
			dedupKey: (outletDomain ?? `outlet:${outletName!.toLowerCase()}`).slice(0, 400),
			fullName: null,
			firstName: null,
			lastName: null,
			email: roleMailbox ?? primary,
			emailStatus: roleMailbox || primary ? 'verified' : 'not_found',
			jobTitle: null,
			outletName: outletName ?? outletDomain,
			outletDomain,
			companyWebsite: str(item.outletUrl),
			companyLinkedin: outletLinkedin,
			linkedinUrl: null,
			beats,
			evidence,
			sourceUrl: str(item.articleUrl),
			raw: item,
		},
	];
}

/** A dataset page -> staged rows, folded by dedup key within the page. */
export function normalizeNewsJournalistPage(
	items: Record<string, unknown>[],
	params: NewsJournalistsParams | null,
): { records: MediaRecord[]; skipped: number } {
	const beat = params?.queries?.[0] ?? null;
	const byKey = new Map<string, MediaRecord>();
	let skipped = 0;
	for (const item of items) {
		const rows = normalizeNewsJournalistItem(item, beat);
		if (rows.length === 0) {
			skipped += 1;
			continue;
		}
		for (const r of rows) {
			const prev = byKey.get(r.dedupKey);
			if (!prev) {
				byKey.set(r.dedupKey, r);
				continue;
			}
			// Same journalist, second article in the same page: keep both
			// articles as evidence and fill any blank the first lacked.
			prev.evidence = dedupeEvidence([...prev.evidence, ...r.evidence]);
			prev.beats = [...new Set([...prev.beats, ...r.beats])];
			prev.email = prev.email ?? r.email;
			prev.emailStatus = prev.email ? (prev.emailStatus === 'not_found' ? r.emailStatus : prev.emailStatus) : prev.emailStatus;
			prev.linkedinUrl = prev.linkedinUrl ?? r.linkedinUrl;
			prev.companyLinkedin = prev.companyLinkedin ?? r.companyLinkedin;
			prev.companyWebsite = prev.companyWebsite ?? r.companyWebsite;
		}
	}
	return { records: [...byKey.values()], skipped };
}

export function dedupeEvidence(list: ArticleEvidence[]): ArticleEvidence[] {
	const seen = new Set<string>();
	const out: ArticleEvidence[] = [];
	for (const e of list) {
		const k = e.url ?? e.title ?? '';
		if (!k || seen.has(k)) continue;
		seen.add(k);
		out.push(e);
	}
	return out;
}
