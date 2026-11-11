import { describe, expect, it } from 'vitest';
import {
	BUSINESS_TZ,
	businessToday,
	formatCurrency,
	formatCurrencyPrecise,
	formatDate,
	formatMetricNumber,
	formatNumber,
	formatPercent,
} from './format';

// Pins the timezone class of bug: the app runs on Vercel in UTC but the
// company clock is America/Chicago, so anything deciding "today" or "this
// month" in UTC rolls over while HQ is still on the previous day —
// a Monday-morning report was filed under the wrong date, and month-boundary
// rollups double-counted.
//
// `now` is injected on purpose so these assertions never depend on the
// machine's clock or its local zone.

describe('businessToday', () => {
	it('stays on yesterday while Chicago is still on yesterday', () => {
		// 02:00 UTC = 21:00 the previous day in Chicago (CDT).
		expect(businessToday(new Date('2026-09-01T02:00:00Z'))).toBe('2026-08-31');
	});

	it('agrees with UTC once Chicago has caught up', () => {
		expect(businessToday(new Date('2026-09-01T12:00:00Z'))).toBe('2026-09-01');
	});

	it('resolves the day in the company zone, not UTC', () => {
		expect(BUSINESS_TZ).toBe('America/Chicago');
	});

	it('formats as YYYY-MM-DD', () => {
		expect(businessToday(new Date('2026-09-01T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('formatCurrency', () => {
	it('em-dashes nullish and NaN', () => {
		expect(formatCurrency(null)).toBe('—');
		expect(formatCurrency(undefined)).toBe('—');
		expect(formatCurrency(Number.NaN)).toBe('—');
	});

	it('renders whole dollars', () => {
		expect(formatCurrency(0)).toBe('$0');
		expect(formatCurrency(1500)).toBe('$1,500');
		expect(formatCurrency(1500.49)).toBe('$1,500');
		expect(formatCurrency(1500.5)).toBe('$1,501');
	});
});

describe('formatCurrencyPrecise', () => {
	it('keeps cents so small unit costs survive', () => {
		expect(formatCurrencyPrecise(1.234)).toBe('$1.23');
		expect(formatCurrencyPrecise(0)).toBe('$0.00');
		expect(formatCurrencyPrecise(1500)).toBe('$1,500.00');
	});

	it('em-dashes nullish and NaN', () => {
		expect(formatCurrencyPrecise(null)).toBe('—');
		expect(formatCurrencyPrecise(Number.NaN)).toBe('—');
	});
});

describe('formatNumber', () => {
	it('groups thousands', () => {
		expect(formatNumber(1234567)).toBe('1,234,567');
		expect(formatNumber(0)).toBe('0');
	});

	it('em-dashes nullish and NaN', () => {
		expect(formatNumber(null)).toBe('—');
		expect(formatNumber(undefined)).toBe('—');
		expect(formatNumber(Number.NaN)).toBe('—');
	});
});

describe('formatMetricNumber', () => {
	it('drops the decimal once the number is big enough for it to be noise', () => {
		expect(formatMetricNumber(567.6509965)).toBe('568');
		expect(formatMetricNumber(10)).toBe('10');
		expect(formatMetricNumber(10.4)).toBe('10');
	});

	it('keeps one decimal below 10', () => {
		expect(formatMetricNumber(2.428571)).toBe('2.4');
		expect(formatMetricNumber(9.99)).toBe('10');
		expect(formatMetricNumber(0)).toBe('0');
	});

	it('uses magnitude, not sign, to pick the precision', () => {
		expect(formatMetricNumber(-567.65)).toBe('-568');
		expect(formatMetricNumber(-2.44)).toBe('-2.4');
	});

	it('em-dashes nullish and NaN', () => {
		expect(formatMetricNumber(null)).toBe('—');
		expect(formatMetricNumber(Number.NaN)).toBe('—');
	});
});

describe('formatPercent', () => {
	it('renders a fraction with one decimal by default', () => {
		expect(formatPercent(0.856)).toBe('85.6%');
		expect(formatPercent(0.5)).toBe('50%');
		expect(formatPercent(0)).toBe('0%');
	});

	it('honours a digits argument', () => {
		expect(formatPercent(0.85678, 0)).toBe('86%');
		expect(formatPercent(0.85678, 2)).toBe('85.68%');
	});

	it('em-dashes nullish and NaN', () => {
		expect(formatPercent(null)).toBe('—');
		expect(formatPercent(Number.NaN)).toBe('—');
	});
});

describe('formatDate', () => {
	it('formats an ISO date', () => {
		expect(formatDate('2026-08-21')).toBe('Aug 21, 2026');
	});

	it('honours a custom format', () => {
		expect(formatDate('2026-08-21', 'yyyy-MM-dd')).toBe('2026-08-21');
	});

	it('em-dashes nullish and empty input', () => {
		expect(formatDate(null)).toBe('—');
		expect(formatDate(undefined)).toBe('—');
		expect(formatDate('')).toBe('—');
	});

	it('returns a malformed string rather than throwing', () => {
		expect(() => formatDate('not a date')).not.toThrow();
		expect(formatDate('not a date')).toBe('not a date');
	});
});
