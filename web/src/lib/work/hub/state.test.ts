import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, dueRange, filterCount, hubQueryString, isValidDue, legacyToState, parseHubState, rowSetKey, serializeHubState } from './state';
import { HUB_TABS, LEGACY_BOARD_TO_TAB, hubHref, hubTabForKind, pluralOf } from './tabs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('hub URL state', () => {
	it('round-trips every param', () => {
		const s = parseHubState(new URLSearchParams(`search=launch&owner=${A},none&lead=${B}&status=to_do,in_progress&dept=${A}&subdept=${B}&tag=pr,${A}&client=${A}&discipline=social&quarter=26-3&due=week&closed=1&archived=1&sort=due:desc&group=owner&view=board&cols=owner,status,due`));
		expect(s.owner).toEqual([A, 'none']);
		expect(s.tag).toEqual(['pr', A]);
		expect(s.quarter).toBe('26-3');
		expect(s.sort).toEqual({ key: 'due', dir: 'desc' });
		expect(s.view).toBe('board');
		expect(parseHubState(serializeHubState(s))).toEqual(s);
	});

	it('drops junk instead of failing', () => {
		const s = parseHubState({ owner: 'not-a-uuid,' + A, quarter: 'yesterday', due: 'soonish', sort: 'random:up', view: 'pie', status: 'drop table;' });
		expect(s.owner).toEqual([A]);
		expect(s.quarter).toBeNull();
		expect(s.due).toBeNull();
		expect(s.sort).toBeNull();
		expect(s.view).toBeNull();
		expect(s.status).toEqual([]);
	});

	it('serializes equal states to equal URLs, defaults omitted', () => {
		expect(hubQueryString(EMPTY_STATE)).toBe('');
		const a = { ...EMPTY_STATE, owner: [A], status: ['done'] };
		expect(hubQueryString(a)).toBe(hubQueryString({ ...a }));
	});

	it('maps an old hub link: q is the quarter name, kind picks the tab, filters carry over', () => {
		const { kind, state } = legacyToState(new URLSearchParams(`kind=goal&q=26-3&owner=${A}&tag=pr&lead=${B}&dept=${A}&status=active&view=board&sort=due_asc`));
		expect(kind).toBe('goal');
		expect(hubTabForKind(kind!)?.key).toBe('goals');
		expect(state.quarter).toBe('26-3');
		expect(state.search).toBe('');
		expect(state.owner).toEqual([A]);
		expect(state.tag).toEqual(['pr']);
		expect(state.view).toBe('board');
		expect(state.sort).toEqual({ key: 'due', dir: 'asc' });
	});

	it('a board-era q (free text) is a search, not a quarter', () => {
		expect(parseHubState({ q: 'podcast' }).search).toBe('podcast');
		expect(parseHubState({ q: 'podcast' }).quarter).toBeNull();
	});

	it('view aliases from the old screens', () => {
		expect(parseHubState({ view: 'list' }).view).toBe('table');
		expect(parseHubState({ view: 'kanban' }).view).toBe('board');
	});

	it('rowSetKey ignores view, sort, columns but not filters', () => {
		const base = parseHubState({ owner: A });
		expect(rowSetKey({ ...base, view: 'board', sort: { key: 'name', dir: 'asc' }, cols: ['owner'] })).toBe(rowSetKey(base));
		expect(rowSetKey({ ...base, owner: [B] })).not.toBe(rowSetKey(base));
	});

	it('counts filters (not view or quarter)', () => {
		expect(filterCount(EMPTY_STATE)).toBe(0);
		expect(filterCount({ ...EMPTY_STATE, search: 'x', owner: [A], due: 'overdue', quarter: 'all', view: 'board' })).toBe(3);
	});
});

describe('due ranges', () => {
	const today = '2026-11-05';
	it('presets', () => {
		expect(dueRange('overdue', today)).toEqual({ to: '2026-11-04', overdue: true });
		expect(dueRange('today', today)).toEqual({ from: today, to: today });
		expect(dueRange('week', today)).toEqual({ from: today, to: '2026-11-11' });
		expect(dueRange('month', today)).toEqual({ from: today, to: '2026-12-04' });
		expect(dueRange('none', today)).toEqual({ none: true });
		expect(dueRange(null, today)).toBeNull();
	});
	it('custom ranges, open on either end', () => {
		expect(dueRange('2026-11-01..2026-11-30', today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
		expect(dueRange('..2026-11-30', today)).toEqual({ from: undefined, to: '2026-11-30' });
		expect(isValidDue('..')).toBe(false);
		expect(isValidDue('2026-11-01..')).toBe(true);
	});
});

describe('hub tabs', () => {
	it('has the seven kind tabs from D1 in order, Bugs included', () => {
		expect(HUB_TABS.map((t) => t.key)).toEqual(['goals', 'priorities', 'projects', 'tasks', 'recurring', 'process', 'bugs']);
	});
	it('D3: only priorities and projects default to the current quarter', () => {
		expect(HUB_TABS.filter((t) => t.quarterDefault === 'current').map((t) => t.key)).toEqual(['priorities', 'projects']);
	});
	it('every kind tab is reachable from the kind and the old board slugs', () => {
		for (const t of HUB_TABS) expect(hubTabForKind(t.kinds[0])?.key).toBe(t.key);
		expect(LEGACY_BOARD_TO_TAB['goals-priorities']).toBe('priorities');
		expect(LEGACY_BOARD_TO_TAB['recurring-processes']).toBe('recurring');
		expect(hubHref(HUB_TABS[0])).toBe('/the-work/goals');
		expect(hubHref({ hub: false, key: 'x', slug: 'launch' })).toBe('/the-work/b/launch');
	});
	it('plurals', () => {
		expect(pluralOf('process')).toBe('processes');
		expect(pluralOf('priority')).toBe('priorities');
		expect(pluralOf('campaign')).toBe('campaigns');
	});
});
