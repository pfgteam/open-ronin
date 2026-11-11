// Home's per-viewer signals — the numbers the Radar nags about.
//
// This used to live inside HomeSetupNotice, which rendered them as bullets in
// an amber card. The Radar now owns those two rows, so the computation moved
// here and HomeSetupNotice kept only the profile gaps: one fact, one place.
//
// The metrics-due rule is the subtle one and is preserved verbatim from that
// component. Applicable metrics come from resolveMetricRows (specialty ± the
// 0050 per-person deltas), NOT from a specialty filter alone — filtering by
// specialty nagged for metrics a manager had withheld and stayed silent about
// ones they had granted. `source='manual'` only: a computed metric is never
// "due" from a human. And "entered" requires an actual value, because a row
// carrying only a goal used to silence the reminder for a number nobody
// reported.
//
// Check-in audience rule (Sam, 19/08, and migration 0036): checkin_audience
// is an OPTIONAL restriction list. EMPTY TABLE = everyone active is expected.
// Adding rows narrows the ritual to those departments — and then a person with
// no department set is not expected, because we can't tell where they belong.

import { createClient } from '@/lib/supabase/server';
import { resolveMetricRows, type MetricOverride } from '@/lib/people/metricRows';
import { loadCheckinWindow } from '@/lib/people/checkinWindow';

/**
 * The four states a week's check-in can be in for one person. `not-expected`
 * is NOT the same fact as `missing` — see the audience rule above — and callers
 * must not collapse them into one "nothing here" case.
 */
export type CheckinState = 'submitted' | 'draft' | 'missing' | 'not-expected';

export interface HomeSignals {
	/** First day of the current month, as `YYYY-MM-01`. */
	period: string;
	/** "August" — the label the Radar's metrics and counted-month rows print. */
	monthLabel: string;
	/** Manual metrics applicable to this person and still blank for `period`. */
	metricsDue: number;
	/** week_end of an unsubmitted check-in the viewer is expected to file. */
	checkinWeek: string | null;
	/**
	 * The viewer's own `source='the_work'` numbers for `period`, or null when
	 * the compute engine (0049/0051, run by cron) has written no rows for the
	 * month. Null is NOT zero — see the note in radar.ts.
	 */
	computedMonth: { done: number; scheduled: number } | null;
}

export function currentMonthStart(): string {
	return `${new Date().toISOString().slice(0, 7)}-01`;
}

/**
 * The latest OPEN week's check-in for one person, as a state rather than a nag.
 *
 * "Open" per 0065: the week whose Friday 9:15 AM Central has passed most
 * recently. Before Friday morning that is LAST week — the one that has
 * actually happened — never the week in progress, which is what used to make
 * Home nag on a Sunday about a week nobody had lived yet. Falls back to the
 * current week when 0065 is not applied (loadCheckinWindow).
 *
 * Pulled out of loadHomeSignals so the profile header can read the SAME rule
 * (audience from 0036, statuses from 0035) instead of asking the database its
 * own slightly different question. loadHomeSignals still owns the derived
 * "should the Radar nag" boolean; this owns the fact.
 *
 * `week` is the `week_end` the state refers to, null when there is no open
 * week to speak of (the rpc could not tell us — in which case nobody is nagged).
 */
