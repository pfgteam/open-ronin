// Reads every row of a scraped-records style query, not just the first page.
//
// PostgREST answers an un-ranged select with at most `db-max-rows` (1000 on
// this project) and reports the truncation only in a 206 Content-Range header,
// which supabase-js does not surface. A CSV export built on such a select
// silently ships the first 1000 leads of a 4995-row job and looks successful —
// which is exactly what the team hit (2026-09-21). So page explicitly.
//
// The page key must be UNIQUE. `company_name` alone is not: under a stable
// sort, names repeating across a page boundary drop or duplicate rows between
// pages (the same trap page.tsx documents on its own pending read). Every
// caller therefore orders by (company_name, id) and pages on that pair.

/** Rows per request. Below PostgREST's 1000 cap, so a page is never truncated. */
export const EXPORT_PAGE_SIZE = 1000;

/**
 * A hard ceiling so a runaway loop cannot hang the route or exhaust memory.
 * A scrape job tops out at 5000 rows, so this leaves generous headroom.
 */
export const EXPORT_MAX_ROWS = 50_000;

/**
 * Calls `page(from, to)` over an inclusive range until the table is exhausted.
 *
 * Stops when a page comes back short (the last page) or the ceiling is hit,
 * so the common one-page case costs exactly one request.
 *
 * @throws whatever `page` rejects with — a partial CSV must never be presented
 * as a complete one, so a mid-walk failure aborts the export.
 */
export async function fetchAllRows<T>(
	page: (from: number, to: number) => Promise<T[]>,
	pageSize: number = EXPORT_PAGE_SIZE,
): Promise<T[]> {
	const all: T[] = [];
	for (let from = 0; from < EXPORT_MAX_ROWS; from += pageSize) {
		const batch = await page(from, from + pageSize - 1);
		all.push(...batch);
		if (batch.length < pageSize) break;
	}
	return all;
}
