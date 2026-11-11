// The Work hub list state (rework 5.2): everything that shapes a list lives
// in the URL, so a view is shareable and a saved view is just this state
// with a name. Pure: parse / serialize / legacy translation, unit-tested.
//
// Params (all optional; a missing param means "the tab's default"):
//   search=<text>            name search
//   owner=<uuid,…|none>      owner, `none` = unassigned (D: owner incl. unassigned)
//   lead=<uuid,…>            project lead
//   status=<slug,…>          status
//   dept=<uuid,…>            department tag     subdept=<uuid,…> sub-department tag
//   tag=<slug|uuid,…>        any tag            client=<uuid,…>  discipline=<uuid,…>
//   quarter=current|all|<26-3>|<uuid>   D3; absent = tab default
//   due=overdue|today|week|month|none|<from>..<to>
//   closed=1|0               show done / hide done (default: hidden)
//   archived=1               the Archived view
//   sort=<key>:<asc|desc>    group=<key>   view=table|board|timeline|calendar
//   cols=<key,…>             visible columns, in order
//
// Old hub links (/the-work/priorities?kind=goal&q=26-3&owner=…&tag=…&lead=…
// &dept=…&subdept=…&status=…&view=board&sort=due_asc) map onto these with
// legacyToState(): `q` there was the QUARTER NAME, so a `q` that looks like a
// quarter becomes quarter=, anything else becomes search=.

import { HUB_VIEWS, type HubView } from './tabs';

export type SortKey = 'manual' | 'name' | 'status' | 'due' | 'start' | 'owner' | 'updated' | 'created' | 'urgency' | 'severity';
export const SORT_KEYS: { key: SortKey; label: string }[] = [
	{ key: 'manual', label: 'Manual order' },
	{ key: 'due', label: 'Due date' },
	{ key: 'start', label: 'Start date' },
	{ key: 'name', label: 'Name' },
	{ key: 'status', label: 'Status' },
	{ key: 'owner', label: 'Owner' },
	{ key: 'urgency', label: 'Urgency' },
	{ key: 'severity', label: 'Severity' },
	{ key: 'updated', label: 'Last updated' },
	{ key: 'created', label: 'Created' },
];

export interface HubState {
	search: string;
	owner: string[];
	lead: string[];
	status: string[];
	dept: string[];
	subdept: string[];
	tag: string[];
	client: string[];
	discipline: string[];
	quarter: string | null;
	due: string | null;
	closed: boolean | null;
	archived: boolean;
	sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
	group: string | null;
	view: HubView | null;
	cols: string[] | null;
}

export const EMPTY_STATE: HubState = {
	search: '', owner: [], lead: [], status: [], dept: [], subdept: [], tag: [], client: [], discipline: [],
	quarter: null, due: null, closed: null, archived: false, sort: null, group: null, view: null, cols: null,
};

export const LIST_KEYS = ['owner', 'lead', 'status', 'dept', 'subdept', 'tag', 'client', 'discipline'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,60}$/i;
const QUARTER_NAME = /^\d{2}-[1-4]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DUE_PRESETS = new Set(['overdue', 'today', 'week', 'month', 'none']);
const COL = /^[a-z][a-z0-9_]{0,40}$/;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function get(p: Params, k: string): string | undefined {
	if (p instanceof URLSearchParams) return p.get(k) ?? undefined;
	const v = p[k];
	return Array.isArray(v) ? v[0] : v;
}

function list(raw: string | undefined, ok: (v: string) => boolean): string[] {
	if (!raw) return [];
	return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s && ok(s)))].slice(0, 50);
}

export function isValidDue(v: string): boolean {
	if (DUE_PRESETS.has(v)) return true;
	const m = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(v);
	return !!m && (!!m[1] || !!m[2]);
}

export function isValidQuarter(v: string): boolean {
	return v === 'current' || v === 'all' || QUARTER_NAME.test(v) || UUID.test(v);
}