export async function loadCheckinState(
	userId: string,
): Promise<{ state: CheckinState; week: string | null }> {
	const supabase = await createClient();
	const [{ data: profileRaw }, { data: audienceRows }] = await Promise.all([
		supabase.from('profiles').select('department_tag_id').eq('id', userId).maybeSingle(),
		supabase.from('checkin_audience').select('department_tag_id'),
	]);
	const profile = profileRaw as { department_tag_id: string | null } | null;

	// EMPTY audience table = everyone active is expected; rows narrow it, and
	// then somebody with no department cannot be placed, so they are not asked.
	const restrictedTo = ((audienceRows ?? []) as { department_tag_id: string }[]).map(
		(r) => r.department_tag_id,
	);
	const expected =
		restrictedTo.length === 0 ||
		(!!profile?.department_tag_id && restrictedTo.includes(profile.department_tag_id));
	if (!expected) return { state: 'not-expected', week: null };

	const window = await loadCheckinWindow(supabase);
	if (!window) return { state: 'not-expected', week: null };
	const week = window.latestOpenWeekEnd;

	const { data: existing } = await supabase
		.from('weekly_checkins')
		.select('status')
		.eq('user_id', userId)
		.eq('week_end', week)
		.maybeSingle();
	const status = (existing as { status: string } | null)?.status ?? null;
	return {
		state: status === 'submitted' ? 'submitted' : status === 'draft' ? 'draft' : 'missing',
		week,
	};
}

export async function loadHomeSignals(viewerId: string): Promise<HomeSignals> {
	const supabase = await createClient();
	const period = currentMonthStart();
	const monthLabel = new Date(`${period}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		timeZone: 'UTC',
	});

	const [
		{ data: profileRaw },
		{ data: defRows },
		{ data: valueRows },
		{ data: overrideRows },
		{ data: computedRows },
		checkin,
	] = await Promise.all([
		supabase
			.from('profiles')
			.select('id, department_tag_id, pap_position')
			.eq('id', viewerId)
			.maybeSingle(),
		supabase
			.from('metric_definitions')
			.select('key, pap_positions, sort')
			.eq('is_active', true)
			.eq('source', 'manual'),
		supabase
			.from('metrics')
			.select('metric_key, value')
			.eq('subject_type', 'user')
			.eq('subject_id', viewerId)
			.eq('period', period),
		supabase.from('profile_metric_overrides').select('metric_key, mode').eq('profile_id', viewerId),
		supabase
			.from('metrics')
			.select('metric_key, value')
			.eq('subject_type', 'user')
			.eq('subject_id', viewerId)
			.eq('period', period)
			.eq('source', 'the_work')
			.in('metric_key', ['v2_tasks_completed', 'v2_tasks_scheduled']),
		// The audience + status rule lives in loadCheckinState, so the Radar and
		// the profile header can never disagree about it.
		loadCheckinState(viewerId),
	]);

	const profile = profileRaw as { department_tag_id: string | null; pap_position: string | null } | null;

	// ----- metrics due --------------------------------------------------------
	const values = (valueRows ?? []) as { metric_key: string; value: number | null }[];
	const applicable = resolveMetricRows({
		defs: (defRows ?? []) as { key: string; pap_positions: string[]; sort: number }[],
		papPosition: profile?.pap_position ?? null,
		overrides: (overrideRows ?? []) as MetricOverride[],
		keysWithValues: values.map((v) => v.metric_key),
	});
	const entered = new Set(values.filter((v) => v.value != null).map((v) => v.metric_key));
	const metricsDue = applicable.filter((r) => !entered.has(r.def.key)).length;

	// ----- the counted month --------------------------------------------------
	// No rows at all → null. One row present → the engine DID run, so the
	// missing half is a genuine zero.
	const counted = (computedRows ?? []) as { metric_key: string; value: number | null }[];
	const computedMonth =
		counted.length === 0
			? null
			: {
					done: Number(counted.find((r) => r.metric_key === 'v2_tasks_completed')?.value ?? 0),
					scheduled: Number(counted.find((r) => r.metric_key === 'v2_tasks_scheduled')?.value ?? 0),
				};

	// ----- weekly check-in ----------------------------------------------------
	// Only a check-in that is EXPECTED and not yet submitted is a nag; a draft
	// still counts as outstanding, exactly as before.
	const checkinWeek =
		checkin.state === 'draft' || checkin.state === 'missing' ? checkin.week : null;

	return { period, monthLabel, metricsDue, checkinWeek, computedMonth };
}
