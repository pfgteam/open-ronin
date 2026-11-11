// Acquisition preset: agency owners as acquisition targets (migration 0060).
//
// Same actor as b2b_database (code_crafter/leads-finder) — this preset differs
// in WHAT it asks for (agencies of a given size run by their owners) and in
// WHERE approved rows go (acquisition_targets, never contacts or prospects).
// Spec: docs/planning/openronin-acquisition-scraper-ui-brief.md.
//
// Everything here is pure and tested. Two things decide correctness and
// money: the actor input (a filter the actor ignores bills for the wrong
// firms) and the import mapping (agency_services and owner_signal feed the
// deal model directly, and owner_signal must be the actor's own words —
// never a paraphrase, so a reviewer reads what the firm said, not what we
// inferred).

import { ACTOR_ID, LOCATION, USD_PER_LEAD, USD_PER_RUN_START, type Location } from './leadPreset';
import { type NormalizedLead, type RawItem, normalizeLead } from './normalizeLead';

export const ACQUISITION_ACTOR = ACTOR_ID;
export const ACQUISITION_PRESET = 'agency_owners' as const;
export const ACQUISITION_KIND = 'acquisition' as const;

/** The closed services vocabulary. Stored comma separated in
 *  scraped_records.agency_services and acquisition_targets.agency_services,
 *  in THIS order, so the deal model reads a stable string. */
export const SERVICES = ['PR', 'social', 'digital', 'SEO', 'content', 'branding', 'events'] as const;
export type Service = (typeof SERVICES)[number];

/** The owner-level titles the brief names. Sent to the actor as
 *  contact_job_title (its own free-text title filter). */
export const TITLE_SET = ['Owner', 'Founder', 'CEO', 'President', 'Managing Partner'] as const;
export type OwnerTitle = (typeof TITLE_SET)[number];

/** Default employee window (the brief: 5 to 50). */
export const DEFAULT_EMPLOYEE_MIN = 5;
export const DEFAULT_EMPLOYEE_MAX = 50;
/** Anything past this is not the kind of firm the rollup buys. */
export const EMPLOYEE_CEILING = 5000;

/** What the UI collects and what we persist in scrape_jobs.params. */
export interface AcquisitionParams {
	services?: Service[];
	employeeMin?: number;
	employeeMax?: number;
	/** Actor location enum values (the curated slice in leadPreset). */
	location?: Location[];
	/** Free-text cities, passed to the actor as contact_city. */
	city?: string[];
	titles?: OwnerTitle[];
	/** Minimum years in business. The actor has no founded-year filter, so
	 *  this is applied at IMPORT: rows whose founded year is known and too
	 *  recent are skipped; rows with no founded year are kept for review. */
	minYears?: number;
}

