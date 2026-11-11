import { describe, expect, it } from 'vitest';
import {
	describeTimeframe,
	isValidTimeframe,
	monthOptions,
	quarterLabel,
	quarterNameFromValue,
	weekOptions,
	yearOptions,
} from './timeframe';

const quarters = [
	{ id: 'a', name: '26-3', year: 2026, quarter: 3, starts_on: '2026-07-01' },
	{ id: 'b', name: '26-2', year: 2026, quarter: 2, starts_on: '2026-04-01' },
];

describe('timeframe vocabulary', () => {
	it('labels quarters as Qn YYYY and falls back to the raw name', () => {
		expect(quarterLabel(quarters[0])).toBe('Q3 2026');
		expect(quarterLabel({ id: 'x', name: '27-1' })).toBe('Q1 2027');
	});

	it('offers years spanning the quarters plus one either side', () => {
		const ys = yearOptions(quarters, new Date('2026-09-14')).map((o) => o.value);
		expect(ys[0]).toBe('2027');
		expect(ys[ys.length - 1]).toBe('2025');
	});

	it('offers 12 months per year, newest first', () => {
		const ms = monthOptions(quarters, new Date('2026-09-14'));
		expect(ms[0]).toEqual({ value: '2027-12', label: 'December 2027' });
		expect(ms.filter((m) => m.value.startsWith('2026-'))).toHaveLength(12);
	});

	it('offers weeks 1-13 per 12WY quarter, never calendar weeks', () => {
		const ws = weekOptions(quarters);
		expect(ws[0].group).toBe('Q3 2026');
		expect(ws[0].options).toHaveLength(13);
		expect(ws[0].options[4]).toEqual({ value: '26-3:W5', label: 'Week 5 · Q3 2026' });
	});

	it('extracts the quarter name from quarter and week values only', () => {
		expect(quarterNameFromValue('quarter', '26-3')).toBe('26-3');
		expect(quarterNameFromValue('week', '26-3:W5')).toBe('26-3');
		expect(quarterNameFromValue('month', '2026-09')).toBeNull();
		expect(quarterNameFromValue('', '')).toBeNull();
	});

	it('validates each grain against the 0080 check-constraint patterns', () => {
		expect(isValidTimeframe('year', '2026')).toBe(true);
		expect(isValidTimeframe('quarter', '26-3')).toBe(true);
		expect(isValidTimeframe('quarter', '26-5')).toBe(false);
		expect(isValidTimeframe('month', '2026-13')).toBe(false);
		expect(isValidTimeframe('week', '26-3:W13')).toBe(true);
		expect(isValidTimeframe('week', '26-3:W14')).toBe(false);
		expect(isValidTimeframe('day', '2026-09-14')).toBe(true);
		expect(isValidTimeframe('', '')).toBe(true);
		expect(isValidTimeframe('year', '')).toBe(false);
	});

	it('describes stored pairs for display', () => {
		expect(describeTimeframe('week', '26-3:W5', quarters)).toBe('Week 5 · Q3 2026');
		expect(describeTimeframe('month', '2026-09')).toBe('September 2026');
		expect(describeTimeframe(null, null)).toBeNull();
	});
});
