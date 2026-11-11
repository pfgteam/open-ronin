import { describe, expect, it, vi } from 'vitest';
import { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE, fetchAllRows } from './fetchAllRows';

/** A table of `total` rows behind a PostgREST-style capped range read. */
function fakeTable(total: number, cap = EXPORT_PAGE_SIZE) {
	const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
	return vi.fn(async (from: number, to: number) =>
		// PostgREST clamps the window to db-max-rows, exactly as production does.
		rows.slice(from, Math.min(to + 1, from + cap)),
	);
}

describe('fetchAllRows', () => {
	it('returns every row of a job that exceeds the 1000-row PostgREST cap', async () => {
		// 4995 = the real job that shipped only 1000 leads (2026-09-21).
		const page = fakeTable(4995);
		const rows = await fetchAllRows(page);

		expect(rows).toHaveLength(4995);
		// No row lost or repeated across page boundaries.
		expect(new Set(rows.map((r) => r.id)).size).toBe(4995);
		expect(rows.at(-1)).toEqual({ id: 4994 });
	});

	it('costs a single request when the job fits in one page', async () => {
		const page = fakeTable(120);
		await expect(fetchAllRows(page)).resolves.toHaveLength(120);
		expect(page).toHaveBeenCalledTimes(1);
	});

	it('stops instead of looping forever on an empty table', async () => {
		const page = fakeTable(0);
		await expect(fetchAllRows(page)).resolves.toEqual([]);
		expect(page).toHaveBeenCalledTimes(1);
	});

	it('makes a second request when the count lands exactly on the page size', async () => {
		const page = fakeTable(EXPORT_PAGE_SIZE);
		await expect(fetchAllRows(page)).resolves.toHaveLength(EXPORT_PAGE_SIZE);
		// A full page is indistinguishable from "more to come" — must confirm.
		expect(page).toHaveBeenCalledTimes(2);
	});

	it('propagates a mid-walk failure rather than returning a partial export', async () => {
		const page = vi
			.fn<(from: number, to: number) => Promise<{ id: number }[]>>()
			.mockResolvedValueOnce(Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: i })))
			.mockRejectedValueOnce(new Error('statement timeout'));

		await expect(fetchAllRows(page)).rejects.toThrow('statement timeout');
	});

	it('honours the runaway ceiling', async () => {
		const page = fakeTable(EXPORT_MAX_ROWS + 5000);
		const rows = await fetchAllRows(page);
		expect(rows).toHaveLength(EXPORT_MAX_ROWS);
	});
});
