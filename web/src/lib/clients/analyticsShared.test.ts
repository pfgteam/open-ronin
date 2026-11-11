import { describe, expect, it } from 'vitest';
import { alignToMonths, csvCell, monthLabel, toCsv, trendMonths } from './analyticsShared';

describe('trendMonths', () => {
	it('gives twelve first of month dates ending in the current month', () => {
		const m = trendMonths(new Date(2026, 8, 12));
		expect(m).toHaveLength(12);
		expect(m[0]).toBe('2025-10-01');
		expect(m[11]).toBe('2026-09-01');
	});
	it('crosses a year boundary without skipping', () => {
		expect(trendMonths(new Date(2026, 0, 31), 3)).toEqual(['2025-11-01', '2025-12-01', '2026-01-01']);
	});
});

describe('alignToMonths', () => {
	it('leaves null where the mirror has no row', () => {
		const out = alignToMonths([{ month: '2026-02-01', v: 1 }], ['2026-01-01', '2026-02-01', '2026-03-01']);
		expect(out).toEqual([null, { month: '2026-02-01', v: 1 }, null]);
	});
});

describe('monthLabel', () => {
	it('formats without timezone drift', () => {
		expect(monthLabel('2026-03-01')).toBe('Mar 26');
	});
});

describe('csv', () => {
	it('quotes commas and doubles quotes', () => {
		expect(csvCell('Gruppo, "Polar" Joe')).toBe('"Gruppo, ""Polar"" Joe"');
	});
	it('defuses spreadsheet formulas', () => {
		expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
		expect(csvCell('-5')).toBe("'-5");
	});
	it('renders null as empty and numbers plainly', () => {
		expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n');
	});
});
