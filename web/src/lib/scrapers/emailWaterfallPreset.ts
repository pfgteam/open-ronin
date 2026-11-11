// Media Scraper preset: email_waterfall (automation-lab/email-finder).
//
// Enrichment, not discovery: name + outlet domain in, most-likely business
// email out, via the actor's waterfall (company website scrape, pattern
// detection, GitHub commits, Gravatar). Used two ways:
//
//   1. Standalone: the operator pastes "First Last, domain" lines.
//   2. Chained: "Find emails" on a news_journalists run queues one waterfall
//      job seeded from that run's approved-or-pending rows that have a name,
//      an outlet domain and NO email (the fallback chain in SCRAPERS_PLAN §4).
//
// Input schema read from the live Apify store on 2026-09-19 (build 0.1.28):
// `people: [{firstName, lastName, domain, company?, linkedinUrl?}]`, plus
// three booleans. Output per person: firstName, lastName, domain, company,
// linkedinUrl, email, confidence (high|medium|low), candidates[], sources[],
// isCatchAll, hasMx, scrapedAt.
//
// COST: $0.005 per run + $0.005 per person searched (Free tier). A run with
// 100 names costs about fifty cents.

import type { MediaRecord } from '@/lib/scrapers/newsJournalistsPreset';
import { normalizeDomain, splitName } from '@/lib/scrapers/newsJournalistsPreset';

export const EMAIL_WATERFALL_ACTOR = 'automation-lab/email-finder';
export const EMAIL_WATERFALL_PRESET = 'email_waterfall' as const;

export const USD_PER_RUN_START = 0.005;
export const USD_PER_PERSON = 0.005;

/** The actor's CSV path caps at 5,000 rows; the JSON path we use should stay
 *  well under that so one run finishes inside its timeout. */
export const MAX_PEOPLE = 1000;

export interface WaterfallPerson {
	firstName: string;
	lastName: string;
	domain: string;
	company?: string;
	linkedinUrl?: string;
	/** Which staging row this person came from, when chained. Not sent to
	 *  the actor; used at import to carry beats/outlet across. */
	sourceRecordId?: string;
}

export interface EmailWaterfallParams {
	people: WaterfallPerson[];
	/** The news_journalists job this was chained from, if any. */
	sourceJobId?: string;
	/** Beats to stamp on the staged rows (from the source job). */
	beats?: string[];
	checkWebsite?: boolean;
	checkGitHub?: boolean;
	checkGravatar?: boolean;
}

export function estimateEmailWaterfallCostUsd(peopleCount: number): number {
	const n = Math.min(Math.max(0, peopleCount), MAX_PEOPLE);
	return Math.round((USD_PER_RUN_START + n * USD_PER_PERSON) * 1000) / 1000;
}

/** Parse pasted lines: "First Last, domain.com" or "First Last <tab> domain.com"
 *  or "First Last @ domain.com". Lines without both parts are dropped. */
export function parsePeopleLines(text: string): WaterfallPerson[] {
	const out: WaterfallPerson[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const m = line.match(/^(.+?)\s*(?:,|\t|@|\|)\s*([^\s,|]+)\s*$/);
		if (!m) continue;
		const domain = normalizeDomain(m[2]);
		const { first, last } = splitName(m[1]);
		if (!domain || !first || !last) continue;
		out.push({ firstName: first, lastName: last, domain });
	}
	return out.slice(0, MAX_PEOPLE);
}

export function hasEmailWaterfallTargeting(params: EmailWaterfallParams): boolean {
	return params.people.length > 0;
}

/**
 * The actor's input. `people` is the documented wrapper; sourceRecordId is
 * ours and is stripped. max_results caps how many people we send, since the
 * bill is per person searched.
 */
export function buildEmailWaterfallInput(params: EmailWaterfallParams, maxResults: number): Record<string, unknown> {
	const people = params.people.slice(0, Math.min(maxResults, MAX_PEOPLE)).map((p) => {
		const o: Record<string, string> = { firstName: p.firstName, lastName: p.lastName, domain: p.domain };
		if (p.company) o.company = p.company;
		if (p.linkedinUrl) o.linkedinUrl = p.linkedinUrl;
		return o;
	});
	return {
		people,
		checkWebsite: params.checkWebsite ?? true,
		checkGitHub: params.checkGitHub ?? false,
		checkGravatar: params.checkGravatar ?? true,
	};
}

/** Actor confidence -> our email_status vocabulary. */
export function emailStatusFromConfidence(confidence: unknown, email: string | null): string {
	if (!email) return 'not_found';
	switch (confidence) {
		case 'high':
			return 'verified';
		case 'medium':
			return 'likely';
		case 'low':
			return 'pattern_guess';
		default:
			return 'likely';
	}
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One actor result -> one media_contact staging row. People with no email
 * found are still staged (status not_found) so the reviewer sees the miss,
 * but they dedup on name + domain rather than email.
 */
export function normalizeEmailWaterfallItem(item: Record<string, unknown>, params: EmailWaterfallParams | null): MediaRecord | null {
	const first = str(item.firstName);
	const last = str(item.lastName);
	const domain = normalizeDomain(item.domain);
	if (!first || !last || !domain) return null;
	const email = str(item.email)?.toLowerCase() ?? null;
	const fullName = `${first} ${last}`;
	const source = params?.people.find(
		(p) => p.firstName.toLowerCase() === first.toLowerCase() && p.lastName.toLowerCase() === last.toLowerCase() && p.domain === domain,
	);
	const sources = Array.isArray(item.sources) ? item.sources.filter((s): s is string => typeof s === 'string') : [];
	return {
		kind: 'media_contact',
		dedupKey: (email ?? `name:${fullName.toLowerCase()}|${domain}`).slice(0, 400),
		fullName,
		firstName: first,
		lastName: last,
		email,
		emailStatus: emailStatusFromConfidence(item.confidence, email),
		jobTitle: null,
		outletName: str(item.company) ?? source?.company ?? null,
		outletDomain: domain,
		companyWebsite: `https://${domain}`,
		companyLinkedin: null,
		linkedinUrl: str(item.linkedinUrl) ?? source?.linkedinUrl ?? null,
		beats: params?.beats ?? [],
		evidence: [],
		sourceUrl: sources.length ? `waterfall:${sources.join(',')}` : null,
		raw: item,
	};
}

export function normalizeEmailWaterfallPage(
	items: Record<string, unknown>[],
	params: EmailWaterfallParams | null,
): { records: MediaRecord[]; skipped: number } {
	const records: MediaRecord[] = [];
	let skipped = 0;
	const seen = new Set<string>();
	for (const item of items) {
		const r = normalizeEmailWaterfallItem(item, params);
		if (!r || seen.has(r.dedupKey)) {
			skipped += 1;
			continue;
		}
		seen.add(r.dedupKey);
		records.push(r);
	}
	return { records, skipped };
}
