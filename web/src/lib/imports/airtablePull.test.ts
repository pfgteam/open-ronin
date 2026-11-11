import { describe, expect, it } from 'vitest';
import type { DataAdapter, DataRecord, ListOptions } from '@/lib/data/adapter';
import { MEDIA_OPPS_SOURCE, pullHeaders, pullPages, recordToRow, rowsToCsv } from './airtablePull';
import { parseCsv } from './parse';
import { autoMatch } from './match';
import { TARGETS } from './targets';

type Fields = Record<string, unknown>;

/** Serves `links` for the link table and `pages` (100 each) for the main table with Airtable-style offsets. */
function fakeAdapter(links: DataRecord<Fields>[], pages: DataRecord<Fields>[][]): DataAdapter & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async list<T>(_base: string, table: string, opts?: ListOptions) {
			calls.push(`${table}:${opts?.cursor ?? 'start'}`);
			if (table === MEDIA_OPPS_SOURCE.linkTable) return { rows: links as unknown as DataRecord<T>[], cursor: undefined };
			const i = opts?.cursor ? Number(opts.cursor) : 0;
			return { rows: (pages[i] ?? []) as unknown as DataRecord<T>[], cursor: i + 1 < pages.length ? String(i + 1) : undefined };
		},
		listBases: async () => [],
		getBaseSchema: async () => ({ id: '', name: '', tables: [] }),
		get: async () => null,
		create: async () => ({ id: '', fields: {} as never }),
		update: async () => ({ id: '', fields: {} as never }),
		delete: async () => undefined,
	};
}

describe('airtablePull', () => {
	const links: DataRecord<Fields>[] = [{ id: 'recCLIENT000000001', fields: { 'Contoso': ' Acme Snacks ' } }];

	it('writes the record id first and resolves the Client link to its name', () => {
		const rec: DataRecord<Fields> = {
			id: 'recOPP000000000001',
			fields: { 'Media Opp': 'Forbes', Client: ['recCLIENT000000001'], Reach: 1200, Status: 'Secured Coverage', 'Date Secured': '2026-09-01', 'Media Tier': 'Top Tier' },
		};
		const row = recordToRow(rec, MEDIA_OPPS_SOURCE, { recCLIENT000000001: 'Acme Snacks' });
		const headers = pullHeaders(MEDIA_OPPS_SOURCE);
		expect(headers[0]).toBe('Record ID');
		expect(row[0]).toBe('recOPP000000000001');
		expect(row[headers.indexOf('Client')]).toBe('Acme Snacks');
		expect(row[headers.indexOf('Reach')]).toBe('1200');
		expect(row[headers.indexOf('Outlet')]).toBe('');
		expect(row.length).toBe(headers.length);
	});

	it('leaves the client empty when the link points at an unknown record (rejected later, not guessed)', () => {
		const row = recordToRow({ id: 'recOPP000000000002', fields: { Client: ['recNOPE'] } }, MEDIA_OPPS_SOURCE, {});
		expect(row[pullHeaders(MEDIA_OPPS_SOURCE).indexOf('Client')]).toBe('');
	});

	it('pulls page by page with a resumable cursor and loads link names once', async () => {
		const pages = [0, 1, 2].map((p) => Array.from({ length: 100 }, (_, i) => ({ id: `rec${String(p * 100 + i).padStart(15, '0')}`, fields: { Client: ['recCLIENT000000001'], Status: 'Pending Coverage' } })));
		const adapter = fakeAdapter(links, pages);
		const first = await pullPages(adapter, MEDIA_OPPS_SOURCE, { cursor: undefined, pulled: 0, linkNames: {} }, 2);
		expect(first.rows.length).toBe(200);
		expect(first.done).toBe(false);
		expect(first.state.cursor).toBe('2');
		expect(first.state.linkNames).toEqual({ recCLIENT000000001: 'Acme Snacks' });
		const second = await pullPages(adapter, MEDIA_OPPS_SOURCE, first.state, 2);
		expect(second.rows.length).toBe(100);
		expect(second.done).toBe(true);
		expect(second.state.cursor).toBeNull();
		expect(second.state.pulled).toBe(300);
		expect(adapter.calls.filter((c) => c.startsWith(MEDIA_OPPS_SOURCE.linkTable)).length).toBe(1);
	});

	it('produces a CSV the wizard auto maps onto the media_opportunities target with no manual step', () => {
		const csv = rowsToCsv(MEDIA_OPPS_SOURCE, [recordToRow({ id: 'recOPP000000000001', fields: { 'Media Opp': 'A, "quoted"', Client: ['recCLIENT000000001'] } }, MEDIA_OPPS_SOURCE, { recCLIENT000000001: 'Acme Snacks' })]);
		const parsed = parseCsv(csv);
		expect(parsed.headers).toEqual(pullHeaders(MEDIA_OPPS_SOURCE));
		expect(parsed.rows[0][pullHeaders(MEDIA_OPPS_SOURCE).indexOf('Media Opp')]).toBe('A, "quoted"');
		const mapping = autoMatch(parsed.headers, TARGETS.media_opportunities.columns);
		const mapped = new Set(Object.keys(mapping));
		for (const key of ['airtable_record_id', 'client_name', 'title', 'story_title', 'potential_story', 'outlet_name', 'outlet_url', 'status_raw', 'date_secured', 'date_sent_to_client', 'date_added', 'live_link', 'live_date', 'reach', 'media_tier', 'category', 'opp_type', 'secured_by']) {
			expect(mapped.has(key), key).toBe(true);
		}
	});
});
