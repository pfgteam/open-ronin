// Page-link math shared by ui/Pagination and the list URL contracts. Pure.

export const PAGE_SIZE = 50;
export const PAGE_SIZES = [25, 50, 100] as const;

/** Activity timelines (deal, person): newest first, this many per page, `?tl=` in the URL. */
export const TIMELINE_PAGE_SIZE = 10;

/** A 1-based page number from a URL param; anything else is page 1. */
export function parsePage(raw: string | undefined | null): number {
	const n = Number(raw);
	return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}

/** Inclusive PostgREST .range() bounds for a 1-based page. */
export function rangeFor(page: number, size: number): { from: number; to: number } {
	const from = (Math.max(1, page) - 1) * size;
	return { from, to: from + size - 1 };
}

/** Page links: first, last, and two either side of the current page; 'gap' where pages are skipped. */
export function pageWindow(page: number, pages: number): (number | 'gap')[] {
	const keep = new Set([1, pages]);
	for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= pages) keep.add(p);
	if (page <= 3) for (let p = 1; p <= Math.min(pages, 3); p++) keep.add(p);
	const out: (number | 'gap')[] = [];
	for (const p of [...keep].sort((a, b) => a - b)) {
		const prev = out[out.length - 1];
		// A gap that would hide a single page shows that page instead.
		if (typeof prev === 'number' && p - prev === 2) out.push(prev + 1);
		else if (typeof prev === 'number' && p - prev > 2) out.push('gap');
		out.push(p);
	}
	return out;
}
