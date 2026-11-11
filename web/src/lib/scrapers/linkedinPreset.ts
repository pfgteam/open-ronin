// Lead Scraper preset: LinkedIn profile search (harvestapi/linkedin-profile-search).
//
// Same queue, same cron, same review table and same CSV as b2b_database and
// trade_show — only the way you ask differs. It runs under kind='lead' as a
// third PRESET rather than a new kind, because the review page filters on
// kind='lead' and a new kind would render an empty screen.
//
// Every option list below is copied from the ACTOR'S OWN input schema (read
// from the Apify API on 2026-09-09, build 0.0.265). The actor validates
// against these exact values, so anything else either errors the run or is
// silently ignored — and a silently ignored filter is worse, because it bills
// for the wrong profiles.
//
// COST (this preset bills per profile, not per lead like b2b_database):
//   $0.10 per search page (25 profiles), plus
//   $0.004 per full profile, or $0.010 with email search.
// So the mode is a money decision and belongs on the form, not hardcoded
// (Sam, 2026-09-09: "precisamos do email do linkedin, podemos adicionar
// os dois métodos?").
//
// LinkedIn caps ONE query at 2500 results and 100 search pages, regardless of
// what we ask for. Anything above that needs the query split; the UI warns
// rather than silently returning a truncated set.

export const LINKEDIN_ACTOR = 'harvestapi/linkedin-profile-search';
export const PRESET = 'linkedin_search' as const;

export const USD_PER_SEARCH_PAGE = 0.1;
export const PROFILES_PER_SEARCH_PAGE = 25;
export const USD_PER_PROFILE_FULL = 0.004;
export const USD_PER_PROFILE_EMAIL = 0.01;

/** LinkedIn's own hard ceiling for a single query — not ours to raise. */
export const LINKEDIN_MAX_PER_QUERY = 2500;

/**
 * Scrape depth. Both paid modes are exposed on purpose: email is the reason
 * the expensive one exists. 'Short' is omitted — it returns basic fields only
 * and no company detail, which strands the review table with half-empty rows
 * for a saving that does not matter at these volumes.
 */
export const SCRAPER_MODES = ['Full', 'Full + email search'] as const;
export type ScraperMode = (typeof SCRAPER_MODES)[number];

/** value = the actor's id, label = what the form shows. */
export const SENIORITY: readonly { value: string; label: string }[] = [
	{ value: '320', label: 'Owner / Partner' },
	{ value: '310', label: 'CXO' },
	{ value: '300', label: 'Vice President' },
	{ value: '220', label: 'Director' },
	{ value: '210', label: 'Experienced Manager' },
	{ value: '200', label: 'Entry Level Manager' },
	{ value: '130', label: 'Strategic' },
	{ value: '120', label: 'Senior' },
	{ value: '110', label: 'Entry Level' },
	{ value: '100', label: 'In Training' },
];

export const FUNCTION_AREA: readonly { value: string; label: string }[] = [
	{ value: '15', label: 'Marketing' },
	{ value: '25', label: 'Sales' },
	{ value: '4', label: 'Business Development' },
	{ value: '9', label: 'Entrepreneurship' },
	{ value: '16', label: 'Media and Communication' },
	{ value: '19', label: 'Product Management' },
	{ value: '18', label: 'Operations' },
	{ value: '10', label: 'Finance' },
	{ value: '1', label: 'Accounting' },
	{ value: '6', label: 'Consulting' },
	{ value: '8', label: 'Engineering' },
	{ value: '13', label: 'Information Technology' },
	{ value: '3', label: 'Arts and Design' },
	{ value: '12', label: 'Human Resources' },
	{ value: '11', label: 'Healthcare Services' },
	{ value: '7', label: 'Education' },
	{ value: '14', label: 'Legal' },
	{ value: '23', label: 'Real Estate' },
	{ value: '26', label: 'Customer Success and Support' },
	{ value: '20', label: 'Program and Project Management' },
];

