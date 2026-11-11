// Lead-scraper filter state, carried in the URL.
//
// WHY THE URL: the Apollo layout (phase 4) needs selecting a past run to
// preload that run's filters into the rail. Holding filters in a client store
// would make the page a client component and would lose them on reload; the
// URL keeps the page a server component, makes a composed-but-not-yet-run
// search linkable, and lets `?job=` and `f.*` coexist so the rail can describe
// a NEW search while the results still show the SELECTED one.
//
// The `f.` prefix keeps filter keys from colliding with `job` and `mode`.
//
// Values are validated against the preset vocabularies on the way in. The
// actor validates against its own enums, so a hand-edited URL carrying
// `f.industry=banking` must not reach createJob — a filter the actor rejects
// errors the run, and one it silently ignores is worse, because it bills for
// the wrong leads (see leadPreset.ts's header).

import {
	SENIORITY,
	FUNCTION_AREA,
	INDUSTRY,
	COMPANY_SIZE,
	LOCATION,
	EMAIL_STATUS,
	REVENUE,
	type LeadParams,
	type Revenue,
} from './leadPreset';

/** The rail's full state: the actor's filters plus the run ceiling, which is
 *  stored on the job row rather than inside `params`. */
export type LeadFilters = LeadParams & { maxResults: number };

export const DEFAULT_MAX_RESULTS = 250;
/** Mirrors the CHECK in 0041 and `maxResultsSchema` in actions.ts. */
export const MIN_MAX_RESULTS = 1;
export const MAX_MAX_RESULTS = 5000;

const PREFIX = 'f.';

/** Next hands a key that appears once as a string and one that repeats as an
 *  array. Everything downstream wants an array. */
function toArray(v: string | string[] | undefined): string[] {
	if (v === undefined) return [];
	return (Array.isArray(v) ? v : [v]).filter((s) => typeof s === 'string' && s.trim() !== '');
}

function allowed<T extends string>(values: string[], vocabulary: readonly T[]): T[] {
	return values.filter((v): v is T => (vocabulary as readonly string[]).includes(v));
}

function clampMaxResults(raw: string | string[] | undefined): number {
	const first = Array.isArray(raw) ? raw[0] : raw;
	const n = Number(first);
	if (!Number.isFinite(n)) return DEFAULT_MAX_RESULTS;
	return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.floor(n)));
}

type SearchParamRecord = Record<string, string | string[] | undefined>;

export function parseFilterParams(sp: SearchParamRecord): LeadFilters {
	const at = (key: string) => toArray(sp[PREFIX + key]);
	const single = (key: string) => {
		const v = sp[PREFIX + key];
		return Array.isArray(v) ? v[0] : v;
	};
	const revenue = (key: string): Revenue | undefined => {
		const v = single(key);
		return v && (REVENUE as readonly string[]).includes(v) ? (v as Revenue) : undefined;
	};

	return {
		seniority: allowed(at('seniority'), SENIORITY),
		functionArea: allowed(at('functionArea'), FUNCTION_AREA),
		industry: allowed(at('industry'), INDUSTRY),
		size: allowed(at('size'), COMPANY_SIZE),
		location: allowed(at('location'), LOCATION),
		emailStatus: allowed(at('emailStatus'), EMAIL_STATUS),
		// Free text — the actor takes these as-is, so there is no vocabulary to
		// check them against.
		city: at('city'),
		jobTitle: at('jobTitle'),
		keywords: at('keywords'),
		minRevenue: revenue('minRevenue'),
		maxRevenue: revenue('maxRevenue'),
		maxResults: clampMaxResults(sp[PREFIX + 'maxResults']),
	};
}

const ARRAY_KEYS = [
	'seniority',
	'functionArea',
	'industry',
	'size',
	'location',
	'emailStatus',
	'city',
	'jobTitle',
	'keywords',
] as const satisfies readonly (keyof LeadParams)[];

export function filtersToSearchParams(filters: Partial<LeadFilters>): URLSearchParams {
	const sp = new URLSearchParams();
	for (const key of ARRAY_KEYS) {
		for (const value of filters[key] ?? []) sp.append(PREFIX + key, value);
	}
	if (filters.minRevenue) sp.set(PREFIX + 'minRevenue', filters.minRevenue);
	if (filters.maxRevenue) sp.set(PREFIX + 'maxRevenue', filters.maxRevenue);
	sp.set(PREFIX + 'maxResults', String(filters.maxResults ?? DEFAULT_MAX_RESULTS));
	return sp;
}

/**
 * A stored job's `params` blob back into rail state, so selecting a past run
 * preloads the search that produced it.
 *
 * `params` comes from the database as `Record<string, unknown>` and is not
 * trusted: a trade-show job stores `{ url }` and no filters at all, and older
 * rows may carry shapes this build no longer writes. Anything unrecognised
 * drops out rather than throwing — a run you cannot select is worse than one
 * whose filters come back empty.
 */
export function filtersFromJobParams(
	params: Record<string, unknown>,
	maxResults: number | null,
): LeadFilters {
	const sp: SearchParamRecord = {};
	for (const key of ARRAY_KEYS) {
		const v = params[key];
		if (Array.isArray(v)) sp[PREFIX + key] = v.filter((x): x is string => typeof x === 'string');
	}
	if (typeof params.minRevenue === 'string') sp[PREFIX + 'minRevenue'] = params.minRevenue;
	if (typeof params.maxRevenue === 'string') sp[PREFIX + 'maxRevenue'] = params.maxRevenue;
	sp[PREFIX + 'maxResults'] = String(maxResults ?? DEFAULT_MAX_RESULTS);
	return parseFilterParams(sp);
}

/**
 * Whether two filter sets describe the same search — drives the "filters
 * changed" notice.
 *
 * Order-insensitive on purpose: the rail renders checkboxes in preset order
 * while a stored job holds them in submission order, so comparing positionally
 * would flag every selected run as edited and train people to ignore the
 * notice.
 */
export function filtersEqual(a: Partial<LeadFilters>, b: Partial<LeadFilters>): boolean {
	for (const key of ARRAY_KEYS) {
		const av = [...(a[key] ?? [])].sort();
		const bv = [...(b[key] ?? [])].sort();
		if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
	}
	if ((a.minRevenue ?? undefined) !== (b.minRevenue ?? undefined)) return false;
	if ((a.maxRevenue ?? undefined) !== (b.maxRevenue ?? undefined)) return false;
	// Part of the comparison because it changes what the run costs, not just
	// what it matches.
	return (a.maxResults ?? DEFAULT_MAX_RESULTS) === (b.maxResults ?? DEFAULT_MAX_RESULTS);
}
