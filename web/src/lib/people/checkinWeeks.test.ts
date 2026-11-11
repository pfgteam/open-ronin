import { describe, expect, it } from 'vitest';
import {
	OPEN_PRIOR_WEEKS,
	OPENS_AT_LABEL,
	closesOn,
	currentWeekNotOpenYet,
	formatFridayAtOpening,
	formatWeekEnding,
	formatWeekRange,
	lastCompletedWeekEnd,
	openWeeks,
	recentWeeks,
	shiftWeeks,
	weekStart,
} from './checkinWeeks';

// 2026-08-21 is a Friday. A reporting week runs Saturday -> Friday and is
// named by the Friday. Every helper does whole-day UTC arithmetic, so none of
// these assertions may depend on the machine's timezone.
const FRIDAY = '2026-08-21';

describe('week math', () => {
	it('shifts by whole weeks in both directions', () => {
		expect(shiftWeeks(FRIDAY, -1)).toBe('2026-08-14');
		expect(shiftWeeks(FRIDAY, 1)).toBe('2026-08-28');
		expect(shiftWeeks(FRIDAY, 0)).toBe(FRIDAY);
	});

	it('stays on Friday across a month boundary', () => {
		expect(shiftWeeks('2026-08-07', -1)).toBe('2026-07-31');
	});

	it('stays on Friday across a year boundary', () => {
		expect(shiftWeeks('2027-01-01', -1)).toBe('2026-12-25');
	});

	it('starts the week on the Saturday six days earlier', () => {
		expect(weekStart(FRIDAY)).toBe('2026-08-15');
		// Sanity: that day really is a Saturday in UTC.
		expect(new Date('2026-08-15T00:00:00Z').getUTCDay()).toBe(6);
	});

	it('offers the current week plus OPEN_PRIOR_WEEKS, newest first', () => {
		const weeks = openWeeks(FRIDAY);
		expect(weeks).toHaveLength(OPEN_PRIOR_WEEKS + 1);
		expect(weeks[0]).toBe(FRIDAY);
		expect(weeks).toEqual(['2026-08-21', '2026-08-14', '2026-08-07']);
	});

	it('names the last completed week as the one before the current', () => {
		expect(lastCompletedWeekEnd(FRIDAY)).toBe('2026-08-14');
	});

	it('builds a contiguous newest-first run of recent weeks', () => {
		const weeks = recentWeeks(FRIDAY, 4);
		expect(weeks).toEqual(['2026-08-21', '2026-08-14', '2026-08-07', '2026-07-31']);
		// Contiguity matters: the attention-signal rules assume no gaps.
		for (let i = 1; i < weeks.length; i++) {
			expect(shiftWeeks(weeks[i - 1], -1)).toBe(weeks[i]);
		}
	});
});

describe('week labels', () => {
	it('formats a range inside one month', () => {
		expect(formatWeekRange(FRIDAY)).toBe('Aug 15 – 21, 2026');
	});

	it('formats a range spanning two months', () => {
		expect(formatWeekRange('2026-08-01')).toBe('Jul 26 – Aug 1, 2026');
	});

	it('formats the short "week ending" label', () => {
		expect(formatWeekEnding(FRIDAY)).toBe('week ending Aug 21');
	});
});

// 0065: a week opens on its Friday at 9:15 AM Central and stays editable
// until OPEN_PRIOR_WEEKS more Fridays have opened. SQL decides which week is
// the latest OPEN one; these helpers only derive the rest from that date.
describe('open window (0065)', () => {
	it('knows the current week has not opened when SQL says the latest open one is older', () => {
		expect(currentWeekNotOpenYet({ currentWeekEnd: '2026-09-18', latestOpenWeekEnd: '2026-09-11' })).toBe(true);
		expect(currentWeekNotOpenYet({ currentWeekEnd: '2026-09-18', latestOpenWeekEnd: '2026-09-18' })).toBe(false);
	});

	it('offers only OPEN weeks when fed the latest open week, never the pending current one', () => {
		// Wednesday Sep 16: current week ends Sep 18 but has not opened.
		const weeks = openWeeks('2026-09-11');
		expect(weeks).toEqual(['2026-09-11', '2026-09-04', '2026-08-28']);
		expect(weeks).not.toContain('2026-09-18');
	});

	it('closes a week when the (OPEN_PRIOR_WEEKS + 1)th later Friday opens — matching checkin_week_is_open', () => {
		// Week ending Aug 21 is open while the latest open week is Aug 21, 28 or
		// Sep 4; the Sep 11 opening shuts it.
		expect(closesOn('2026-08-21')).toBe('2026-09-11');
		for (const latest of ['2026-08-21', '2026-08-28', '2026-09-04']) {
			expect(openWeeks(latest)).toContain('2026-08-21');
		}
		expect(openWeeks('2026-09-11')).not.toContain('2026-08-21');
		expect(OPEN_PRIOR_WEEKS).toBe(2);
	});

	it('spells the opening moment as people say it, in Central time, AM not PM', () => {
		expect(OPENS_AT_LABEL).toBe('9:15 AM Central');
		expect(OPENS_AT_LABEL).not.toMatch(/PM/);
		expect(formatFridayAtOpening('2026-09-18')).toBe('Friday, Sep 18 at 9:15 AM Central');
	});
});
