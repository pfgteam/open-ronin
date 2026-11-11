// The profile header's mini-stat strip — four glanceable facts about a person.
//
// PURE by construction, same contract as lib/home/radar.ts and
// lib/work/activity.ts: no I/O, and no clock. `asOf` is passed in, so a test
// can pin the day and the tenure arithmetic never depends on when the suite
// runs.
//
// Two cells are deliberately allowed to disappear rather than lie:
//   • a check-in that is NOT EXPECTED emits nothing. Rendering "Not submitted"
//     for somebody outside the ritual's audience (migration 0036 makes the
//     audience an optional restriction list) would nag about a thing they were
//     never asked for.
//   • `metricsTotal === 0` emits nothing, which covers both "no specialty and
//     no granted metrics" and "this viewer isn't allowed to see them", and in
//     neither case is "0 of 0 filled" information.
//
// Every string here is user-facing, so every string here is ENGLISH.

export type ProfileStatTone = 'default' | 'success' | 'warning' | 'danger';

export interface ProfileStat {
	label: string;
	value: string;
	tone?: ProfileStatTone;
}

export type CheckinState = 'submitted' | 'draft' | 'missing' | 'not-expected';

export interface ProfileStatsInput {
	/** Metrics with a value for the open month, out of `metricsTotal`. */
	metricsFilled: number;
	/**
	 * How many metrics this person answers for — resolveMetricRows' output
	 * (specialty ± the per-person deltas from 0050), never a specialty filter.
	 */
	metricsTotal: number;
	/** "August" — the open month, already localised by the caller. */
	monthLabel: string;
	checkinState: CheckinState;
	/** Non-terminal work items this person owns. */
	openTasks: number;
	/** How many of those are past their due date. */
	overdueTasks: number;
	/** `profiles.date_started`, `YYYY-MM-DD`, or null when unknown. */
	tenureStart: string | null;
	/** Today, `YYYY-MM-DD`. Passed in — this function never reads the clock. */
	asOf: string;
}

const CHECKIN_CELL: Record<Exclude<CheckinState, 'not-expected'>, { value: string; tone: ProfileStatTone }> = {
	submitted: { value: 'Submitted', tone: 'success' },
	draft: { value: 'Draft saved', tone: 'warning' },
	missing: { value: 'Not submitted', tone: 'danger' },
};

/** Whole months between two `YYYY-MM-DD` days, or null if either is unusable. */
function monthsBetween(from: string, to: string): number | null {
	const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
	const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
	if (!a || !b) return null;
	const months =
		(Number(b[1]) - Number(a[1])) * 12 +
		(Number(b[2]) - Number(a[2])) -
		// The month only completes on the anniversary day.
		(Number(b[3]) < Number(a[3]) ? 1 : 0);
	return months;
}

function tenureLabel(tenureStart: string | null, asOf: string): string {
	if (!tenureStart) return '—';
	const months = monthsBetween(tenureStart, asOf);
	if (months == null) return '—';
	// A future or same-month start is not negative tenure, it is "just arrived".
	if (months <= 0) return 'Less than a month';
	const years = Math.floor(months / 12);
	const rest = months % 12;
	if (years === 0) return `${rest}m`;
	if (rest === 0) return `${years}y`;
	return `${years}y ${rest}m`;
}

export function buildProfileStats(input: ProfileStatsInput): ProfileStat[] {
	const stats: ProfileStat[] = [];

	if (input.metricsTotal > 0) {
		stats.push({
			label: `Metrics · ${input.monthLabel}`,
			value: `${input.metricsFilled} of ${input.metricsTotal} filled`,
			tone: input.metricsFilled >= input.metricsTotal ? 'success' : 'warning',
		});
	}

	if (input.checkinState !== 'not-expected') {
		const cell = CHECKIN_CELL[input.checkinState];
		stats.push({ label: 'Check-in · latest week', value: cell.value, tone: cell.tone });
	}

	stats.push({
		label: 'Open work',
		value:
			input.overdueTasks > 0
				? `${input.openTasks} · ${input.overdueTasks} overdue`
				: `${input.openTasks}`,
		tone: input.overdueTasks > 0 ? 'danger' : 'default',
	});

	stats.push({
		label: 'Tenure',
		value: tenureLabel(input.tenureStart, input.asOf),
		tone: 'default',
	});

	return stats;
}
