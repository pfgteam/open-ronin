// Lead Scraper preset: the b2b_database actor (code_crafter/leads-finder).
//
// The option lists below are copied from the ACTOR'S OWN input schema (read
// from the Apify API on 2026-08-24). That matters: the actor validates against
// these exact strings, so anything else either errors the run or is silently
// ignored — and a silently ignored filter is worse, because it bills for the
// wrong leads. Every list here is a strict subset of the actor's enum, so
// nothing we accept can be rejected downstream.
//
// The user picks these in the UI (Sam, 2026-08-24). Freedom in the filter,
// never in the cost: max_results is capped by a CHECK in migration 0041.

export const ACTOR_ID = 'code_crafter/leads-finder';
export const PRESET = 'b2b_database' as const;

/** Apify bills per lead fetched; this is the Scale-tier rate, for the UI's
 *  cost estimate. Actor start is a separate ~$0.02 event. */
export const USD_PER_LEAD = 0.0015;
export const USD_PER_RUN_START = 0.02;

export const SENIORITY = [
	'founder', 'owner', 'c_suite', 'director', 'partner', 'vp', 'head',
	'manager', 'senior', 'entry', 'trainee',
] as const;

export const FUNCTION_AREA = [
	'c_suite', 'finance', 'product_management', 'engineering', 'design',
	'education', 'human_resources', 'information_technology', 'legal',
	'marketing', 'operations', 'sales', 'support',
] as const;

export const COMPANY_SIZE = [
	'1-10', '11-20', '21-50', '51-100', '101-200', '201-500', '501-1000',
	'1001-2000', '2001-5000', '5001-10000', '10001-20000', '20001-50000', '50000+',
] as const;

export const EMAIL_STATUS = ['validated', 'not_validated', 'unknown'] as const;

export const REVENUE = [
	'100K', '500K', '1M', '5M', '10M', '25M', '50M', '100M', '500M', '1B', '5B', '10B',
] as const;

// A working subset of the actor's ~215 locations, weighted to where Open Ronin sells.
// Extending it is just adding strings that exist in the actor's enum.
export const LOCATION = [
	'united states', 'canada', 'united kingdom', 'australia', 'ireland',
	'new zealand', 'germany', 'france', 'spain', 'italy', 'netherlands',
	'sweden', 'denmark', 'norway', 'switzerland', 'brazil', 'mexico',
	'california, us', 'texas, us', 'new york, us', 'florida, us',
	'illinois, us', 'pennsylvania, us', 'virginia, us', 'ohio, us',
] as const;

// The actor's full industry enum is ~115 entries. This is the slice that maps
// to what a consumer-PR agency actually sells into; the rest can be added when
// a campaign needs it.
export const INDUSTRY = [
	'health, wellness & fitness', 'food & beverages', 'food production',
	'consumer goods', 'cosmetics', 'retail', 'wholesale', 'apparel & fashion',
	'restaurants', 'hospitality', 'leisure, travel & tourism', 'sporting goods',
	'sports', 'recreational facilities & services', 'wine & spirits',
	'luxury goods & jewelry', 'consumer services', 'consumer electronics',
	'medical devices', 'pharmaceuticals', 'alternative medicine',
	'mental health care', 'veterinary', 'environmental services',
	'renewables & environment', 'nonprofit organization management',
	'education management', 'e-learning', 'professional training & coaching',
	'marketing & advertising', 'public relations & communications',
	'computer software', 'internet', 'information technology & services',
	'financial services', 'real estate', 'construction', 'automotive',
] as const;

export type Seniority = (typeof SENIORITY)[number];
export type FunctionArea = (typeof FUNCTION_AREA)[number];
export type CompanySize = (typeof COMPANY_SIZE)[number];
export type EmailStatus = (typeof EMAIL_STATUS)[number];
export type Revenue = (typeof REVENUE)[number];
export type Location = (typeof LOCATION)[number];
export type Industry = (typeof INDUSTRY)[number];

/** What the UI collects and what we persist in scrape_jobs.params. */
export interface LeadParams {
	seniority?: Seniority[];
	functionArea?: FunctionArea[];
	industry?: Industry[];
	size?: CompanySize[];
	location?: Location[];
	city?: string[];
	jobTitle?: string[];
	keywords?: string[];
	emailStatus?: EmailStatus[];
	minRevenue?: Revenue;
	maxRevenue?: Revenue;
}

/** Cost estimate shown next to the max-results field, so nobody queues a
 *  five-figure run by accident. */
export function estimateCostUsd(maxResults: number): number {
	return Math.round((USD_PER_RUN_START + maxResults * USD_PER_LEAD) * 100) / 100;
}

/**
 * Translate our params into the actor's input.
 *
 * Empty arrays are OMITTED rather than sent: the actor treats an empty filter
 * array as "no filter", but sending `[]` on some fields has been seen to
 * behave differently from omitting the key, and omitting is unambiguous.
 *
 * `fetch_count` is always set from the job's max_results — never left at the
 * actor's default of 100000, which on a paid tier would bill for everything
 * matching the query.
 */
export function buildActorInput(params: LeadParams, maxResults: number): Record<string, unknown> {
	const input: Record<string, unknown> = {
		fetch_count: maxResults,
		file_name: 'Open Ronin lead scraper',
	};
	const put = (key: string, value: unknown[] | undefined) => {
		if (value && value.length > 0) input[key] = value;
	};

	put('seniority_level', params.seniority);
	put('functional_level', params.functionArea);
	put('company_industry', params.industry);
	put('size', params.size);
	put('contact_location', params.location);
	put('contact_city', params.city);
	put('contact_job_title', params.jobTitle);
	put('company_keywords', params.keywords);
	// Default to validated-only: an unverified email is a bounce we pay for.
	input.email_status = params.emailStatus?.length ? params.emailStatus : ['validated'];
	if (params.minRevenue) input.min_revenue = params.minRevenue;
	if (params.maxRevenue) input.max_revenue = params.maxRevenue;

	return input;
}

/** A job with no filter at all would bill for an arbitrary slice of a 250M
 *  database. At least one targeting filter is required. */
export function hasTargeting(params: LeadParams): boolean {
	return Boolean(
		params.seniority?.length ||
			params.functionArea?.length ||
			params.industry?.length ||
			params.size?.length ||
			params.location?.length ||
			params.city?.length ||
			params.jobTitle?.length ||
			params.keywords?.length,
	);
}