export function parseHubState(p: Params): HubState {
	const s: HubState = { ...EMPTY_STATE };
	const legacyQ = get(p, 'q');
	s.search = (get(p, 'search') ?? (legacyQ && !QUARTER_NAME.test(legacyQ) ? legacyQ : '') ?? '').slice(0, 80);
	s.owner = list(get(p, 'owner'), (v) => UUID.test(v) || v === 'none');
	s.lead = list(get(p, 'lead'), (v) => UUID.test(v) || v === 'none');
	s.status = list(get(p, 'status'), (v) => SLUG.test(v));
	s.dept = list(get(p, 'dept'), (v) => UUID.test(v) || SLUG.test(v));
	s.subdept = list(get(p, 'subdept'), (v) => UUID.test(v) || SLUG.test(v));
	s.tag = list(get(p, 'tag'), (v) => UUID.test(v) || SLUG.test(v));
	s.client = list(get(p, 'client'), (v) => UUID.test(v) || v === 'none');
	s.discipline = list(get(p, 'discipline'), (v) => UUID.test(v) || SLUG.test(v) || v === 'none');
	const q = get(p, 'quarter') ?? (legacyQ && QUARTER_NAME.test(legacyQ) ? legacyQ : undefined);
	s.quarter = q && isValidQuarter(q) ? q : null;
	const due = get(p, 'due');
	s.due = due && isValidDue(due) ? due : null;
	const closed = get(p, 'closed');
	s.closed = closed === '1' ? true : closed === '0' ? false : null;
	s.archived = get(p, 'archived') === '1';
	const sort = get(p, 'sort');
	if (sort) {
		if (sort === 'due_asc' || sort === 'due_desc') s.sort = { key: 'due', dir: sort === 'due_asc' ? 'asc' : 'desc' };
		else {
			const [k, d] = sort.split(':');
			if (SORT_KEYS.some((x) => x.key === k)) s.sort = { key: k as SortKey, dir: d === 'desc' ? 'desc' : 'asc' };
		}
	}
	const group = get(p, 'group');
	s.group = group && COL.test(group) ? group : null;
	const view = get(p, 'view');
	s.view = view === 'list' ? 'table' : view === 'kanban' ? 'board' : HUB_VIEWS.includes(view as HubView) ? (view as HubView) : null;
	const cols = get(p, 'cols');
	s.cols = cols ? list(cols, (v) => COL.test(v)) : null;
	return s;
}

/** URL query for a state. Order is fixed so equal states give equal URLs. */
export function serializeHubState(s: HubState): URLSearchParams {
	const out = new URLSearchParams();
	if (s.search.trim()) out.set('search', s.search.trim());
	for (const k of LIST_KEYS) if (s[k].length) out.set(k, s[k].join(','));
	if (s.quarter) out.set('quarter', s.quarter);
	if (s.due) out.set('due', s.due);
	if (s.closed !== null) out.set('closed', s.closed ? '1' : '0');
	if (s.archived) out.set('archived', '1');
	if (s.sort) out.set('sort', `${s.sort.key}:${s.sort.dir}`);
	if (s.group) out.set('group', s.group);
	if (s.view) out.set('view', s.view);
	if (s.cols) out.set('cols', s.cols.join(','));
	return out;
}

export function hubQueryString(s: HubState): string {
	const q = serializeHubState(s).toString();
	return q ? `?${q}` : '';
}

/** Filters that narrow the row set (not view, sort, group, columns). */
export function filterCount(s: HubState): number {
	return (s.search.trim() ? 1 : 0) + LIST_KEYS.filter((k) => s[k].length).length + (s.due ? 1 : 0);
}

/** A key for "the same rows": changes when the filter changes, not when the view does. */
export function rowSetKey(s: HubState): string {
	return JSON.stringify([s.search.trim(), ...LIST_KEYS.map((k) => s[k]), s.quarter, s.due, s.closed, s.archived]);
}

/** Old hub link → hub tab + state (kind picks the tab). */
export function legacyToState(p: Params): { kind: string | null; state: HubState } {
	const kind = get(p, 'kind') ?? null;
	return { kind, state: parseHubState(p) };
}

export interface DueRange {
	from?: string;
	to?: string;
	none?: boolean;
	overdue?: boolean;
}

function addDays(day: string, n: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** Resolve a due filter against today's local date (YYYY-MM-DD). */
export function dueRange(due: string | null, today: string): DueRange | null {
	if (!due) return null;
	switch (due) {
		case 'overdue': return { to: addDays(today, -1), overdue: true };
		case 'today': return { from: today, to: today };
		case 'week': return { from: today, to: addDays(today, 6) };
		case 'month': return { from: today, to: addDays(today, 29) };
		case 'none': return { none: true };
	}
	const [from, to] = due.split('..');
	return { from: DATE.test(from) ? from : undefined, to: DATE.test(to) ? to : undefined };
}

export const DUE_LABELS: Record<string, string> = {
	overdue: 'Overdue', today: 'Due today', week: 'Due in 7 days', month: 'Due in 30 days', none: 'No due date',
};

export function dueLabel(due: string): string {
	if (DUE_LABELS[due]) return DUE_LABELS[due];
	const [from, to] = due.split('..');
	if (from && to) return `Due ${from} to ${to}`;
	return from ? `Due from ${from}` : `Due by ${to}`;
}
