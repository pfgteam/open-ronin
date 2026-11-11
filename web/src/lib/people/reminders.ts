// Check-in reminder scheduling — PURE functions (PEOPLE_PLAN 9.6 step 5).
//
// The cron runs HOURLY in UTC (vercel.json). Vercel has no timezone support,
// and the company lives in America/Chicago, which shifts by an hour twice a
// year — so the schedule stays coarse and the decision of "is this the right
// moment?" lives here, fed by company_local_parts() from SQL.
//
// Running 24x a day is only safe because every send is guarded by a
// deterministic dedupe_key (migration 0039): the extra invocations insert
// nothing. That also makes the job self-healing — if the 10am run fails, the
// 11am run sends what is still missing and skips whoever already got it.

/** Local hour (company timezone) the Monday chase aims for. */
export const REMINDER_HOUR = 9;

/**
 * Local hour for the Friday nudge. The week OPENS at 9:15 (0065,
 * checkin_opens_at), and the cron ticks at :00 — a 9 o'clock nudge would
 * link people to a form that says "opens at 9:15". 10 is the first tick
 * after opening.
 */
export const FRIDAY_REMINDER_HOUR = 10;

/** Day-of-week numbers, matching SQL extract(dow) and JS getUTCDay(). */
const MONDAY = 1;
const FRIDAY = 5;

export type NudgeKind = 'friday' | 'monday';

export interface LocalParts {
	/** 0-23 in company timezone. */
	localHour: number;
	/** 0 = Sunday .. 6 = Saturday, in company timezone. */
	localDow: number;
}

export interface DueNudge {
	kind: NudgeKind;
	/**
	 * Which reporting week the nudge is about, relative to the CURRENT week:
	 *   0  = the week ending today (Friday: "open now")
	 *  -1  = the week that just closed (Monday: "still missing")
	 */
	weekOffset: 0 | -1;
}

/**
 * Which nudge, if any, is due right now.
 *
 * Friday mid-morning nudges the week ending that same day, once it has
 * opened; Monday morning chases the week that just closed. Every other hour
 * of the week sends nothing — a reminder people expect is a reminder they
 * read, and one they get at random hours is one they mute.
 */
export function dueNudge({ localHour, localDow }: LocalParts): DueNudge | null {
	if (localDow === FRIDAY && localHour === FRIDAY_REMINDER_HOUR) return { kind: 'friday', weekOffset: 0 };
	if (localDow === MONDAY && localHour === REMINDER_HOUR) return { kind: 'monday', weekOffset: -1 };
	return null;
}

/**
 * The idempotency key for one nudge to one person.
 *
 * DETERMINISTIC BY CONSTRUCTION: it names the reporting week and the nudge,
 * nothing about when the job ran. That is the whole point — a key built from
 * now() or a uuid would differ on every re-run and the unique index would
 * never fire, so the guard would be decorative. The user is scoped by the
 * unique index on (user_id, dedupe_key), so it stays out of the string.
 */
export function reminderDedupeKey(weekEnd: string, kind: NudgeKind): string {
	return `checkin-reminder:${weekEnd}:${kind}`;
}

/** Copy for the bell. States the fact and links straight to the form. */
export function reminderCopy(kind: NudgeKind, weekLabel: string): { title: string; body: string } {
	return kind === 'friday'
		? {
				title: 'Your weekly check-in is open — due today',
				body: `The week ${weekLabel} is open for your check-in. It takes a couple of minutes, and you can edit it later.`,
			}
		: {
				title: 'Last week’s check-in is still missing',
				body: `The week ${weekLabel} has closed. You can still fill it in.`,
			};
}
