import { describe, it, expect } from 'vitest';
import {
	QUICK_ACTIONS,
	DEFAULT_QUICK_ACTION_KEYS,
	availableQuickActions,
	quickActionHref,
	resolveQuickActions,
} from './quickActions';

describe('QUICK_ACTIONS catalog', () => {
	it('has unique keys', () => {
		const keys = QUICK_ACTIONS.map((a) => a.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('carries the v1 catalog from the spec, in order', () => {
		expect(QUICK_ACTIONS.map((a) => a.key)).toEqual([
			'new_task', 'weekly_checkin', 'my_metrics',
			'open_calendar', 'new_client_note', 'run_scraper', 'add_prospect',
		]);
	});

	it('marks only run_scraper restricted', () => {
		expect(QUICK_ACTIONS.filter((a) => a.restricted).map((a) => a.key)).toEqual(['run_scraper']);
	});

	it('gives new_task no href — it fires the quick-add event instead', () => {
		expect(QUICK_ACTIONS.find((a) => a.key === 'new_task')?.href).toBeUndefined();
		// Everything else must be navigable, or the picker would offer a dead row.
		for (const a of QUICK_ACTIONS) {
			if (a.key !== 'new_task') expect(a.href, a.key).toBeTruthy();
		}
	});

	it('defaults to the first four catalog entries', () => {
		expect(DEFAULT_QUICK_ACTION_KEYS).toEqual(QUICK_ACTIONS.slice(0, 4).map((a) => a.key));
	});
});

describe('resolveQuickActions', () => {
	// ---- null vs empty: the whole point of the saved shape -------------------

	it('null means "never chose" → the default four', () => {
		expect(resolveQuickActions(null, false).map((a) => a.key))
			.toEqual(['new_task', 'weekly_checkin', 'my_metrics', 'open_calendar']);
	});

	it('an EMPTY array means "chose none" → nothing at all, not the defaults', () => {
		expect(resolveQuickActions([], false)).toEqual([]);
		expect(resolveQuickActions([], true)).toEqual([]);
		// The two must never collapse into each other.
		expect(resolveQuickActions([], false)).not.toEqual(resolveQuickActions(null, false));
	});

	// ---- selection ----------------------------------------------------------

	it('returns the chosen actions in the saved order', () => {
		expect(resolveQuickActions(['open_calendar', 'new_task'], false).map((a) => a.key))
			.toEqual(['open_calendar', 'new_task']);
	});

	it('drops unknown keys instead of rendering a dead button', () => {
		expect(resolveQuickActions(['new_task', 'retired_action', ''], false).map((a) => a.key))
			.toEqual(['new_task']);
	});

	it('drops every key when all of them are unknown — it does NOT fall back to the defaults', () => {
		expect(resolveQuickActions(['gone', 'also_gone'], false)).toEqual([]);
	});

	it('de-duplicates repeated keys', () => {
		expect(resolveQuickActions(['new_task', 'new_task'], false).map((a) => a.key))
			.toEqual(['new_task']);
	});

	// ---- restricted ---------------------------------------------------------

	it('hides run_scraper from someone without access who has it saved', () => {
		expect(resolveQuickActions(['new_task', 'run_scraper'], false).map((a) => a.key))
			.toEqual(['new_task']);
	});

	it('shows run_scraper to someone with access', () => {
		expect(resolveQuickActions(['new_task', 'run_scraper'], true).map((a) => a.key))
			.toEqual(['new_task', 'run_scraper']);
	});

	it('never leaks a restricted action through the null default path', () => {
		// Defensive: the defaults happen to contain none today, but the filter
		// has to run on that path too, or promoting an action into the defaults
		// would quietly ship it to everyone.
		expect(resolveQuickActions(null, false).some((a) => a.restricted)).toBe(false);
	});

	it('returns catalog objects, not copies with lost fields', () => {
		expect(resolveQuickActions(['run_scraper'], true)[0])
			.toBe(QUICK_ACTIONS.find((a) => a.key === 'run_scraper'));
	});
});

describe('availableQuickActions', () => {
	it('is the full catalog for an admin', () => {
		expect(availableQuickActions(true)).toEqual(QUICK_ACTIONS);
	});

	it('omits admin-only entries for everyone else — the picker cannot offer them', () => {
		expect(availableQuickActions(false).map((a) => a.key))
			.toEqual(['new_task', 'weekly_checkin', 'my_metrics', 'open_calendar', 'new_client_note', 'add_prospect']);
	});
});

describe('quickActionHref', () => {
	const byKey = (k: string) => QUICK_ACTIONS.find((a) => a.key === k)!;

	it('substitutes the viewer id into the personal routes', () => {
		expect(quickActionHref(byKey('weekly_checkin'), 'u-7')).toBe('/team/u-7?tab=checkins');
		expect(quickActionHref(byKey('my_metrics'), 'u-7')).toBe('/team/u-7?tab=metrics');
	});

	it('leaves hrefs without the token alone', () => {
		expect(quickActionHref(byKey('open_calendar'), 'u-7')).toBe('/the-work/calendar');
		expect(quickActionHref(byKey('new_client_note'), 'u-7')).toBe('/clients');
		expect(quickActionHref(byKey('run_scraper'), 'u-7')).toBe('/media/lead-scraper');
	});

	it('returns null for the action that has no destination', () => {
		expect(quickActionHref(byKey('new_task'), 'u-7')).toBeNull();
	});
});
