// Vocabulary for the global search (TopNav → GlobalSearch): the record hit
// shapes the server action returns. No server imports — this file is bundled
// into the client component too (the 'use server' module may only export
// async functions, so the types live here).

export type RecordKind = 'person' | 'client' | 'outlet' | 'journalist' | 'opportunity' | 'work_item' | 'board';

export interface RecordHit {
	kind: RecordKind;
	/** Stable key for React lists + aria-activedescendant. */
	id: string;
	href: string;
	title: string;
	/** One-line context under the title (department, status, outlet, month). */
	subtitle: string | null;
}

export interface RecordSearchResult {
	/** The Work: boards first, then work items (Work Revamp). */
	work: RecordHit[];
	people: RecordHit[];
	clients: RecordHit[];
	media: RecordHit[];
	/** Non-fatal problems (a table not applied yet is NOT one; a 500 is). */
	error: string | null;
}

export const EMPTY_RECORD_RESULT: RecordSearchResult = { work: [], people: [], clients: [], media: [], error: null };

/** Fewer characters than this never hits the database. */
export const MIN_RECORD_QUERY = 2;

/** Per-group cap; the dropdown is a launcher, not a report. */
export const RECORD_GROUP_LIMIT = 5;

/**
 * Neutralise everything PostgREST's filter grammar treats as syntax. The
 * value lands inside an `or(...)` list, where `,` `(` `)` split terms and
 * quotes would start a quoted literal. Each such character becomes `_`, the
 * ILIKE single-character wildcard, so "L'Oréal", "O'Brien" or "Smith, Jones"
 * still match the stored name (a space there used to make them unfindable:
 * the stored text has an apostrophe, not a space). `%` and `*` also become
 * `_` so a typed wildcard can't widen the match to everything.
 */
export function sanitizeQuery(raw: string): string {
	return raw
		.replace(/[%,()"'\\*]/g, '_')
		.replace(/\s+/g, ' ')
		// A query that is only punctuation would become pure wildcards.
		.replace(/^[_\s]+|[_\s]+$/g, '')
		.slice(0, 80);
}
