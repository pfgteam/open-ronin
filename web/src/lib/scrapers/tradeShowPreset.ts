// Trade-show preset: skython/exhibitor-list-scraper.
//
// Shape is fundamentally different from the b2b_database preset: there are no
// ICP filters, the targeting IS the URL you paste. The actor aggregates 32
// platform-specific parsers (Map Your Show, Koelnmesse, Messe Frankfurt, Reed
// Expo, Informa Markets, A2Z Events, Ungerboeck, Comexposium, EasyFairs…), so
// one input covers 27+ directory platforms.
//
// FIELD NAMES ARE UNDERSCORE-PREFIXED. The actor publishes no output schema,
// and a live A2Z run returned `__company_name`, `_company_website`,
// `_company_country`, `_hall_stands` and `___exhibitor_profile_url` — the
// prefixes appear to control column order in exports. `pick` therefore ignores
// leading underscores rather than listing the prefixed spellings, which would
// break again the moment the count changed. Verified 2026-08-24 against
// exhibitor.newtopianow.com; other platforms may expose more fields, which is
// why `raw` keeps the untouched item.

import type { NormalizedLead, RawItem } from './normalizeLead';
import { normalizeDomain, normalizeEmail, pick, joinList, str } from './normalizeLead';

export const TRADE_SHOW_ACTOR = 'skython/exhibitor-list-scraper';

/** Per exhibitor scraped, plus a flat actor-start fee. */
export const USD_PER_EXHIBITOR = 0.005;
export const USD_PER_RUN_START = 0.01;

export interface TradeShowParams {
	/** The exhibitor listing page. This is the whole targeting. */
	url: string;
	/** Free: matches exhibitor domains against the actor's historical email DB. */
	lookupEmails?: boolean;
	/** +$0.001 each; only some platforms support it. */
	boothSizes?: boolean;
}

export function estimateTradeShowCostUsd(maxResults: number, boothSizes = false): number {
	const per = USD_PER_EXHIBITOR + (boothSizes ? 0.001 : 0);
	return Math.round((USD_PER_RUN_START + maxResults * per) * 100) / 100;
}

export function buildTradeShowInput(
	params: TradeShowParams,
	maxResults: number,
): Record<string, unknown> {
	return {
		start_url: params.url,
		// Never left blank: blank means "every exhibitor", and a large fair
		// would bill well past what the operator asked for.
		result_limit: maxResults,
		output_type: 'single_row',
		lookup_emails: params.lookupEmails ?? true,
		get_booth_sizes: params.boothSizes ?? false,
	};
}

/**
 * Identity for an exhibitor.
 *
 * Unlike a lead, an exhibitor is a COMPANY and often carries no person at all,
 * so keying on email would discard most of the list. Domain first, then
 * company name scoped to the show — two fairs can both list "Acme", and those
 * are legitimately two rows to review.
 */
export function exhibitorDedupKey(lead: {
	companyDomain: string | null;
	companyName: string | null;
	sourceUrl: string | null;
}): string | null {
	if (lead.companyDomain) return lead.companyDomain;
	const name = lead.companyName?.toLowerCase().replace(/\s+/g, ' ').trim();
	if (!name) return null;
	let show = '';
	try {
		show = lead.sourceUrl ? new URL(lead.sourceUrl).host.replace(/^www\./, '') : '';
	} catch {
		/* unparseable URL — the name alone still dedupes within the job */
	}
	return `exhibitor:${name}|${show}`.slice(0, 400);
}

/**
 * The email lookup returns `[{ email, event_count }]`. event_count is how many
 * events that address was seen at, so the highest one is the most durable.
 */
function bestFoundEmail(item: RawItem): string | null {
	const raw = (item.found_emails ?? item.foundEmails) as unknown;
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const rows = raw
		.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
		.filter((r): r is Record<string, unknown> => !!r);
	rows.sort((a, b) => Number(b.event_count ?? 0) - Number(a.event_count ?? 0));
	for (const r of rows) {
		const e = normalizeEmail(str(r.email));
		if (e) return e;
	}
	return null;
}

