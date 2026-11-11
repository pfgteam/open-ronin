import { describe, expect, it } from 'vitest';
import { assessedQuarterFor, boxOf, computeTotals, distribution, gridCell, nextRound, roundOpen, suggestOutcome } from './shared';

describe('assessed quarter (the one that just ended)', () => {
	const quarters = [
		{ id: 'q264', name: '26-4', starts_on: '2026-10-01' },
		{ id: 'q263', name: '26-3', starts_on: '2026-07-01' },
		{ id: 'q262', name: '26-2', starts_on: '2026-04-01' },
		{ id: 'q261', name: '26-1', starts_on: '2026-01-01' },
		{ id: 'q271', name: '27-1', starts_on: '2027-01-01' },
		{ id: 'none', name: 'undated', starts_on: null },
	];

	it('in October picks 26-3, not the calendar quarter 26-4', () => {
		expect(assessedQuarterFor(quarters, new Date('2026-10-02T12:00:00Z'))?.id).toBe('q263');
	});

	it('in April picks 26-1 and in late June still 26-1', () => {
		expect(assessedQuarterFor(quarters, new Date('2026-04-03T12:00:00Z'))?.id).toBe('q261');
		expect(assessedQuarterFor(quarters, new Date('2026-06-30T12:00:00Z'))?.id).toBe('q261');
	});

	it('on the first day of a quarter already looks back', () => {
		expect(assessedQuarterFor(quarters, new Date('2026-07-01T12:00:00Z'))?.id).toBe('q262');
	});

	it('falls back to the only started quarter, or null when none has', () => {
		expect(assessedQuarterFor(quarters, new Date('2026-02-01T12:00:00Z'))?.id).toBe('q261');
		expect(assessedQuarterFor(quarters, new Date('2025-02-01T12:00:00Z'))).toBeNull();
		expect(assessedQuarterFor([], new Date('2026-10-02T12:00:00Z'))).toBeNull();
	});
});

describe('calibration sequence', () => {
	it('starts at self, then leader, then exec, then done', () => {
		expect(nextRound([])).toBe('self');
		expect(nextRound([{ round: 'self', submitted_at: 'x' }])).toBe('leader');
		expect(nextRound([{ round: 'self', submitted_at: 'x' }, { round: 'leader', submitted_at: 'x' }])).toBe('exec');
		expect(nextRound([
			{ round: 'self', submitted_at: 'x' },
			{ round: 'leader', submitted_at: 'x' },
			{ round: 'exec', submitted_at: 'x' },
		])).toBe('done');
	});

	it('does not let a draft count as submitted', () => {
		expect(nextRound([{ round: 'self', submitted_at: null }])).toBe('self');
		expect(roundOpen('leader', [{ round: 'self', submitted_at: null }])).toBe(false);
		expect(roundOpen('leader', [{ round: 'self', submitted_at: 'x' }])).toBe(true);
	});

	it('maps performance x potential to boxes 1..9 (legacy rows)', () => {
		expect(boxOf(1, 1)).toBe(1);
		expect(boxOf(3, 1)).toBe(3);
		expect(boxOf(1, 3)).toBe(7);
		expect(boxOf(3, 3)).toBe(9);
	});
});

// The 15-question seed shape (weights only; ids are the keys).
const Q = [
	...['transparency', 'obsessed', 'leadership', 'growth', 'intentionality', 'execution', 'teamwork'].map((k) => ({ id: k, group_key: 'core' as const, weight: 5 })),
	{ id: 'metrics', group_key: 'performance' as const, weight: 10 },
	{ id: 'impact', group_key: 'performance' as const, weight: 10 },
	{ id: 'initiative', group_key: 'performance' as const, weight: 10 },
	{ id: 'projects', group_key: 'performance' as const, weight: 10 },
	{ id: 'timelines', group_key: 'performance' as const, weight: 5 },
	{ id: 'four_r', group_key: 'professional' as const, weight: 10 },
	{ id: 'communication', group_key: 'professional' as const, weight: 5 },
	{ id: 'book', group_key: 'professional' as const, weight: 5 },
];
const all = (r: number) => Q.map((q) => ({ cycle_question_id: q.id, rating: r }));

