// The Radar — Home's ONE feed, ordered by urgency.
//
// It replaces three things that used to compete for the same corner of Home:
// the "What changed" card, the "needs you" exception strip, and the assorted
// notices. Everything that wants the viewer's attention arrives here, tone-coded
// (amber = a ritual is due, blue = something happened) and each
// row carries one direct action.
//
// Pure by construction, same contract as web/src/lib/work/activity.ts: no
// Date.now(), no I/O, and — the rule that matters most here — every href is
// passed IN. The builder decides WHAT deserves a row and in WHICH order; it
// never invents a route, so changing where a row points is a caller change and
// the tests never encode the app's URL shape.
//
// WHAT THIS DELIBERATELY DOES NOT CARRY (Sam, 2026-08-26): overdue work.
// It used to lead the feed in red, and it was redundant — the queue sitting
// immediately to the left already groups the same items under Overdue, and its
// header carries the count with a filter. A radar exists for what is NOT
// already in front of you. The queue owns your work; the Radar owns the
// rituals, the signals and the news.
//
// The one rule that is a correctness matter rather than a style one:
// `computedMonth: null` emits NOTHING. Null means The Work's compute engine
// (0049/0051, run by cron) has not written rows for this month yet — which is
// not the same fact as "you finished zero tasks". Rendering "0 done · 0
// scheduled" for an uncomputed month would tell someone they did nothing all
// month. A real computed zero (the engine ran and the answer was zero) DOES
// render, because that one is true.

export type RadarTone = 'danger' | 'warning' | 'info';

export interface RadarRow {
	tone: RadarTone;
	title: string;
	sub: string;
	href: string;
	cta: string;
}

export interface RadarInput {
	/** Projects the viewer leads whose health update has gone stale. */
	staleHealthCount: number;
	staleHealthHref: string;
	/** Manual metrics still blank for `monthLabel`. */
	metricsDue: number;
	monthLabel: string;
	metricsHref: string;
	checkinPending: boolean;
	checkinHref: string;
	/** The viewer's own `source='the_work'` numbers for the current month, or
	 *  null when the engine has written no rows for it. See the header note. */
	computedMonth: { done: number; scheduled: number } | null;
	/** Health updates on items the viewer owns or leads, newest first. */
	changes: { text: string; whenLabel: string; href: string }[];
	/** Conversation on the viewer's items, newest first. */
	comments: { text: string; whenLabel: string; href: string }[];
	/** Self → Sales: unanswered new leads older than the speed-to-lead goal. Absent for viewers without a lane. */
	slowNewLeads?: { count: number; goalMinutes: number; href: string } | null;
}

/** Total rows the feed ever renders, sentinel included. Past this the Radar
 *  stops being a glance and becomes a second queue. */
export const RADAR_CAP = 12;

/**
 * The whole feed, uncapped and sentinel-free.
 *
 * Exists because a count badge must never be computed from the capped list:
 * with 20 overdue items, counting `buildRadar`'s output would print "11" on the
 * Urgent pill. Callers that show counts, or that filter before displaying,
 * work from this and call `capRadar` last.
 */
export function buildRadarAll(input: RadarInput): RadarRow[] {
	const rows: RadarRow[] = [];

	// A lead waiting past the speed-to-lead goal is the most time-critical warning.
	if (input.slowNewLeads && input.slowNewLeads.count > 0) {
		const { count: n, goalMinutes, href } = input.slowNewLeads;
		rows.push({
			tone: 'warning',
			title: `${n} new ${n === 1 ? 'lead' : 'leads'} past the ${goalMinutes}-min goal`,
			sub: 'Answer first, then the rest of the queue',
			href,
			cta: 'Open',
		});
	}

	// ----- warning: rituals with a deadline in sight --------------------------
	if (input.staleHealthCount > 0) {
		const n = input.staleHealthCount;
		rows.push({
			tone: 'warning',
			title: `${n} ${n === 1 ? 'project' : 'projects'} without a health update`,
			sub: 'An update takes the project out of the dark',
			href: input.staleHealthHref,
			cta: 'Update',
		});
	}

	if (input.metricsDue > 0) {
		const n = input.metricsDue;
		rows.push({
			tone: 'warning',
			title: `${n} ${n === 1 ? 'metric' : 'metrics'} still blank for ${input.monthLabel}`,
			sub: 'Before the month closes',
			href: input.metricsHref,
			cta: 'Fill in',
		});
	}

	if (input.checkinPending) {
		rows.push({
			tone: 'warning',
			title: 'Your weekly check-in is not submitted',
			sub: 'Takes two minutes',
			href: input.checkinHref,
			cta: 'Submit',
		});
	}

	// ----- info: what the month says, then what happened ----------------------
	// The counted month leads the info group: it is the standing summary the
	// changes below are individual instances of.
	if (input.computedMonth) {
		rows.push({
			tone: 'info',
			title: `Your counted month: ${input.computedMonth.done} done · ${input.computedMonth.scheduled} scheduled`,
			sub: input.monthLabel,
			href: input.metricsHref,
			cta: 'View',
		});
	}

	for (const c of input.changes) {
		rows.push({ tone: 'info', title: c.text, sub: c.whenLabel, href: c.href, cta: 'View' });
	}

	for (const c of input.comments) {
		rows.push({ tone: 'info', title: c.text, sub: c.whenLabel, href: c.href, cta: 'Reply' });
	}

	// Rows are pushed in tone order already, so no sort is needed and each
	// group keeps exactly the order its input arrived in (the caller sorts by
	// recency).
	return rows;
}

/**
 * Truncate a feed to `RADAR_CAP` rows, sentinel included. Because rows arrive
 * in urgency order, this drops the least urgent tail first — the danger rows
 * always survive. A feed that already fits comes back untouched: no sentinel
 * when nothing was dropped.
 */
export function capRadar(rows: RadarRow[]): RadarRow[] {
	if (rows.length <= RADAR_CAP) return rows;

	const kept = rows.slice(0, RADAR_CAP - 1);
	kept.push({
		tone: 'info',
		title: `+${rows.length - (RADAR_CAP - 1)} more`,
		sub: '',
		href: '',
		cta: '',
	});
	return kept;
}

/** The feed as rendered: built, then capped. */
export function buildRadar(input: RadarInput): RadarRow[] {
	return capRadar(buildRadarAll(input));
}
