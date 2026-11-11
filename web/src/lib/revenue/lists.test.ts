import { describe, expect, it } from 'vitest';
import { cleanTerm, countPerId, isMissingFunction, pipelineRpcArgs, sanitizeDealQuery, summaryFromRows } from './lists';

const U1 = '3f2b8c1e-1111-4222-8333-944455556666';

describe('cleanTerm', () => {
	it('strips PostgREST / LIKE metacharacters', () => {
		expect(cleanTerm(' a,b(c)%d_e*f\\g ')).toBe('a b c d e f g');
	});
});

describe('pipelineRpcArgs', () => {
	it('sends the search term itself (searched in SQL), never id lists', () => {
		expect(pipelineRpcArgs({ pipelineIds: [U1], status: 'open', ownerId: U1, source: 'scrape', stageId: null, q: 'gmail' })).toEqual({
			p_pipeline_ids: [U1], p_status: 'open', p_owner: U1, p_source: 'scrape', p_stage: null, p_q: 'gmail',
		});
		expect(pipelineRpcArgs({ status: 'all' })).toEqual({ p_pipeline_ids: null, p_status: 'all', p_owner: null, p_source: null, p_stage: null, p_q: null });
	});
});

describe('sanitizeDealQuery', () => {
	it('keeps valid values and drops anything that is not a uuid / enum / clean term', () => {
		expect(sanitizeDealQuery({ pipelineIds: [U1, 'x)'], stageId: 'bad', ownerId: `${U1},status.eq.won`, source: 'scrape', status: 'won', q: 'a,b' }))
			.toEqual({ pipelineIds: [U1], stageId: null, ownerId: null, source: 'scrape', status: 'won', q: 'a b' });
		expect(sanitizeDealQuery({ status: 'weird', source: 'fax', pipelineIds: Array.from({ length: 50 }, () => U1) } as never))
			.toEqual({ pipelineIds: Array.from({ length: 20 }, () => U1), stageId: null, ownerId: null, source: null, status: 'open', q: null });
	});
});

describe('summaryFromRows', () => {
	it('sums stages and coerces bigint strings', () => {
		expect(summaryFromRows([{ stage_id: 's1', deals: '3', value_cents: '150000' }, { stage_id: 's2', deals: 2, value_cents: 0 }]))
			.toEqual({ byStage: { s1: { count: 3, valueCents: 150000 }, s2: { count: 2, valueCents: 0 } }, count: 5, valueCents: 150000, available: true });
	});
});

describe('isMissingFunction', () => {
	it('summary fallback when the function is missing', () => {
		expect(isMissingFunction({ code: '42883' })).toBe(true);
		expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
		expect(isMissingFunction({ code: '42501' })).toBe(false);
		expect(isMissingFunction(null)).toBe(false);
	});
});

describe('countPerId', () => {
	it('one exact head count per id, so a busy person is not cut at the 1000-row cap', async () => {
		const counts: Record<string, number> = { p1: 1500, p2: 3 };
		const db = { from: () => { let id = ''; const q = { select: () => q, eq: (_c: string, v: string) => { id = v; return q; }, then: (r: (v: unknown) => void) => r({ count: counts[id] ?? 0, error: null }) }; return q; } } as never;
		expect(await countPerId(db, 'rev_activities', 'person_id', ['p1', 'p2', 'p3'])).toEqual(new Map([['p1', 1500], ['p2', 3], ['p3', 0]]));
	});
});