export const COMPANY_HEADCOUNT: readonly { value: string; label: string }[] = [
	{ value: 'A', label: 'Self-employed' },
	{ value: 'B', label: '1-10' },
	{ value: 'C', label: '11-50' },
	{ value: 'D', label: '51-200' },
	{ value: 'E', label: '201-500' },
	{ value: 'F', label: '501-1,000' },
	{ value: 'G', label: '1,001-5,000' },
	{ value: 'H', label: '5,001-10,000' },
	{ value: 'I', label: '10,001+' },
];

export const YEARS_EXPERIENCE: readonly { value: string; label: string }[] = [
	{ value: '1', label: 'Less than 1 year' },
	{ value: '2', label: '1 to 2 years' },
	{ value: '3', label: '3 to 5 years' },
	{ value: '4', label: '6 to 10 years' },
	{ value: '5', label: 'More than 10 years' },
];

/**
 * Curated industry slice (Sam, 2026-09-09: "vamos começar com a lista
 * curada e depois expandir ela").
 *
 * LinkedIn's own taxonomy has 433 industries keyed by numeric id, with no
 * enum in the actor's schema — so the alternative was making an operator look
 * a code up in a CSV on GitHub. This list mirrors the b2b_database preset's
 * INDUSTRY list, which was already curated for what a consumer-PR agency
 * sells into, mapped to LinkedIn ids and verified against the official
 * taxonomy (linkedin_industry_code_v2, fetched 2026-09-09).
 *
 * To EXPAND: add `{ value: '<id>', label: '<label>' }` using that CSV —
 * https://github.com/HarvestAPI/linkedin-industry-codes-v2 — and keep the
 * label as LinkedIn writes it, so a filter chip matches what the operator
 * sees on the profile. Prefer a parent id over its children (id 27 "Retail"
 * covers the 15 retail sub-industries); mixing both just lengthens the list.
 */
export const INDUSTRY: readonly { value: string; label: string }[] = [
	// Food, drink, hospitality — the agency's core
	{ value: '34', label: 'Food and Beverage Services' },
	{ value: '23', label: 'Food and Beverage Manufacturing' },
	{ value: '1339', label: 'Food and Beverage Retail' },
	{ value: '142', label: 'Beverage Manufacturing' },
	{ value: '2500', label: 'Wineries' },
	{ value: '562', label: 'Breweries' },
	{ value: '564', label: 'Distilleries' },
	{ value: '32', label: 'Restaurants' },
	{ value: '31', label: 'Hospitality' },
	{ value: '22', label: 'Retail Groceries' },
	// Consumer goods and retail
	{ value: '27', label: 'Retail' },
	{ value: '1445', label: 'Online and Mail Order Retail' },
	{ value: '19', label: 'Retail Apparel and Fashion' },
	{ value: '143', label: 'Retail Luxury Goods and Jewelry' },
	{ value: '1359', label: 'Retail Health and Personal Care Products' },
	{ value: '598', label: 'Apparel Manufacturing' },
	{ value: '615', label: 'Fashion Accessories Manufacturing' },
	{ value: '18', label: 'Personal Care Product Manufacturing' },
	{ value: '133', label: 'Wholesale' },
	{ value: '134', label: 'Wholesale Import and Export' },
	{ value: '25', label: 'Manufacturing' },
	// Health and wellness
	{ value: '124', label: 'Wellness and Fitness Services' },
	{ value: '14', label: 'Hospitals and Health Care' },
	{ value: '125', label: 'Alternative Medicine' },
	{ value: '139', label: 'Mental Health Care' },
	{ value: '15', label: 'Pharmaceutical Manufacturing' },
	{ value: '17', label: 'Medical Equipment Manufacturing' },
	{ value: '16', label: 'Veterinary Services' },
	{ value: '2259', label: 'Personal Care Services' },
	// Travel, sport, leisure
	{ value: '30', label: 'Travel Arrangements' },
	{ value: '20', label: 'Sporting Goods Manufacturing' },
	{ value: '33', label: 'Spectator Sports' },
	{ value: '40', label: 'Recreational Facilities' },
	{ value: '2027', label: 'Sports and Recreation Instruction' },
	// Services and B2B
	{ value: '1862', label: 'Marketing Services' },
	{ value: '80', label: 'Advertising Services' },
	{ value: '98', label: 'Public Relations and Communications Services' },
	{ value: '105', label: 'Professional Training and Coaching' },
	{ value: '91', label: 'Consumer Services' },
	{ value: '2318', label: 'Household Services' },
	{ value: '4', label: 'Software Development' },
	{ value: '6', label: 'Technology, Information and Internet' },
	{ value: '43', label: 'Financial Services' },
	{ value: '44', label: 'Real Estate' },
	{ value: '48', label: 'Construction' },
	// Education, cause, environment
	{ value: '1999', label: 'Education' },
	{ value: '132', label: 'E-Learning Providers' },
	{ value: '131', label: 'Philanthropic Fundraising Services' },
	{ value: '86', label: 'Environmental Services' },
	{ value: '3243', label: 'Services for Renewable Energy' },
];

