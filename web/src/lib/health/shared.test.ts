import { describe, expect, it } from 'vitest';
import { FACTOR_KEYS, currentMonthKey, factorViews, healthTone, pickClientHealth, scoreNumber, type HealthScoreRow } from './shared';

const NOW = new Date('2026-09-19T12:00:00Z');

function row(rec: string, month: string, score: number | string | null, measured: string[] = ['payment_timeliness']): HealthScoreRow {
	const factors: Record<string, { measured: boolean; value: number | null; weight_pct: number; note?: string | null }> = {};
	for (const k of FACTOR_KEYS) {
		const m = measured.includes(k);
		factors[k] = { measured: m, value: m ? 100 : null, weight_pct: 10, note: m ? null : `no ${k} data` };
	}
	return {
		airtable_contract_id: rec,
		period_month: month,
		total_score: score,
		computed_at: '2026-09-19T09:30:00Z',
		factor_breakdown: { factors, coverage: { measured_count: measured.length, total_count: 6, weight_measured_pct: measured.length * 10 } },
	};
}

describe('scoreNumber / currentMonthKey / healthTone', () => {
	it('accepts PostgREST numeric strings and rejects junk', () => {
		expect(scoreNumber('100')).toBe(100);
		expect(scoreNumber(72.5)).toBe(72.5);
		expect(scoreNumber(null)).toBeNull();
		expect(scoreNumber('n/a')).toBeNull();
	});
	it('keys the current month as YYYY-MM-01 in UTC', () => {
		expect(currentMonthKey(NOW)).toBe('2026-09-01');
	});
	it('bands 75+ healthy, 50+ watch, below at risk', () => {
		expect(healthTone(90)).toBe('success');
		expect(healthTone(60)).toBe('warning');
		expect(healthTone(10)).toBe('danger');
		expect(healthTone(null)).toBe('default');
	});
});

describe('factorViews', () => {
	it('renders all six factors in engine order, merging the engine cell with the static meta', () => {
		const views = factorViews(row('recX', '2026-09-01', 100, ['payment_timeliness', 'opps_vs_goal']).factor_breakdown);
		expect(views.map((v) => v.key)).toEqual(FACTOR_KEYS);
		const pay = views.find((v) => v.key === 'payment_timeliness')!;
		expect(pay.measured).toBe(true);
		expect(pay.value).toBe(100);
		const eng = views.find((v) => v.key === 'engagement')!;
		expect(eng.measured).toBe(false);
		expect(eng.note).toBe('no engagement data');
		expect(eng.pending).toMatch(/ingest\/health\/engagement/);
		expect(views.find((v) => v.key === 'quality_of_opp')!.future).toBe(true);
	});
	it('falls back to default weights and unmeasured when there is no breakdown', () => {
		const views = factorViews(null);
		expect(views.every((v) => !v.measured)).toBe(true);
		expect(views.reduce((s, v) => s + v.weight_pct, 0)).toBe(100);
	});
	it('a measured cell with a null value is not measured', () => {
		const b = row('recX', '2026-09-01', null).factor_breakdown!;
		b.factors.payment_timeliness = { measured: true, value: null, weight_pct: 15 };
		expect(factorViews(b).find((v) => v.key === 'payment_timeliness')!.measured).toBe(false);
	});
});

describe('pickClientHealth', () => {
	it('prefers the primary contract\u2019s current-month row', () => {
		const h = pickClientHealth(
			[row('recOLD', '2026-09-01', 40), row('recPRI', '2026-08-01', 70), row('recPRI', '2026-09-01', '85')],
			'recPRI',
			NOW,
		);
		expect(h?.airtable_contract_id).toBe('recPRI');
		expect(h?.period_month).toBe('2026-09-01');
		expect(h?.is_current_month).toBe(true);
		expect(h?.total_score).toBe(85);
		expect(h?.coverage?.measured_count).toBe(1);
		expect(h?.factors).toHaveLength(6);
	});
	it('falls back to the primary\u2019s latest month, flagged as not current', () => {
		const h = pickClientHealth([row('recPRI', '2026-07-01', 70), row('recPRI', '2026-08-01', 72)], 'recPRI', NOW);
		expect(h?.period_month).toBe('2026-08-01');
		expect(h?.is_current_month).toBe(false);
	});
	it('falls back to any contract\u2019s latest row when the primary has none', () => {
		const h = pickClientHealth([row('recOLD', '2026-06-01', 55), row('recOLD', '2026-09-01', 60)], 'recPRI', NOW);
		expect(h?.airtable_contract_id).toBe('recOLD');
		expect(h?.period_month).toBe('2026-09-01');
	});
	it('returns null with no rows', () => {
		expect(pickClientHealth([], 'recPRI', NOW)).toBeNull();
	});
});
