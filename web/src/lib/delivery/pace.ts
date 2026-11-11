// Pace = where a contract's secured count stands against a linear burn of
// its monthly goal. Pure so the board and the tab agree and the tests need
// no clock. The business day is resolved in BUSINESS_TZ via businessToday();
// Vercel runs UTC and HQ's evening would otherwise read as tomorrow.

import { getDaysInMonth } from 'date-fns';
import { businessToday } from '@/lib/format';

export type Pace = 'met' | 'onpace' | 'behind' | 'nogoal';

/** `YYYY-MM-DD` in BUSINESS_TZ → { year, month (1-12), day } */
function businessParts(asOf: Date): { year: number; month: number; day: number } {
	const [y, m, d] = businessToday(asOf).split('-').map(Number);
	return { year: y, month: m, day: d };
}

/** Fraction of the month elapsed, 1/days on the 1st and exactly 1 on the last day. */
export function monthProgress(asOf: Date): number {
	const { year, month, day } = businessParts(asOf);
	const days = getDaysInMonth(new Date(year, month - 1, 1));
	return day / days;
}

/** How many secured opps a linear burn of `goal` expects by `asOf`. */
export function expectedByNow(goal: number, asOf: Date): number {
	return goal * monthProgress(asOf);
}

export function paceOf(secured: number, goal: number | null, asOf: Date): Pace {
	if (goal == null || goal <= 0) return 'nogoal';
	if (secured >= goal) return 'met';
	// Strictly below expected is behind; on the last day expected == goal, so
	// a finished month can only be met or behind.
	return secured >= expectedByNow(goal, asOf) ? 'onpace' : 'behind';
}

/**
 * The instant to judge a month by: now for the current month, its last day
 * for a past month, its first day for a future one. `month` is `YYYY-MM`.
 */
export function asOfForMonth(month: string, now: Date): Date {
	const current = businessToday(now).slice(0, 7);
	if (month === current) return now;
	const [y, m] = month.split('-').map(Number);
	if (month < current) {
		// Noon on the last day, in UTC — safely the same calendar day in Chicago.
		return new Date(Date.UTC(y, m - 1, getDaysInMonth(new Date(y, m - 1, 1)), 12));
	}
	return new Date(Date.UTC(y, m - 1, 1, 12));
}
