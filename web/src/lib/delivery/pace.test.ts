import { describe, expect, it } from 'vitest';
import { asOfForMonth, expectedByNow, monthProgress, paceOf } from './pace';

// All instants are noon UTC so BUSINESS_TZ (America/Chicago) resolves to the
// same calendar day — the tests are about day arithmetic, not zone edges.
const sep21 = new Date('2026-09-21T12:00:00Z');
const sep1 = new Date('2026-09-01T12:00:00Z');
const sep30 = new Date('2026-09-30T12:00:00Z');
const feb28 = new Date('2026-02-28T12:00:00Z');

describe('monthProgress', () => {
	it('is day over days-in-month', () => {
		expect(monthProgress(sep21)).toBeCloseTo(21 / 30, 6);
		expect(monthProgress(sep1)).toBeCloseTo(1 / 30, 6);
		expect(monthProgress(sep30)).toBe(1);
	});
	it('knows February', () => {
		expect(monthProgress(feb28)).toBe(1);
	});
});

describe('expectedByNow', () => {
	it('scales the goal linearly', () => {
		expect(expectedByNow(10, sep21)).toBeCloseTo(7, 6);
		expect(expectedByNow(7, sep30)).toBe(7);
	});
});

describe('paceOf', () => {
	it('met when secured reaches the goal, whatever the day', () => {
		expect(paceOf(7, 7, sep1)).toBe('met');
		expect(paceOf(30, 7, sep21)).toBe('met');
	});
	it('on pace when at or above the expected count', () => {
		// 21/30 of 10 = 7 → 7 is on pace, 6 is behind
		expect(paceOf(7, 10, sep21)).toBe('onpace');
		expect(paceOf(6, 10, sep21)).toBe('behind');
	});
	it('zero secured on day one is still behind — the bar has to start somewhere honest', () => {
		expect(paceOf(0, 5, sep1)).toBe('behind');
	});
	it('no goal when goal is null or zero', () => {
		expect(paceOf(3, null, sep21)).toBe('nogoal');
		expect(paceOf(3, 0, sep21)).toBe('nogoal');
	});
	it('a finished month has no on-pace state', () => {
		expect(paceOf(6, 7, sep30)).toBe('behind');
		expect(paceOf(7, 7, sep30)).toBe('met');
	});
});

describe('asOfForMonth', () => {
	it('is now for the current month', () => {
		expect(asOfForMonth('2026-09', sep21)).toEqual(sep21);
	});
	it('is the last day for a past month', () => {
		expect(monthProgress(asOfForMonth('2026-08', sep21))).toBe(1);
	});
	it('is the first day for a future month', () => {
		expect(monthProgress(asOfForMonth('2026-10', sep21))).toBeCloseTo(1 / 31, 6);
	});
});
