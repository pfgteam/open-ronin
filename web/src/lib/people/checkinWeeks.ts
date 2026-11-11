// Reporting-week helpers for the weekly check-in (migrations 0035 + 0065).
//
// The timezone-sensitive decisions — WHICH Friday is "this week" and WHETHER
// it has opened yet (Friday 09:15 America/Chicago) — stay in SQL
// (public.checkin_window(), which reads company_timezone()). The helpers
// here only do whole-day arithmetic on a YYYY-MM-DD string, which cannot
// drift: everything is parsed and formatted in UTC, never in the server's or
// the browser's local zone.
//
// A reporting week runs SATURDAY -> FRIDAY and is named by the Friday
// (Sam, 19/08/2026), matching the old Airtable "week ending" vocabulary.
// It OPENS for writing on that Friday at 09:15 company time (Alex,
// 12/09/2026) and stays open — editable, submitted or not — until
// OPEN_PRIOR_WEEKS more Fridays have opened after it.

/** How many past weeks stay open for a late check-in or an edit, besides the
 * latest open one. Mirrors public.checkin_open_prior_weeks() (0065). */
export const OPEN_PRIOR_WEEKS = 2;

/** Wall-clock opening time in the company zone, as people say it. The zone
 * is America/Chicago (company_timezone()), so this is CDT in summer and CST
 * in winter — "Central" is the honest label for both. */
export const OPENS_AT_LABEL = '9:15 AM Central';

/** What SQL's checkin_window() hands back, normalised to plain strings. */
export interface CheckinWindow {
	/** The reporting week we are inside right now (its Friday), open or not. */
	currentWeekEnd: string;
	/** The newest week whose Friday 09:15 has passed — the form defaults here. */
	latestOpenWeekEnd: string;
}

function parseUtc(day: string): Date {
	return new Date(`${day}T00:00:00Z`);
}

function toDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export function shiftWeeks(weekEnd: string, weeks: number): string {
	const d = parseUtc(weekEnd);
	d.setUTCDate(d.getUTCDate() + weeks * 7);
	return toDay(d);
}

/**
 * The weeks a person may still write, newest first: the latest OPEN week
 * plus OPEN_PRIOR_WEEKS before it. The server action validates against this
 * same list, so the form can never offer a week the write would reject.
 * Pass `latestOpenWeekEnd` from checkin_window() — NOT the current week,
 * which before Friday 09:15 has not opened yet.
 */
export function openWeeks(latestOpenWeekEnd: string): string[] {
	return Array.from({ length: OPEN_PRIOR_WEEKS + 1 }, (_, i) => shiftWeeks(latestOpenWeekEnd, -i));
}

/** True when the week we are inside has not reached its Friday 09:15 yet. */
export function currentWeekNotOpenYet(window: CheckinWindow): boolean {
	return window.currentWeekEnd > window.latestOpenWeekEnd;
}

/**
 * The Friday whose 09:15 opening CLOSES the week ending `weekEnd`: the
 * (OPEN_PRIOR_WEEKS + 1)th Friday after it. Same arithmetic as
 * checkin_week_is_open() in SQL, used only for the "editable until" copy.
 */
export function closesOn(weekEnd: string): string {
	return shiftWeeks(weekEnd, OPEN_PRIOR_WEEKS + 1);
}

/** Saturday that starts the week ending on `weekEnd`. */
export function weekStart(weekEnd: string): string {
	const d = parseUtc(weekEnd);
	d.setUTCDate(d.getUTCDate() - 6);
	return toDay(d);
}

const MONTH = { month: 'short', timeZone: 'UTC' } as const;

/** "Aug 15 – 21, 2026", or "Jul 27 – Aug 2, 2026" across a month boundary. */
export function formatWeekRange(weekEnd: string): string {
	const end = parseUtc(weekEnd);
	const start = parseUtc(weekStart(weekEnd));
	const endMonth = end.toLocaleDateString('en-US', MONTH);
	const startMonth = start.toLocaleDateString('en-US', MONTH);
	const startDay = start.getUTCDate();
	const endDay = end.getUTCDate();
	const year = end.getUTCFullYear();
	return startMonth === endMonth
		? `${startMonth} ${startDay} – ${endDay}, ${year}`
		: `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
}

/** "week ending Aug 21" — the short label for lists and banners. */
export function formatWeekEnding(weekEnd: string): string {
	const end = parseUtc(weekEnd);
	return `week ending ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** "Friday, Sep 18 at 9:15 AM Central" — when a week's check-in opens (or,
 * for closesOn(week), when its edit window shuts). The date is a Friday by
 * construction and the time is the company wall clock, so no zone math. */
export function formatFridayAtOpening(friday: string): string {
	const d = parseUtc(friday);
	const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
	return `${day} at ${OPENS_AT_LABEL}`;
}

/**
 * The most recently COMPLETED reporting week: the one before the current one.
 * The manager Team view defaults here — reviewing "this week" mid-week mostly
 * shows people who simply haven't gotten to Friday yet.
 */
export function lastCompletedWeekEnd(currentWeekEnd: string): string {
	return shiftWeeks(currentWeekEnd, -1);
}

/** The last `count` reporting weeks including the current one, newest first —
 * the manager view's period picker. */
export function recentWeeks(currentWeekEnd: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => shiftWeeks(currentWeekEnd, -i));
}
