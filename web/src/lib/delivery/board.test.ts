import { describe, expect, it } from 'vitest';
import type { ClientTrendRow, ContractRow } from '@/lib/clients/analytics';
import { buildBoardRows, countBoardRows, filterBoardRows, isBeaconPackage, sortBoardRows } from './board';

const asOf = new Date('2026-09-21T12:00:00Z'); // 21/30 → expected = 0.7 × goal
const months = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];

function contract(over: Partial<ContractRow>): ContractRow {
	return {
		contract_id: 'c1', client_id: 'u1', display_name: 'Acme', airtable_contract_id: 'recA',
		status: 'active', package: 'Brand Accelerator', package_family: 'Brand Accelerator',
		package_quota: 7, current_month_goal: 7, current_month_goal_source: 'tier default',
		per_month_cents: null, starts_on: null, ends_on: null, term_months: null, renewal_on: null,
		last_secured_month: '2026-09-01', last_live_month: null, days_since_last_secured: 0, opps_synced_at: null,
		...over,
	};
}
function trend(rec: string, month: string, secured: number, live = 0, goal: number | null = 7): ClientTrendRow {
	return { airtable_contract_id: rec, month, secured_count: secured, live_count: live, goal, goal_source: goal == null ? null : 'tier default', secured_pct_of_goal: null, synced_at: '2026-09-21T08:41:00Z' };
}

describe('isBeaconPackage', () => {
	it('matches any package naming Beacon, case-insensitive', () => {
		expect(isBeaconPackage('Project Beacon')).toBe(true);
		expect(isBeaconPackage('Free Beacon Month')).toBe(true);
		expect(isBeaconPackage('Brand Accelerator')).toBe(false);
		expect(isBeaconPackage(null)).toBe(false);
	});
});

describe('buildBoardRows', () => {
	it('joins the month row, the trend and the latest health onto the contract', () => {
		const [row] = buildBoardRows(
			[contract({})],
			[trend('recA', '2026-06-01', 13), trend('recA', '2026-07-01', 9), trend('recA', '2026-08-01', 6), trend('recA', '2026-09-01', 7, 5)],
			[{ airtable_contract_id: 'recA', total_score: '94' }],
			months, '2026-09', asOf,
		);
		expect(row.secured).toBe(7);
		expect(row.live).toBe(5);
		expect(row.goal).toBe(7);
		expect(row.pace).toBe('met');
		expect(row.pctOfGoal).toBe(100);
		expect(row.trend).toEqual([13, 9, 6, 7]);
		expect(row.health).toBe(94); // numeric arrives as a string from PostgREST
		expect(row.synced).toBe(true);
	});
	it('a contract with no mirror row this month reads as zero and unsynced, not absent', () => {
		const [row] = buildBoardRows([contract({})], [], [], months, '2026-09', asOf);
		expect(row.secured).toBe(0);
		expect(row.synced).toBe(false);
		expect(row.trend).toEqual([0, 0, 0, 0]);
		expect(row.goal).toBe(7); // falls back to the contract's current goal
		expect(row.pace).toBe('behind');
		expect(row.bucket).toBe('zero');
	});
	it('takes the goal of record from the month row, not the contract, when both exist', () => {
		const [row] = buildBoardRows([contract({ current_month_goal: 7 })], [trend('recA', '2026-09-01', 4, 0, 5)], [], months, '2026-09', asOf);
		expect(row.goal).toBe(5);
		expect(row.pace).toBe('onpace'); // 4 ≥ 3.5
	});
	it('no goal anywhere → nogoal with a null pct', () => {
		const [row] = buildBoardRows([contract({ current_month_goal: null, package: 'In Kind', package_family: 'Other' })], [trend('recA', '2026-09-01', 2, 0, null)], [], months, '2026-09', asOf);
		expect(row.pace).toBe('nogoal');
		expect(row.pctOfGoal).toBeNull();
	});
});

describe('sortBoardRows', () => {
	it('orders behind → zero → nogoal → onpace → met, worst pct first inside behind, then by name', () => {
		const rows = buildBoardRows(
			[
				contract({ contract_id: 'met', airtable_contract_id: 'r1', display_name: 'Met' }),
				contract({ contract_id: 'zero', airtable_contract_id: 'r2', display_name: 'Zero' }),
				contract({ contract_id: 'b2', airtable_contract_id: 'r3', display_name: 'Behind B' }),
				contract({ contract_id: 'nog', airtable_contract_id: 'r4', display_name: 'NoGoal', current_month_goal: null }),
				contract({ contract_id: 'on', airtable_contract_id: 'r5', display_name: 'OnPace' }),
				contract({ contract_id: 'b1', airtable_contract_id: 'r6', display_name: 'Behind A' }),
			],
			[
				trend('r1', '2026-09-01', 7), trend('r2', '2026-09-01', 0), trend('r3', '2026-09-01', 2),
				trend('r4', '2026-09-01', 3, 0, null), trend('r5', '2026-09-01', 5), trend('r6', '2026-09-01', 1),
			],
			[], months, '2026-09', asOf,
		);
		expect(sortBoardRows(rows).map((r) => r.contractId)).toEqual(['b1', 'b2', 'zero', 'nog', 'on', 'met']);
	});
});

describe('filterBoardRows / countBoardRows', () => {
	const rows = buildBoardRows(
		[
			contract({ contract_id: 'a', airtable_contract_id: 'r1' }),
			contract({ contract_id: 'b', airtable_contract_id: 'r2' }),
			contract({ contract_id: 'c', airtable_contract_id: 'r3', current_month_goal: null }),
		],
		[trend('r1', '2026-09-01', 7), trend('r2', '2026-09-01', 0), trend('r3', '2026-09-01', 0, 0, null)],
		[], months, '2026-09', asOf,
	);
	it('zero is a subset of behind, and all is everything', () => {
		expect(filterBoardRows(rows, 'all')).toHaveLength(3);
		expect(filterBoardRows(rows, 'behind').map((r) => r.contractId)).toEqual(['b']);
		expect(filterBoardRows(rows, 'zero').map((r) => r.contractId)).toEqual(['b']);
		expect(filterBoardRows(rows, 'nogoal').map((r) => r.contractId)).toEqual(['c']);
	});
	it('counts match the filters', () => {
		expect(countBoardRows(rows)).toEqual({ all: 3, behind: 1, zero: 1, nogoal: 1, onpace: 0, met: 1 });
	});
});
