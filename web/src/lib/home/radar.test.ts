import { describe, it, expect } from 'vitest';
import { buildRadar, buildRadarAll, capRadar, type RadarInput } from './radar';

const empty: RadarInput = {
	staleHealthCount: 0,
	staleHealthHref: '/the-work/priorities',
	metricsDue: 0,
	monthLabel: 'August',
	metricsHref: '/team/u1?tab=metrics',
	checkinPending: false,
	checkinHref: '/team/u1?tab=checkins',
	computedMonth: null,
	changes: [],
	comments: [],
};

// `changes` is the only unbounded input now that overdue rows are gone, so the
// cap tests build their volume from it.
const changeItem = (n: number) => ({
	text: `Change ${n}`,
	whenLabel: `${n}h ago`,
	href: `/the-work/w${n}`,
});

describe('buildRadar', () => {
	it('returns nothing at all when no input carries a signal', () => {
		expect(buildRadar(empty)).toEqual([]);
	});

	// ---- tone ordering -------------------------------------------------------

	it('orders warning before info, whatever order the inputs arrive in', () => {
		const rows = buildRadar({
			...empty,
			changes: [{ text: 'Ada marked Rebrand On track', whenLabel: '2h ago', href: '/the-work/p1' }],
			metricsDue: 3,
			checkinPending: true,
			staleHealthCount: 2,
		});
		const tones = rows.map((r) => r.tone);
		// Asserted against an explicit expectation, not against the output's own
		// sorted copy — comparing a list to itself passes for any ordering.
		expect(tones).toEqual(['warning', 'warning', 'warning', 'info']);
	});

	it('keeps the caller-supplied order inside a group — the caller sorts by recency', () => {
		const rows = buildRadar({
			...empty,
			changes: [
				{ text: 'newest', whenLabel: '2h ago', href: '/a' },
				{ text: 'older', whenLabel: '1d ago', href: '/b' },
			],
			comments: [{ text: 'a comment', whenLabel: '3d ago', href: '/c' }],
		});
		expect(rows.map((r) => r.title)).toEqual(['newest', 'older', 'a comment']);
	});

	// ---- overdue is deliberately NOT here ------------------------------------
	// Sam, 2026-08-26: overdue rows duplicated the queue's own Overdue
	// bucket sitting immediately to the left, count and all. This test exists so
	// that re-adding them is a deliberate act with a failing test attached,
	// rather than a plausible-looking improvement.

	it('never emits a danger row — overdue work belongs to the queue, not the Radar', () => {
		const rows = buildRadarAll({
			...empty,
			staleHealthCount: 3,
			metricsDue: 2,
			checkinPending: true,
			computedMonth: { done: 4, scheduled: 9 },
			changes: [changeItem(1)],
			comments: [{ text: 'a comment', whenLabel: '1h ago', href: '/c' }],
		});
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.filter((r) => r.tone === 'danger')).toHaveLength(0);
	});

	// ---- stale health --------------------------------------------------------

	it('emits no stale-health row when the count is zero', () => {
		const rows = buildRadar({ ...empty, staleHealthCount: 0, metricsDue: 1 });
		expect(rows.every((r) => !r.href.startsWith('/the-work/priorities'))).toBe(true);
		expect(rows).toHaveLength(1);
	});

	it('collapses the stale-health count into one warning row pointing at the href it was given', () => {
		const rows = buildRadar({ ...empty, staleHealthCount: 4 });
		expect(rows).toHaveLength(1);
		expect(rows[0].tone).toBe('warning');
		expect(rows[0].title).toContain('4');
		expect(rows[0].href).toBe('/the-work/priorities');
	});

	it('singularizes the stale-health row for a count of one', () => {
		const rows = buildRadar({ ...empty, staleHealthCount: 1 });
		expect(rows[0].title).toBe('1 project without a health update');
	});

	// ---- metrics -------------------------------------------------------------

	it('emits no metrics row when nothing is due', () => {
		expect(buildRadar({ ...empty, metricsDue: 0 })).toEqual([]);
	});

	it('names the month and links the metrics row to metricsHref rather than building a path', () => {
		const rows = buildRadar({
			...empty,
			metricsDue: 3,
			monthLabel: 'August',
			metricsHref: '/team/abc?tab=metrics',
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].tone).toBe('warning');
		expect(rows[0].title).toBe('3 metrics still blank for August');
		expect(rows[0].href).toBe('/team/abc?tab=metrics');
	});

	// ---- check-in ------------------------------------------------------------

	it('emits the check-in row only while it is pending, linked to checkinHref', () => {
		expect(buildRadar({ ...empty, checkinPending: false })).toEqual([]);
		const rows = buildRadar({ ...empty, checkinPending: true, checkinHref: '/team/abc?tab=checkins' });
		expect(rows).toHaveLength(1);
		expect(rows[0].tone).toBe('warning');
		expect(rows[0].href).toBe('/team/abc?tab=checkins');
	});

	// ---- computedMonth — the libel case --------------------------------------

	it('emits one info row carrying both counted numbers when the month has computed rows', () => {
		const rows = buildRadar({
			...empty,
			computedMonth: { done: 7, scheduled: 12 },
			metricsHref: '/team/abc?tab=metrics',
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({
			tone: 'info',
			title: 'Your counted month: 7 done · 12 scheduled',
			sub: 'August',
			href: '/team/abc?tab=metrics',
			cta: 'View',
		});
	});

	it('emits the counted row even when a real computed zero is what the engine wrote', () => {
		const rows = buildRadar({ ...empty, computedMonth: { done: 0, scheduled: 0 } });
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('Your counted month: 0 done · 0 scheduled');
	});

	it('emits NO counted row when computedMonth is null — an uncomputed month is not a zero', () => {
		const rows = buildRadar({
			...empty,
			computedMonth: null,
			changes: [{ text: 'Ada marked Rebrand On track', whenLabel: '2h ago', href: '/the-work/p1' }],
		});
		expect(rows.some((r) => r.title.startsWith('Your counted month'))).toBe(false);
		expect(rows).toHaveLength(1);
	});

	it('puts the counted-month row ahead of changes and comments inside the info group', () => {
		const rows = buildRadar({
			...empty,
			computedMonth: { done: 1, scheduled: 2 },
			changes: [{ text: 'a change', whenLabel: '2h ago', href: '/a' }],
			comments: [{ text: 'a comment', whenLabel: '3h ago', href: '/b' }],
		});
		expect(rows.map((r) => r.title)).toEqual([
			'Your counted month: 1 done · 2 scheduled',
			'a change',
			'a comment',
		]);
	});

	// ---- changes & comments --------------------------------------------------

	it('renders a change as an info row whose sub is its when-label and whose href is passed through', () => {
		const rows = buildRadar({
			...empty,
			changes: [{ text: 'Ada marked Rebrand On track', whenLabel: '2h ago', href: '/the-work/p1' }],
		});
		expect(rows[0]).toEqual({
			tone: 'info',
			title: 'Ada marked Rebrand On track',
			sub: '2h ago',
			href: '/the-work/p1',
			cta: 'View',
		});
	});

	it('gives a comment its own cta so it reads as conversation, not as a state change', () => {
		const rows = buildRadar({
			...empty,
			comments: [{ text: 'Grace commented on Rebrand', whenLabel: '1d ago', href: '/the-work/p1' }],
		});
		expect(rows[0].tone).toBe('info');
		expect(rows[0].cta).toBe('Reply');
	});

	// ---- cap -----------------------------------------------------------------

	it('leaves a feed of exactly 12 rows untouched — no sentinel when nothing was dropped', () => {
		const rows = buildRadar({
			...empty,
			changes: Array.from({ length: 12 }, (_, i) => changeItem(i + 1)),
		});
		expect(rows).toHaveLength(12);
		expect(rows.some((r) => r.title.endsWith('more'))).toBe(false);
	});

	it('truncates to 11 real rows plus a "+N more" sentinel that counts everything dropped', () => {
		const rows = buildRadar({
			...empty,
			changes: Array.from({ length: 20 }, (_, i) => changeItem(i + 1)),
		});
		expect(rows).toHaveLength(12);
		expect(rows.slice(0, 11).map((r) => r.title)).toEqual(
			Array.from({ length: 11 }, (_, i) => `Change ${i + 1}`),
		);
		expect(rows[11].title).toBe('+9 more');
	});

	it('gives the sentinel no destination — it is a count, not a link', () => {
		const rows = buildRadar({
			...empty,
			changes: Array.from({ length: 20 }, (_, i) => changeItem(i + 1)),
		});
		const sentinel = rows[rows.length - 1];
		expect(sentinel.href).toBe('');
		expect(sentinel.cta).toBe('');
	});

	// buildRadarAll is what a count badge must read: counting the capped feed
	// would under-report for a person with 20 changes.
	it('buildRadarAll never truncates, so counts taken from it are the true totals', () => {
		const input = {
			...empty,
			changes: Array.from({ length: 20 }, (_, i) => changeItem(i + 1)),
			metricsDue: 2,
		};
		const all = buildRadarAll(input);
		expect(all).toHaveLength(21);
		expect(all.filter((r) => r.tone === 'info')).toHaveLength(20);
		expect(all.filter((r) => r.tone === 'warning')).toHaveLength(1);
		expect(buildRadar(input)).toHaveLength(12);
	});

	it('buildRadarAll never emits the sentinel — truncation is capRadar\'s job alone', () => {
		const all = buildRadarAll({
			...empty,
			changes: Array.from({ length: 20 }, (_, i) => changeItem(i + 1)),
		});
		expect(all.every((r) => r.href !== '')).toBe(true);
		expect(capRadar(all)[11].title).toBe('+9 more');
	});

	it('caps a filtered subset on its own terms — the sentinel counts what THAT list dropped', () => {
		const all = buildRadarAll({
			...empty,
			staleHealthCount: 1,
			metricsDue: 1,
			changes: [{ text: 'a change', whenLabel: '2h ago', href: '/a' }],
		});
		const changesOnly = capRadar(all.filter((r) => r.tone === 'info'));
		expect(changesOnly).toHaveLength(1);
		expect(changesOnly[0].title).toBe('a change');
	});

	it('drops the LEAST urgent rows first — the warning rows survive truncation', () => {
		const rows = buildRadar({
			...empty,
			staleHealthCount: 3,
			metricsDue: 2,
			checkinPending: true,
			computedMonth: { done: 1, scheduled: 2 },
			changes: Array.from({ length: 12 }, (_, i) => changeItem(i + 1)),
		});
		// 3 warning + 1 counted-month + 12 changes = 16 -> 11 kept + "+5 more"
		expect(rows.filter((r) => r.tone === 'warning')).toHaveLength(3);
		expect(rows[11].title).toBe('+5 more');
		expect(rows).toHaveLength(12);
	});
});

describe('slow new leads (Self → Sales)', () => {
	it('adds one warning row first when leads wait past the goal', () => {
		const rows = buildRadarAll({ ...empty, metricsDue: 1, slowNewLeads: { count: 2, goalMinutes: 5, href: '/?tab=work&queue=sales' } });
		expect(rows[0]).toMatchObject({ tone: 'warning', title: '2 new leads past the 5-min goal', href: '/?tab=work&queue=sales' });
	});
	it('adds nothing at zero or when absent', () => {
		expect(buildRadarAll({ ...empty, slowNewLeads: { count: 0, goalMinutes: 5, href: '/' } })).toEqual([]);
		expect(buildRadarAll(empty)).toEqual([]);
	});
});
