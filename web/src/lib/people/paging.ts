// Page math for the Team Check-ins list. Pure so the clamp rule is tested
// once and the page holds no arithmetic: a ?p= past the end lands on the last
// page (a stale bookmark or a filter that shrank the list must never render an
// empty page under a pager claiming rows exist — the same rule the lead
// scraper's queue applies).

/** Page sizes the list offers; anything else falls back to the default. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export function parsePageSize(raw: string | undefined): PageSize {
	const n = Number(raw);
	return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

/** A positive integer page number; anything else is page 1. */
export function parsePage(raw: string | undefined): number {
	return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
}

export interface PageSlice {
	/** The page actually shown, after clamping. */
	page: number;
	pageCount: number;
	/** Inclusive start / exclusive end into the full list. */
	start: number;
	end: number;
}

export function pageSlice(total: number, requested: number, size: number): PageSlice {
	const pageCount = Math.max(1, Math.ceil(total / size));
	const page = Math.min(Math.max(1, requested), pageCount);
	const start = (page - 1) * size;
	return { page, pageCount, start, end: Math.min(total, start + size) };
}
