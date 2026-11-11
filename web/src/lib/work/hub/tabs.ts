// The Work hub (rework D1, 5.1, 5.2): one hub, a tab per kind, each tab a
// system board. Pure module — imported by server loaders and client screens.
//
// A hub tab and a custom board are the same thing to the list screen: a
// HubDef (kinds, default grouping, default columns, whether the quarter
// filter applies by default). The DB board row (0163) can override the
// columns; when it is absent the definitions below are used as-is.

export type HubView = 'table' | 'board' | 'timeline' | 'calendar';
export const HUB_VIEWS: HubView[] = ['table', 'board', 'timeline', 'calendar'];

export interface HubDef {
	/** URL segment: /the-work/<key> for hub tabs, /the-work/b/<slug> for boards. */
	key: string;
	/** boards.slug this def mirrors (system board or custom board). */
	slug: string;
	label: string;
	/** Singular item noun, lower case ("priority"). */
	noun: string;
	/** Plural noun, lower case ("priorities"). */
	plural: string;
	kinds: string[];
	/** D3: priorities and projects default to the current quarter; the rest are not quarter-filtered unless the user adds it. */
	quarterDefault: 'current' | 'all';
	group: string;
	columns: string[];
	/** Hub tabs live at /the-work/<key>; custom boards at /the-work/b/<slug>. */
	hub: boolean;
	/** Base filter pinned by a custom board (client, department, owner). */
	pinned?: { client_id?: string; department_tag_ids?: string[]; owner_id?: string };
	/** Board row id when one exists (favourites, custom columns, saved column config). */
	boardId?: string | null;
	/** Statuses the list is pinned to (Planning's Pending list: backlog). */
	pinnedStatus?: string[];
	/** Assignments pinned to one discipline (Client Work's discipline tabs, by slug). */
	pinnedDiscipline?: string;
	/** Which tab strip the def belongs to. */
	tabSet?: 'work' | 'client';
	/** Route override (Client Work tabs live under /the-work/client-work). */
	route?: string;
}

const COMMON = ['owner', 'status', 'due'];

export const HUB_TABS: HubDef[] = [
	{ key: 'goals', slug: 'goals', label: 'Goals', noun: 'goal', plural: 'goals', kinds: ['goal'], quarterDefault: 'all', group: 'status', columns: ['owner', 'status', 'progress', 'quarter', 'due'], hub: true },
	{ key: 'priorities', slug: 'priorities', label: 'Priorities', noun: 'priority', plural: 'priorities', kinds: ['priority'], quarterDefault: 'current', group: 'parent', columns: ['owner', 'status', 'progress', 'quarter', 'due'], hub: true },
	{ key: 'projects', slug: 'projects', label: 'Projects', noun: 'project', plural: 'projects', kinds: ['project'], quarterDefault: 'current', group: 'parent', columns: ['owner', 'status', 'timeline', 'due', 'department', 'progress'], hub: true },
	{ key: 'tasks', slug: 'tasks', label: 'Tasks', noun: 'task', plural: 'tasks', kinds: ['task'], quarterDefault: 'all', group: 'status', columns: [...COMMON, 'parent', 'followers'], hub: true },
	{ key: 'recurring', slug: 'recurring', label: 'Recurring', noun: 'recurring item', plural: 'recurring items', kinds: ['recurring'], quarterDefault: 'all', group: 'status', columns: [...COMMON, 'department'], hub: true },
	{ key: 'process', slug: 'process', label: 'Process', noun: 'process', plural: 'processes', kinds: ['process'], quarterDefault: 'all', group: 'status', columns: [...COMMON, 'department'], hub: true },
	{ key: 'bugs', slug: 'bugs', label: 'Bugs', noun: 'bug', plural: 'bugs', kinds: ['bug'], quarterDefault: 'all', group: 'status', columns: ['owner', 'status', 'severity', 'due'], hub: true },
];

export const HUB_TAB_KEYS = HUB_TABS.map((t) => t.key);

/**
 * Planning's Pending list (rework D10, 5.4): every item in backlog status,
 * across all kinds, on the same list screen and toolbar as the hub.
 */
