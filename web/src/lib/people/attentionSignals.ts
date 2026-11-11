// Attention signals for the weekly check-in (PEOPLE_PLAN section 9.6 step 4).
//
// PURE functions, no I/O — the caller passes a contiguous calendar series of
// weeks and gets flags back. That is deliberate: these rules decide whether a
// manager's attention gets pointed at a person, so they must be testable
// without a database. See attentionSignals.test.ts.
//
// Three rules, each with a named threshold:
//   1. lowLatest        — the most recent week WITH data sits below LOW_SCORE.
//   2. strugglingStreak — STREAK_WEEKS or more CONSECUTIVE weeks below
//                         LOW_SCORE. A MISSING week BREAKS the streak; it is
//                         not a low score and must never be treated as one.
//   3. decliningTrend   — the recent window averages at least MIN_DROP below
//                         the previous window of equal length.
//
// Language rule (spec): the UI says "Needs attention" and states the fact
// ("3 weeks below 2.5"). It never diagnoses a person.

/** Average at or below this is "struggling" on a 1-5 scale. */
export const LOW_SCORE = 2.5;
/** Consecutive low weeks before the streak rule fires. */
export const STREAK_WEEKS = 2;
/** Window size (weeks) for each side of the trend comparison. */
export const TREND_WINDOW = 4;
/** How much the recent window must fall below the previous one to count. */
export const MIN_DROP = 0.75;
/** Weeks with data required in BOTH windows before a trend is claimed. */
export const MIN_TREND_POINTS = 2;

export interface WeekPoint {
	/** The Friday naming the reporting week (YYYY-MM-DD). */
	weekEnd: string;
	/** Mean of the week's category scores, or null when NOTHING was submitted.
	 *  null means MISSING — never coerce it to 0. */
	average: number | null;
}

export interface AttentionSignals {
	/** Any rule fired. */
	needsAttention: boolean;
	lowLatest: boolean;
	strugglingStreak: boolean;
	decliningTrend: boolean;
	/** Length of the current run of consecutive low weeks (0 when none). */
	streakLength: number;
	/** Average of the most recent week that HAS data, or null. */
	latestAverage: number | null;
	/** Trend arithmetic, present only when both windows had enough data. */
	trend: { recent: number; previous: number; drop: number } | null;
	/** Short, factual phrases for the UI. Never a diagnosis. */
	reasons: string[];
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * `weeks` must be a CONTIGUOUS calendar series (no gaps in the list itself),
 * newest first — exactly what recentWeeks() produces. A week nobody submitted
 * is present with average: null.
 */
export function computeAttentionSignals(weeks: WeekPoint[]): AttentionSignals {
	const withData = weeks.filter((w) => w.average !== null) as Array<{ weekEnd: string; average: number }>;

	const latestAverage = withData.length > 0 ? withData[0].average : null;
	const lowLatest = latestAverage !== null && latestAverage < LOW_SCORE;

	// Streak: walk from the newest week. A missing week ends the walk — it is
	// not evidence of struggling, so it breaks the run rather than extending it.
	let streakLength = 0;
	for (const w of weeks) {
		if (w.average === null) break;
		if (w.average >= LOW_SCORE) break;
		streakLength++;
	}
	const strugglingStreak = streakLength >= STREAK_WEEKS;

	// Trend: two equal-length calendar windows, each needing enough real data.
	let trend: AttentionSignals['trend'] = null;
	const recentPoints = weeks.slice(0, TREND_WINDOW).filter((w) => w.average !== null).map((w) => w.average!);
	const previousPoints = weeks
		.slice(TREND_WINDOW, TREND_WINDOW * 2)
		.filter((w) => w.average !== null)
		.map((w) => w.average!);
	if (recentPoints.length >= MIN_TREND_POINTS && previousPoints.length >= MIN_TREND_POINTS) {
		const recent = mean(recentPoints);
		const previous = mean(previousPoints);
		trend = { recent: round1(recent), previous: round1(previous), drop: round1(previous - recent) };
	}
	const decliningTrend = trend !== null && trend.drop >= MIN_DROP;

	const reasons: string[] = [];
	if (strugglingStreak) reasons.push(`${streakLength} weeks in a row below ${LOW_SCORE}`);
	else if (lowLatest) reasons.push(`Latest week at ${round1(latestAverage!)} (below ${LOW_SCORE})`);
	if (decliningTrend && trend) {
		reasons.push(`Down ${trend.drop} vs the previous ${TREND_WINDOW} weeks (${trend.previous} → ${trend.recent})`);
	}

	return {
		needsAttention: lowLatest || strugglingStreak || decliningTrend,
		lowLatest,
		strugglingStreak,
		decliningTrend,
		streakLength,
		latestAverage: latestAverage === null ? null : round1(latestAverage),
		trend,
		reasons,
	};
}

/** Bucket for the pulse grid cell. 'missing' is its own state, never a score. */
export type PulseTone = 'missing' | 'low' | 'mid' | 'high';

export function pulseTone(average: number | null): PulseTone {
	if (average === null) return 'missing';
	if (average < LOW_SCORE) return 'low';
	if (average < 4) return 'mid';
	return 'high';
}
