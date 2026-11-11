import { describe, expect, it, vi } from 'vitest';
import { loadSalesData } from './salesData';

vi.mock('@/lib/revenue/server', () => ({
	loadMyDay: vi.fn(async () => []),
	loadConfig: vi.fn(async () => ({ notApplied: false, error: null, pipelines: [], stages: [], products: [], dispositions: [] })),
	loadLanes: vi.fn(async () => ({ people: [], targets: [], rules: [] })),
	loadDailyMetrics: vi.fn(async () => []),
	loadGhlBaseUrl: vi.fn(async () => 'https://app.gohighlevel.com'),
}));

// A thenable query stub: from().select().eq().eq() resolves to { data, error }.
function fakeDb(lanes: { lane: string }[] | null, error: unknown = null) {
	const q = { select: () => q, eq: () => q, then: (r: (v: unknown) => void) => r({ data: lanes, error }) };
	return { from: () => q } as never;
}

/**
 * Per-table stub that answers like Postgres would: rev_people stores the email
 * as typed ("Jane@Brand.com"); only the generated lower(btrim(email)) column
 * `email_key` equals the lower-cased attendee address.
 */
function tableDb() {
	const tables: Record<string, (filters: Record<string, unknown>) => unknown[]> = {
		rev_lanes_people: () => [{ lane: 'closer' }],
		rev_people: (f) => {
			const keys = (f['in:email_key'] as string[] | undefined) ?? [];
			const raw = (f['in:email'] as string[] | undefined) ?? [];
			const row = { id: 'p1', email: 'Jane@Brand.com', email_key: 'jane@brand.com' };
			return keys.includes('jane@brand.com') || raw.includes('Jane@Brand.com') ? [row] : [];
		},
		rev_deals: (f) => ((f['in:primary_person_id'] as string[] | undefined)?.includes('p1') ? [{ id: 'd1', title: 'Brand deal', primary_person_id: 'p1', updated_at: '2026-10-10T00:00:00Z' }] : []),
		rev_activities: () => [],
	};
	return {
		from(table: string) {
			const filters: Record<string, unknown> = {};
			const q = {
				select: () => q,
				eq: (c: string, v: unknown) => { filters[`eq:${c}`] = v; return q; },
				in: (c: string, v: unknown) => { filters[`in:${c}`] = v; return q; },
				then: (r: (v: unknown) => void) => r({ data: tables[table]?.(filters) ?? [], error: null }),
			};
			return q;
		},
	} as never;
}

describe('loadSalesData', () => {
	it('returns null without a lane', async () => {
		expect(await loadSalesData(fakeDb([]), 'u1', [])).toBeNull();
	});
	it('returns null when the revenue schema is missing', async () => {
		expect(await loadSalesData(fakeDb(null, { code: '42P01' }), 'u1', [])).toBeNull();
	});
	it('matches calendar attendees to people case-insensitively', async () => {
		const events = [{ id: 'e1', title: 'Jane x Open Ronin Discovery Call', starts_at: '2026-10-15T21:00:00Z', category_key: 'sales_call', attendee_external: ['jane@brand.com'], location: null }];
		const data = await loadSalesData(tableDb(), 'u1', events);
		expect(data?.calls).toEqual({ e1: { dealId: 'd1', dealTitle: 'Brand deal' } });
	});
});