export function normalizeExhibitor(item: RawItem, sourceUrl: string): NormalizedLead | null {
	const companyName = pick(item, [
		'company_name', 'companyName', 'exhibitor_name', 'exhibitorName', 'name', 'company', 'exhibitor',
	]);
	// The exhibitor's own page on the fair site — where booth detail and
	// contacts live. More useful per row than repeating the list URL, which the
	// job's params already record.
	const profileUrl = pick(item, ['exhibitor_profile_url', 'profile_url', 'booth_url', 'detail_url']);
	const companyWebsite = pick(item, [
		'website', 'company_website', 'websiteUrl', 'url', 'company_url', 'homepage',
	]);
	const companyDomain = normalizeDomain(
		pick(item, ['domain', 'company_domain', 'website_domain']) ?? companyWebsite,
	);

	const lead: NormalizedLead = {
		dedupKey: '',
		// A contact person is optional on an exhibitor listing — most rows are
		// company-only, which is exactly why the dedup key ignores the person.
		fullName: pick(item, ['contact_name', 'contactName', 'contact_person', 'full_name', 'person']),
		firstName: pick(item, ['contact_first_name', 'first_name']),
		lastName: pick(item, ['contact_last_name', 'last_name']),
		// `found_emails` is the actor's historical lookup: [{email, event_count}].
		// Prefer the address seen at most events — it is the one that keeps
		// working across years.
		email:
			normalizeEmail(pick(item, ['email', 'contact_email', 'company_email'])) ??
			bestFoundEmail(item),
		personalEmail: null,
		mobilePhone: pick(item, ['contact_phone', 'mobile', 'mobile_number']),
		companyPhone: pick(item, ['phone', 'company_phone', 'telephone', 'phone_number']),
		linkedinUrl: pick(item, ['contact_linkedin', 'linkedin_person']),
		jobTitle: pick(item, ['contact_title', 'job_title', 'position']),
		headline: null,
		seniority: null,
		functionArea: null,
		location: pick(item, ['country', 'location', 'city']),

		companyName,
		companyDomain,
		companyWebsite,
		companyLinkedin: pick(item, ['linkedin', 'company_linkedin', 'linkedin_url']),
		companyIndustry: joinList(item, ['categories', 'category', 'product_categories', 'sectors']),
		companySize: null,
		companyRevenue: null,
		companyFunding: null,
		companyFoundedYear: null,
		companyDescription: pick(item, ['description', 'company_description', 'profile', 'about']),
		companyKeywords: joinList(item, ['keywords', 'products', 'brands', 'tags']),
		companyTechnologies: null,
		companyCity: pick(item, ['city', 'company_city']),
		companyState: pick(item, ['state', 'region', 'company_state']),
		companyCountry: pick(item, ['country', 'company_country']),
		companyPostalCode: pick(item, ['postal_code', 'zip', 'zipcode']),
		companyAddress: pick(item, ['address', 'full_address', 'street_address']),

		// Trade-show specific
		booth: pick(item, ['hall_stands', 'booth', 'booth_number', 'boothNumber', 'stand', 'stand_number', 'booth_id']),
		boothSize: pick(item, ['booth_size', 'boothSize', 'booth_area', 'size']),
		sourceUrl: profileUrl ?? sourceUrl,
		raw: item,
	};

	// A row with no company at all is not an exhibitor.
	if (!companyName && !companyDomain) return null;

	const key = exhibitorDedupKey(lead);
	if (!key) return null;
	lead.dedupKey = key;
	return lead;
}

/** Same in-page duplicate collapsing as the lead path, so one upsert cannot
 *  touch the same row twice. */
export function normalizeExhibitorPage(
	items: RawItem[],
	sourceUrl: string,
): { leads: NormalizedLead[]; skipped: number } {
	const seen = new Set<string>();
	const leads: NormalizedLead[] = [];
	let skipped = 0;
	for (const item of items) {
		const lead = normalizeExhibitor(item, sourceUrl);
		if (!lead || seen.has(lead.dedupKey)) {
			skipped++;
			continue;
		}
		seen.add(lead.dedupKey);
		leads.push(lead);
	}
	return { leads, skipped };
}

/** Reject anything that is not a plain http(s) URL before it reaches Apify. */
export function isValidShowUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2000) return false;
	try {
		const u = new URL(value.trim());
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

export { str };