export const PENDING_DEF: HubDef = {
	key: 'pending', slug: 'pending', label: 'Pending', noun: 'item', plural: 'items',
	kinds: ['goal', 'priority', 'project', 'task', 'recurring', 'process', 'bug', 'strategy', 'twelve_week_plan', 'campaign', 'assignment'],
	quarterDefault: 'all', group: 'kind', columns: ['owner', 'status', 'quarter', 'parent', 'due'], hub: false, pinnedStatus: ['backlog'],
};

/** English plural for a lower-case noun (custom boards). */
export function pluralOf(noun: string): string {
	if (/(s|x|ch|sh)$/.test(noun)) return noun + 'es';
	if (/[^aeiou]y$/.test(noun)) return noun.slice(0, -1) + 'ies';
	return noun + 's';
}

export function hubTab(key: string): HubDef | undefined {
	return HUB_TABS.find((t) => t.key === key);
}

/** The hub tab that lists a kind (type change, legacy redirects). */
export function hubTabForKind(kind: string): HubDef | undefined {
	return HUB_TABS.find((t) => t.kinds.includes(kind));
}

export function hubHref(def: Pick<HubDef, 'hub' | 'key' | 'slug'> & { route?: string }): string {
	if (def.route) return def.route;
	return def.hub ? `/the-work/${def.key}` : `/the-work/b/${def.slug}`;
}

/**
 * Client Work (rework 5.7, D9): its own hub. Strategy, 12 Week Plan and
 * Campaign keep their tabs; assignments get one tab per discipline (PR,
 * Social, Design, Writing, Branding, more from admin without a migration:
 * the discipline tabs are built from work_disciplines at request time).
 */
const CLIENT_COLS = ['owner', 'status', 'client', 'discipline', 'due', 'parent'];
export const CLIENT_TABS: HubDef[] = [
	{ key: 'assignments', slug: 'client-work', label: 'All assignments', noun: 'assignment', plural: 'assignments', kinds: ['assignment'], quarterDefault: 'all', group: 'discipline', columns: CLIENT_COLS, hub: true, tabSet: 'client', route: '/the-work/client-work' },
	{ key: 'strategy', slug: 'client-strategy', label: 'Strategy', noun: 'strategy', plural: 'strategies', kinds: ['strategy'], quarterDefault: 'all', group: 'status', columns: ['owner', 'status', 'client', 'due'], hub: true, tabSet: 'client', route: '/the-work/client-work/strategy' },
	{ key: 'twelve-week', slug: 'client-twelve-week', label: '12 Week Plan', noun: '12 week plan', plural: '12 week plans', kinds: ['twelve_week_plan'], quarterDefault: 'all', group: 'status', columns: ['owner', 'status', 'client', 'quarter', 'progress', 'due'], hub: true, tabSet: 'client', route: '/the-work/client-work/twelve-week' },
	{ key: 'campaigns', slug: 'client-campaigns', label: 'Campaign', noun: 'campaign', plural: 'campaigns', kinds: ['campaign'], quarterDefault: 'all', group: 'parent', columns: ['owner', 'lead', 'status', 'client', 'progress', 'due'], hub: true, tabSet: 'client', route: '/the-work/client-work/campaigns' },
];

export function clientTab(key: string): HubDef | undefined {
	return CLIENT_TABS.find((t) => t.key === key);
}

/** A discipline tab (assignments pinned to one discipline). */
export function disciplineTab(slug: string, label: string): HubDef {
	return {
		key: `d-${slug}`, slug: `client-${slug}`, label, noun: `${label} assignment`, plural: `${label} assignments`, kinds: ['assignment'],
		quarterDefault: 'all', group: 'status', columns: CLIENT_COLS.filter((c) => c !== 'discipline'), hub: true, tabSet: 'client',
		route: `/the-work/client-work/d/${slug}`, pinnedDiscipline: slug,
	};
}

/** Old system board slugs that the hub replaced → the hub tab that now shows that work. */
export const LEGACY_BOARD_TO_TAB: Record<string, string> = {
	'goals-priorities': 'priorities',
	'recurring-processes': 'recurring',
	goals: 'goals',
	priorities: 'priorities',
	projects: 'projects',
	tasks: 'tasks',
	recurring: 'recurring',
	process: 'process',
	bugs: 'bugs',
};