describe('scorecard totals', () => {
	it('weights sum to 100 split 35 / 45 / 20', () => {
		const t = computeTotals(Q, all(5));
		expect(t).toMatchObject({ total: 100, core: 35, performance: 45, professional: 20, answered: 15, expected: 15 });
	});

	it('rating / 5 x weight, same as the SQL', () => {
		expect(computeTotals(Q, all(3))).toMatchObject({ total: 60, core: 21, performance: 27, professional: 12 });
		expect(computeTotals(Q, all(0)).total).toBe(0);
	});

	it('skips unanswered questions and reports the gap', () => {
		const t = computeTotals(Q, all(4).slice(0, 14));
		expect(t.answered).toBe(14);
		expect(t.expected).toBe(15);
	});

	it('rounds to two places', () => {
		const t = computeTotals(Q, [{ cycle_question_id: 'metrics', rating: 1 }, { cycle_question_id: 'book', rating: 1 }]);
		expect(t.performance).toBe(2);
		expect(t.professional).toBe(1);
		expect(t.total).toBe(3);
	});
});

describe('vantage point grid', () => {
	it('strong results + strong behaviors -> recognize', () => {
		expect(suggestOutcome({ performance_total: 40, core_total: 30, total: 85 })).toBe('recognize');
		expect(gridCell({ performance_total: 40, core_total: 30, total: 85 })).toEqual({ results: 'strong', behaviors: 'strong' });
	});

	it('strong results + damaging behaviors -> coach', () => {
		expect(suggestOutcome({ performance_total: 40, core_total: 15, total: 65 })).toBe('coach');
		expect(gridCell({ performance_total: 40, core_total: 15, total: 65 }).behaviors).toBe('damaging');
	});

	it('weak results with clear improvement -> develop (uses the previous quarter)', () => {
		expect(suggestOutcome({ performance_total: 20, core_total: 25, total: 55, previous_total: 40 })).toBe('develop');
	});

	it('weak results without an improvement signal still suggests develop (exec decides the rest)', () => {
		expect(suggestOutcome({ performance_total: 20, core_total: 25, total: 55, previous_total: 58 })).toBe('develop');
		expect(suggestOutcome({ performance_total: 20, core_total: 25, total: 55 })).toBe('develop');
	});

	it('thresholds scale with the cycle weights', () => {
		expect(suggestOutcome({ performance_total: 7, core_total: 7, total: 14, max: { performance: 10, core: 10 } })).toBe('recognize');
	});
});

describe('score distribution by leader', () => {
	it('bell-shaped around the company mean is clean', () => {
		const d = distribution([55, 62, 70, 78, 85], 70);
		expect(d.flags).toEqual([]);
		expect(d.n).toBe(5);
		expect(d.mean).toBe(70);
		expect(d.histogram.reduce((a, b) => a + b, 0)).toBe(5);
		expect(d.histogram[5]).toBe(1); // 55
		expect(d.histogram[8]).toBe(1); // 85
	});

	it('flags a leader who scores everyone high', () => {
		expect(distribution([88, 92, 95], 70).flags).toContain('skewed_high');
	});

	it('flags a leader who scores everyone low', () => {
		expect(distribution([40, 45, 50], 70).flags).toContain('skewed_low');
	});

	it('flags too little spread', () => {
		expect(distribution([70, 70, 71], 70).flags).toEqual(['narrow']);
	});

	it('does not flag a single score', () => {
		expect(distribution([95], 70).flags).toEqual([]);
		expect(distribution([], 70)).toMatchObject({ n: 0, flags: [] });
	});

	it('buckets 100 into the top bar', () => {
		expect(distribution([100], 70).histogram[9]).toBe(1);
	});
});