/** Same actor, same rate as the b2b preset. */
export function estimateAcquisitionCostUsd(maxResults: number): number {
	return Math.round((USD_PER_RUN_START + maxResults * USD_PER_LEAD) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Actor input
// ---------------------------------------------------------------------------

/** Industries an agency files under in the actor's enum. Always sent: the
 *  services keywords narrow WITHIN agencies, they do not define "agency". */
export const AGENCY_INDUSTRIES = [
	'marketing & advertising',
	'public relations & communications',
] as const;

/** Extra industries a service implies, on top of AGENCY_INDUSTRIES. */
const SERVICE_INDUSTRIES: Partial<Record<Service, string[]>> = {
	events: ['events services'],
	branding: ['design', 'graphic design'],
	digital: ['online media', 'internet'],
	content: ['media production'],
};

/** Actor keywords per service — the actor treats company_keywords as an
 *  include-any list, so several services widen rather than narrow. */
const SERVICE_KEYWORDS: Record<Service, string[]> = {
	PR: ['public relations', 'pr agency', 'media relations', 'publicity'],
	social: ['social media marketing', 'social media management', 'social media agency'],
	digital: ['digital marketing', 'digital agency', 'paid media', 'performance marketing'],
	SEO: ['seo', 'search engine optimization'],
	content: ['content marketing', 'content creation', 'content strategy'],
	branding: ['branding', 'brand strategy', 'brand identity'],
	events: ['event marketing', 'event production', 'experiential marketing'],
};

/** The actor's size buckets, as [label, lo, hi]. hi = Infinity for the open
 *  top bucket. Copied from the actor's enum (leadPreset.COMPANY_SIZE). */
const SIZE_BUCKETS: readonly [string, number, number][] = [
	['1-10', 1, 10],
	['11-20', 11, 20],
	['21-50', 21, 50],
	['51-100', 51, 100],
	['101-200', 101, 200],
	['201-500', 201, 500],
	['501-1000', 501, 1000],
	['1001-2000', 1001, 2000],
	['2001-5000', 2001, 5000],
	['5001-10000', 5001, 10000],
	['10001-20000', 10001, 20000],
	['20001-50000', 20001, 50000],
	['50000+', 50001, Number.POSITIVE_INFINITY],
];

/** Every actor size bucket that overlaps [min, max]. An employee window is
 *  what the operator thinks in; buckets are what the actor accepts. */
export function sizeBucketsFor(min: number, max: number): string[] {
	const lo = Math.max(1, Math.min(min, max));
	const hi = Math.max(min, max);
	return SIZE_BUCKETS.filter(([, bLo, bHi]) => bHi >= lo && bLo <= hi).map(([label]) => label);
}

/**
 * Translate acquisition params into the actor's input. Same conventions as
 * buildActorInput: empty arrays are omitted, fetch_count is always pinned to
 * the job ceiling, email_status defaults to validated.
 */
export function buildAcquisitionInput(params: AcquisitionParams, maxResults: number): Record<string, unknown> {
	const services = params.services ?? [];
	const industries = new Set<string>(AGENCY_INDUSTRIES);
	const keywords: string[] = [];
	for (const s of services) {
		for (const i of SERVICE_INDUSTRIES[s] ?? []) industries.add(i);
		keywords.push(...SERVICE_KEYWORDS[s]);
	}

	const input: Record<string, unknown> = {
		fetch_count: maxResults,
		file_name: 'Open Ronin acquisition scraper',
		company_industry: [...industries],
		size: sizeBucketsFor(
			params.employeeMin ?? DEFAULT_EMPLOYEE_MIN,
			params.employeeMax ?? DEFAULT_EMPLOYEE_MAX,
		),
		email_status: ['validated'],
	};
	const put = (key: string, value: unknown[] | undefined) => {
		if (value && value.length > 0) input[key] = value;
	};
	put('company_keywords', keywords);
	put('contact_job_title', params.titles ?? [...TITLE_SET]);
	put('contact_location', params.location);
	put('contact_city', params.city);
	return input;
}

/** The industry + size + title filters always target, so a run can never be
 *  the "arbitrary slice of 250M rows" the lead preset guards against. What
 *  we still require is a geography: the rollup buys in specific markets, and
 *  a worldwide agency-owner pull is money spent on firms nobody will call. */
export function hasAcquisitionTargeting(params: AcquisitionParams): boolean {
	return Boolean(params.location?.length || params.city?.length);
}

// ---------------------------------------------------------------------------
// Import mapping
// ---------------------------------------------------------------------------

/** Text patterns that mean a firm sells a given service. Matched against the
 *  actor's keywords + industry + description, lowercased. */
const SERVICE_PATTERNS: Record<Service, RegExp> = {
	PR: /\bpr\b|public relations|publicity|media relations|press relations|\bcommunications\b/,
	social: /social media|influencer/,
	digital: /digital (marketing|agency|advertising|strategy)|paid (media|search|social)|media buying|performance marketing|\bppc\b/,
	SEO: /\bseo\b|search engine optimi[sz]ation/,
	content: /content (marketing|creation|strategy|production)|copywriting/,
	branding: /\bbranding\b|brand (identity|strategy|design|development)/,
	events: /\bevents? (marketing|management|production|planning|services)\b|experiential/,
};

/** Comma-separated services from the fixed vocabulary, in vocabulary order.
 *  Null when nothing matched — the reviewer sees a blank, not a guess. */
export function normalizeServices(
	...texts: (string | null | undefined)[]
): string | null {
	const hay = texts.filter((t): t is string => typeof t === 'string' && t !== '').join(' \n ').toLowerCase();
	if (!hay) return null;
	const found = SERVICES.filter((s) => SERVICE_PATTERNS[s].test(hay));
	return found.length ? found.join(', ') : null;
}

/** Succession / for-sale language. When one of these appears, the SENTENCE
 *  containing it is copied verbatim into owner_signal. */
const SIGNAL_PATTERNS: RegExp[] = [
	/\bsuccession\b/i,
	/\bretir(e|es|ed|ing|ement)\b/i,
	/\bfor sale\b/i,
	/\bexit (strategy|plan|planning)\b/i,
	/\b(seeking|looking for) (a |an )?(buyer|acquirer|acquisition partner)\b/i,
	/\blooking to sell\b/i,
	/\bopen to (an )?acquisition\b/i,
	/\bacquisition (opportunit|interest)/i,
	/\bwind(ing)? down\b/i,
	/\btransition(ing)? (out|ownership|the business)\b/i,
	/\bstepping (back|down|away)\b/i,
];

const SIGNAL_MAX = 300;

/**
 * Return the actor's own sentence when it carries succession or for-sale
 * language, else null. NEVER a paraphrase: the reviewer must read exactly
 * what the firm wrote, because this text steers whether an owner gets a
 * call. The sentence is trimmed and capped, never reworded.
 */
export function extractOwnerSignal(...texts: (string | null | undefined)[]): string | null {
	for (const text of texts) {
		if (typeof text !== 'string' || text === '') continue;
		for (const re of SIGNAL_PATTERNS) {
			const m = re.exec(text);
			if (!m) continue;
			// Sentence bounds around the match: the previous terminator/newline
			// to the next one. Then a whitespace collapse — a layout choice, not
			// an edit to the words.
			const start = Math.max(
				text.lastIndexOf('.', m.index),
				text.lastIndexOf('!', m.index),
				text.lastIndexOf('?', m.index),
				text.lastIndexOf('\n', m.index),
			) + 1;
			const after = text.slice(m.index);
			const endRel = after.search(/[.!?\n]/);
			const end = endRel === -1 ? text.length : m.index + endRel + 1;
			const sentence = text.slice(start, end).replace(/\s+/g, ' ').trim();
			if (!sentence) continue;
			return sentence.length > SIGNAL_MAX ? `${sentence.slice(0, SIGNAL_MAX - 1).trimEnd()}…` : sentence;
		}
	}
	return null;
}

/** Parse a founded year the actor may send as "2011", 2011 or "2011-03". */
export function foundedYearOf(value: string | null): number | null {
	if (!value) return null;
	const m = /\b(18|19|20)\d{2}\b/.exec(value);
	return m ? Number(m[0]) : null;
}

/** True when the row is too young for the requested years in business. A
 *  row with NO founded year is never excluded here — that is a reviewer
 *  call, not an import-time drop. */
export function tooYoung(foundedYear: string | null, minYears: number | undefined, now = new Date()): boolean {
	if (!minYears || minYears <= 0) return false;
	const y = foundedYearOf(foundedYear);
	if (y === null) return false;
	return now.getFullYear() - y < minYears;
}

export interface NormalizedAcquisition extends NormalizedLead {
	agencyServices: string | null;
	ownerSignal: string | null;
}

/** One actor item → one acquisition row. Reuses the lead mapping (same actor,
 *  same field names) and adds the two 0060 columns. */
export function normalizeAcquisition(item: RawItem): NormalizedAcquisition | null {
	const lead = normalizeLead(item);
	if (!lead) return null;
	return {
		...lead,
		agencyServices: normalizeServices(lead.companyKeywords, lead.companyIndustry, lead.companyDescription),
		ownerSignal: extractOwnerSignal(lead.companyDescription, lead.headline, lead.companyKeywords),
	};
}

/**
 * Normalise a page and drop rows without identity, in-page duplicates, and
 * firms younger than `minYears`. Skipped counts feed the job's `duplicates`
 * tally, as the other presets do.
 */
export function normalizeAcquisitionPage(
	items: RawItem[],
	params: AcquisitionParams,
	now = new Date(),
): { leads: NormalizedAcquisition[]; skipped: number } {
	const seen = new Set<string>();
	const leads: NormalizedAcquisition[] = [];
	let skipped = 0;
	for (const item of items) {
		const row = normalizeAcquisition(item);
		if (!row || seen.has(row.dedupKey) || tooYoung(row.companyFoundedYear, params.minYears, now)) {
			skipped++;
			continue;
		}
		seen.add(row.dedupKey);
		leads.push(row);
	}
	return { leads, skipped };
}

/** Keep the actor's location enum importable from here for the rail. */
export { LOCATION as ACQUISITION_LOCATIONS };
