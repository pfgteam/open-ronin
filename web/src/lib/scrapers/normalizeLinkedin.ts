// Turn one harvestapi/linkedin-profile-search item into a scraped_records row.
//
// Output shape verified against the actor's own README example (build 0.0.265,
// read 2026-09-09). It is NOT the flat shape the b2b_database actor returns:
// location, current position and pictures are nested objects, so this preset
// needs its own mapper rather than another candidate-key list on the shared
// one.
//
// The dedup key is the important difference. leadDedupKey() tries email first
// and otherwise needs name AND company — but a LinkedIn profile often has
// neither an email (only the paid email-search mode attempts one, and it is
// not guaranteed) nor a resolvable company. Every profile does have a stable,
// unique URL, so that is the key here. Without this, a run of otherwise good
// profiles would be dropped for "no usable identity".

import type { NormalizedLead, RawItem } from './normalizeLead';
import { normalizeDomain, normalizeEmail, pick, str } from './normalizeLead';

/** Read a nested value without pulling in a dependency. */
function nested(item: RawItem, path: string[]): string | null {
	let cur: unknown = item;
	for (const key of path) {
		if (!cur || typeof cur !== 'object') return null;
		cur = (cur as Record<string, unknown>)[key];
	}
	return str(cur);
}

/** First element of an array-of-objects field, e.g. currentPosition[0]. */
function firstOf(item: RawItem, key: string): Record<string, unknown> | null {
	const v = item[key];
	if (!Array.isArray(v) || v.length === 0) return null;
	const head = v[0];
	return head && typeof head === 'object' ? (head as Record<string, unknown>) : null;
}

/**
 * A profile's identity is its LinkedIn URL. publicIdentifier is the stable
 * slug ("taylor-reed"); the full URL is the fallback, and the opaque
 * member id (`id`) the last resort — some search results only carry that.
 */
export function linkedinDedupKey(lead: {
	publicIdentifier: string | null;
	linkedinUrl: string | null;
	memberId: string | null;
}): string | null {
	if (lead.publicIdentifier) return `li:${lead.publicIdentifier.toLowerCase()}`.slice(0, 400);
	if (lead.linkedinUrl) {
		// Normalize away the /in/ prefix, query and trailing slash so the same
		// profile reached two ways dedupes to one row.
		try {
			const u = new URL(lead.linkedinUrl);
			const slug = u.pathname.replace(/^\/in\//, '').replace(/\/+$/, '');
			if (slug) return `li:${slug.toLowerCase()}`.slice(0, 400);
		} catch {
			/* unparseable — fall through to the raw string */
		}
		return `li:${lead.linkedinUrl.toLowerCase()}`.slice(0, 400);
	}
	if (lead.memberId) return `li-id:${lead.memberId}`.slice(0, 400);
	return null;
}

export function normalizeLinkedinProfile(item: RawItem): NormalizedLead | null {
	const first = pick(item, ['firstName', 'first_name']);
	const last = pick(item, ['lastName', 'last_name']);
	const fullName = [first, last].filter(Boolean).join(' ') || pick(item, ['name', 'fullName']);

	const publicIdentifier = pick(item, ['publicIdentifier']);
	const linkedinUrl = pick(item, ['linkedinUrl', 'linkedin_url', 'profileUrl']);
	const memberId = pick(item, ['id', 'objectUrn']);

	// Current employer: currentPosition[0] on a search result, with the
	// experience[0] entry as the fallback on a full profile.
	const position = firstOf(item, 'currentPosition');
	const experience = firstOf(item, 'experience');
	const companyName =
		str(position?.companyName) ?? str(experience?.companyName) ?? null;
	const companyLinkedin =
		str(position?.companyLinkedinUrl) ?? str(experience?.companyLinkedinUrl) ?? null;

	// Location: the parsed sub-object is the reliable one; linkedinText is the
	// raw display string LinkedIn shows.
	const locationText =
		nested(item, ['location', 'parsed', 'text']) ??
		nested(item, ['location', 'linkedinText']) ??
		pick(item, ['location']);

	// Only present in "Full + email search" mode, and not for every profile.
	const email = normalizeEmail(pick(item, ['email', 'workEmail', 'emailAddress']));

	const lead: NormalizedLead = {
		dedupKey: '',
		fullName,
		firstName: first,
		lastName: last,
		email,
		personalEmail: normalizeEmail(pick(item, ['personalEmail'])),
		mobilePhone: pick(item, ['mobilePhone', 'phone']),
		linkedinUrl:
			linkedinUrl ?? (publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null),
		// The headline is the profile's own one-liner; the position title is the
		// actual job. Keep both — the headline is what a pitch reads.
		jobTitle: str(experience?.position) ?? str(position?.title) ?? null,
		headline: pick(item, ['headline']),
		// LinkedIn does not return the seniority/function ids it filters on, so
		// these stay null rather than guessing from the title.
		seniority: null,
		functionArea: null,
		location: locationText,

		companyName,
		companyDomain: normalizeDomain(pick(item, ['companyWebsite', 'companyDomain'])),
		companyWebsite: pick(item, ['companyWebsite']),
		companyLinkedin,
		companyPhone: null,
		companyIndustry: pick(item, ['companyIndustry', 'industry']),
		companySize: pick(item, ['companySize', 'employeeCount']),
		companyRevenue: null,
		companyFunding: null,
		companyFoundedYear: null,
		companyDescription: null,
		companyKeywords: null,
		companyTechnologies: null,
		companyCity: nested(item, ['location', 'parsed', 'city']),
		companyState: nested(item, ['location', 'parsed', 'state']),
		companyCountry: nested(item, ['location', 'parsed', 'country']),
		companyPostalCode: null,
		companyAddress: null,
		booth: null,
		boothSize: null,
		// The profile URL doubles as provenance: it is where this row came from
		// and where a human goes to check it.
		sourceUrl: linkedinUrl ?? null,
		raw: item,
	};

	const key = linkedinDedupKey({ publicIdentifier, linkedinUrl, memberId });
	if (!key) return null;
	lead.dedupKey = key;
	return lead;
}

/**
 * Normalize a page and drop items with no usable identity, collapsing
 * duplicates WITHIN the page so one upsert cannot hit "ON CONFLICT DO UPDATE
 * command cannot affect row a second time".
 */
export function normalizeLinkedinPage(items: RawItem[]): {
	leads: NormalizedLead[];
	skipped: number;
} {
	const seen = new Set<string>();
	const leads: NormalizedLead[] = [];
	let skipped = 0;
	for (const item of items) {
		const lead = normalizeLinkedinProfile(item);
		if (!lead || seen.has(lead.dedupKey)) {
			skipped++;
			continue;
		}
		seen.add(lead.dedupKey);
		leads.push(lead);
	}
	return { leads, skipped };
}
