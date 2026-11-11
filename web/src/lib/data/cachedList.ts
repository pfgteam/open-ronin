// Cached full-table reads for Airtable-backed list pages.
//
// Two bugs live in the hand-rolled `do { … } while (cursor)` loops this
// replaces, and both are fixed here rather than nine times over.
//
// 1. SPEED. `AirtableAdapter.list` sets `next: { revalidate: 60 }`, so a
//    first-page read is served from Next's fetch cache — but the adapter
//    deliberately marks any CURSOR-bearing request `no-store`, because
//    Airtable's iterators are short-lived and a cached offset breaks
//    pagination with LIST_RECORDS_ITERATOR_NOT_AVAILABLE. The consequence:
//    page 1 could hit cache and pages 2..N never could. Every visit to
//    /clients or /media/opps re-walked the whole table in series, 200-400ms
//    per hop, up to 50 hops. Airtable also rate-limits at 5 req/s per base,
//    so concurrent viewers tripped the 429 back-off.
//
//    Caching the WHOLE walk sidesteps the iterator problem: the cursor pages
//    still run uncached, but only on a miss, and one refresh is shared by
//    every viewer instead of one walk per pageview.
//
// 2. HONESTY. The loops carried a `safety` counter and, on exhownerg it,
//    returned the partial array as if it were complete — so once Media
//    Opportunities crossed 3,000 rows every tile on /dashboard/delivery read
//    low with no indication. `truncated` is now part of the result and the
//    caller is expected to surface it.
//
// Note on size: Next's data cache skips entries over ~2MB (with a warning)
// and falls back to computing them live, which is exactly today's behaviour —
// so an oversized table degrades rather than breaking. Keep `fields` narrow.

import { unstable_cache } from 'next/cache';
import { getAdapter, type DataRecord, type ListOptions } from '@/lib/data';

/** Airtable's own maximum. */
const PAGE_SIZE = 100;

/** 100 pages = 10,000 records. Well past any table the app reads today. */
const DEFAULT_MAX_PAGES = 100;

export interface FullTableResult<T> {
	rows: DataRecord<T>[];
	/** True when `maxPages` ran out before the cursor did — the rows are partial. */
	truncated: boolean;
}

type CacheableOptions = {
	fields?: string[];
	filter?: string;
	view?: string;
	sort?: ListOptions['sort'];
	maxPages?: number;
};

async function walkOnce(
	baseId: string,
	table: string,
	opts: CacheableOptions,
): Promise<FullTableResult<Record<string, unknown>>> {
	const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
	const adapter = getAdapter();

	const rows: DataRecord<Record<string, unknown>>[] = [];
	let cursor: string | undefined;
	let pages = 0;

	do {
		const page = await adapter.list<Record<string, unknown>>(baseId, table, {
			pageSize: PAGE_SIZE,
			fields: opts.fields,
			filter: opts.filter,
			view: opts.view,
			sort: opts.sort,
			cursor,
		});
		rows.push(...page.rows);
		cursor = page.cursor;
		pages += 1;
	} while (cursor && pages < maxPages);

	if (cursor) {
		console.warn(
			`[cachedList] ${table} hit the ${maxPages}-page ceiling (${rows.length} rows) — result is partial.`,
		);
	}

	return { rows, truncated: !!cursor };
}

function isExpiredIterator(e: unknown): boolean {
	const details = JSON.stringify((e as { details?: unknown })?.details ?? '');
	const message = e instanceof Error ? e.message : String(e);
	return `${message} ${details}`.includes('LIST_RECORDS_ITERATOR_NOT_AVAILABLE');
}

async function walkAllPages(
	baseId: string,
	table: string,
	optionsJson: string,
): Promise<FullTableResult<Record<string, unknown>>> {
	const opts = JSON.parse(optionsJson) as CacheableOptions;

	try {
		return await walkOnce(baseId, table, opts);
	} catch (e) {
		// Airtable iterators are short-lived, so a slow walk over a large table
		// can outlive its own offset. Restarting from scratch once is the
		// remedy the /dashboard/delivery loader already proved out; a second
		// failure is a real error and propagates so nothing caches a bad read.
		if (!isExpiredIterator(e)) throw e;
		return await walkOnce(baseId, table, opts);
	}
}

// The function's arguments are part of the cache key, so baseId + table +
// the serialized options each get their own entry. `revalidate: 120` matches
// what /dashboard already uses: operational data nobody expects to the second.
const walkAllPagesCached = unstable_cache(walkAllPages, ['airtable-full-table'], {
	revalidate: 120,
});

/**
 * Read every record of an Airtable table, cached and shared across requests.
 *
 * Options are serialized into the cache key, so vary them deliberately — a
 * per-viewer `filter` would give every viewer their own entry and defeat the
 * sharing. Filter in the caller instead when the predicate is viewer-specific.
 */
export async function listFullTable<T = Record<string, unknown>>(
	baseId: string,
	table: string,
	options: CacheableOptions = {},
): Promise<FullTableResult<T>> {
	const result = await walkAllPagesCached(baseId, table, JSON.stringify(options));
	return {
		rows: result.rows as unknown as DataRecord<T>[],
		truncated: result.truncated,
	};
}