/** What the UI collects and what we persist in scrape_jobs.params. */
export interface LinkedinParams {
	mode?: ScraperMode;
	/** Free-text LinkedIn search, e.g. "Founder", "Head of Marketing". */
	searchQuery?: string;
	seniority?: string[];
	functionArea?: string[];
	industry?: string[];
	headcount?: string[];
	yearsExperience?: string[];
	/** Free text — LinkedIn resolves these itself and is literal about it
	 *  ("UK" resolves to Ukraine; write "United Kingdom"). */
	locations?: string[];
	currentJobTitles?: string[];
	currentCompanies?: string[];
	schools?: string[];
}

/**
 * Cost estimate for the form. Search pages are billed whole: asking for 30
 * profiles still pays for two pages of 25.
 *
 * Rounded to a tenth of a cent, not a cent: the per-profile rate is $0.004,
 * so cent-rounding swallows it entirely on a small run (25 profiles would
 * have estimated the bare page price and understated the bill).
 */
export function estimateCostUsd(maxResults: number, mode: ScraperMode): number {
	const pages = Math.ceil(maxResults / PROFILES_PER_SEARCH_PAGE);
	const perProfile =
		mode === 'Full + email search' ? USD_PER_PROFILE_EMAIL : USD_PER_PROFILE_FULL;
	return Math.round((pages * USD_PER_SEARCH_PAGE + maxResults * perProfile) * 1000) / 1000;
}

/**
 * Translate our params into the actor's input.
 *
 * Empty arrays are OMITTED rather than sent as `[]` — the same rule the other
 * presets follow, because omitting is unambiguously "no filter".
 *
 * maxItems AND takePages are both set. maxItems alone lets the actor keep
 * walking search pages (billed at $0.10 each) hunting for enough matches when
 * a query is narrow; takePages is the stop that keeps a run's page cost
 * bounded to what the estimate promised.
 */
export function buildLinkedinInput(
	params: LinkedinParams,
	maxResults: number,
): Record<string, unknown> {
	const capped = Math.min(maxResults, LINKEDIN_MAX_PER_QUERY);
	const input: Record<string, unknown> = {
		profileScraperMode: params.mode ?? 'Full',
		maxItems: capped,
		takePages: Math.ceil(capped / PROFILES_PER_SEARCH_PAGE),
	};
	const put = (key: string, value: unknown[] | undefined) => {
		if (value && value.length > 0) input[key] = value;
	};

	if (params.searchQuery?.trim()) input.searchQuery = params.searchQuery.trim();
	put('seniorityLevelIds', params.seniority);
	put('functionIds', params.functionArea);
	put('industryIds', params.industry);
	put('companyHeadcount', params.headcount);
	put('yearsOfExperienceIds', params.yearsExperience);
	put('locations', params.locations);
	put('currentJobTitles', params.currentJobTitles);
	put('currentCompanies', params.currentCompanies);
	put('schools', params.schools);

	return input;
}

/** A run with no targeting at all would bill for an arbitrary slice of
 *  LinkedIn. At least one filter or a search query is required. */
export function hasTargeting(params: LinkedinParams): boolean {
	return Boolean(
		params.searchQuery?.trim() ||
			params.seniority?.length ||
			params.functionArea?.length ||
			params.industry?.length ||
			params.headcount?.length ||
			params.yearsExperience?.length ||
			params.locations?.length ||
			params.currentJobTitles?.length ||
			params.currentCompanies?.length ||
			params.schools?.length,
	);
}
