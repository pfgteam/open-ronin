// The Work hub: server-side query layer (rework 5.2, D2, D3, D8).
//
// One function builds the filtered query for a hub tab or board from the
// URL state; everything else uses it so the counts, the facets, the pages
// and "select all" can never disagree:
//
//   - tabCounts:   head-only count per hub tab under the CURRENT filters (D2)
//   - facets:      id + the group column over the WHOLE filtered set, so the
//                  group headers carry true counts before a row renders (D8)
//   - first page:  the first FIRST_PAGE rows, server-rendered
//   - pages:       the rest, fetched by the browser in the background
//   - ids:         every id in the set, for "select all selects all"
//
// RLS-scoped (createClient) everywhere. Reads are ranged with an id
// tiebreak (PostgREST silently caps an un-ranged select at 1000 rows).

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { loadFormSupportingData } from '@/app/(app)/the-work/_lib';
import { sanitizeQuery } from '@/components/nav/searchShared';
import { WORK_ROW_COLUMNS, type BoardContext, type CustomColumn, type WorkRow } from '@/lib/work/boards/types';
import { loadBoard, loadBoardContext, loadDisciplines, loadBoardNav, isMissingTable } from '@/lib/work/boards/load';
import { localToday } from '@/lib/work/boards/groups';
import { CLIENT_TABS, HUB_TABS, PENDING_DEF, clientTab, disciplineTab, hubHref, hubTab, pluralOf, type HubDef } from './tabs';
import { dueRange, type HubState } from './state';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const FIRST_PAGE = 400;
export const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuarterLite { id: string; name: string; starts_on: string; ends_on: string }

export interface HubResolve {
	kinds: string[];
	/** null = no quarter filter. */
	quarterId: string | null;
	terminal: string[];
	tagIds: string[] | null;
	deptIds: string[];
	subdeptIds: string[];
	disciplineIds: string[];
	disciplineNone: boolean;
	today: string;
}

/** Group-by key → the projects column that holds it. */
export const GROUP_COLUMN: Record<string, string> = {
	status: 'status', owner: 'owner_id', department: 'department_tag_id', quarter: 'quarter_id', client: 'client_id',
	urgency: 'priority', lead: 'project_lead_id', subdept: 'sub_team_tag_id', severity: 'severity', discipline: 'discipline_id',
	parent: 'parent_id', kind: 'kind',
};

const SORT_COLUMN: Record<string, string> = {
	due: 'ends_at', start: 'starts_at', name: 'name', updated: 'updated_at', created: 'created_at', urgency: 'priority', severity: 'severity',
};

export const loadQuarters = cache(async (): Promise<QuarterLite[]> => {
	const supabase = await createClient();
	const { data } = await supabase.from('quarters').select('id, name, starts_on, ends_on').order('starts_on').range(0, 199);
	return (data ?? []) as QuarterLite[];
});

/** Today's quarter from the dates (is_current has been found stale). */
export function currentQuarterOf(quarters: QuarterLite[], today: string): QuarterLite | null {
	return quarters.find((q) => q.starts_on <= today && q.ends_on >= today) ?? null;
}

export function resolveQuarterId(def: HubDef, state: HubState, quarters: QuarterLite[], today: string): string | null {
	const q = state.quarter ?? (def.quarterDefault === 'current' ? 'current' : 'all');
	if (q === 'all') return null;
	if (q === 'current') return currentQuarterOf(quarters, today)?.id ?? null;
	if (UUID.test(q)) return q;
	return quarters.find((x) => x.name === q)?.id ?? null;
}

export async function resolveHub(def: HubDef, state: HubState, today = localToday()): Promise<HubResolve & { quarters: QuarterLite[] }> {
	const [support, quarters, disciplines] = await Promise.all([loadFormSupportingData(), loadQuarters(), loadDisciplines()]);
	const tags = support.tags as { id: string; slug: string; category: string | null }[];
	const idOrSlug = (vals: string[], pool: { id: string; slug: string }[]) =>
		vals.map((v) => (UUID.test(v) ? v : pool.find((t) => t.slug === v)?.id)).filter((x): x is string => !!x);
	const terminal = [...new Set(def.kinds.flatMap((k) => (support.statusesByKind[k] ?? []).filter((s) => s.is_terminal).map((s) => s.slug)))];
	const discPool = Object.entries(disciplines).map(([id, d]) => ({ id, slug: d.slug }));
	return {
		kinds: def.kinds,
		quarterId: resolveQuarterId(def, state, quarters, today),
		terminal,
		tagIds: state.tag.length ? idOrSlug(state.tag, tags) : null,
		deptIds: idOrSlug(state.dept, tags.filter((t) => t.category === 'department')),
		subdeptIds: idOrSlug(state.subdept, tags.filter((t) => t.category === 'sub_team')),
		disciplineIds: idOrSlug(def.pinnedDiscipline ? [def.pinnedDiscipline] : state.discipline.filter((d) => d !== 'none'), discPool),
		disciplineNone: !def.pinnedDiscipline && state.discipline.includes('none'),
		today,
		quarters,
	};
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Apply the hub filters to a projects query. Typed loosely on purpose: the
 * PostgREST builder's generics change with every select shape, and this one
 * function is shared by the count, facet, page and id queries.
 */
export function applyHubFilters(q: any, def: HubDef, state: HubState, r: HubResolve): any {
	q = q.in('kind', r.kinds).eq('archived', state.archived === true);
	if (def.pinned?.client_id) q = q.eq('client_id', def.pinned.client_id);
	if (def.pinned?.owner_id) q = q.eq('owner_id', def.pinned.owner_id);
	if (def.pinned?.department_tag_ids?.length) q = q.in('department_tag_id', def.pinned.department_tag_ids);
	if (def.pinnedStatus?.length) q = q.in('status', def.pinnedStatus);
	if (r.quarterId) q = q.eq('quarter_id', r.quarterId);

	const people = (col: string, vals: string[]) => {
		const ids = vals.filter((v) => UUID.test(v));
		const none = vals.includes('none');
		if (none && ids.length) return q.or(`${col}.in.(${ids.join(',')}),${col}.is.null`);
		if (none) return q.is(col, null);
		if (ids.length) return q.in(col, ids);
		return q;
	};
	if (state.owner.length) q = people('owner_id', state.owner);
	if (state.lead.length) q = people('project_lead_id', state.lead);
	if (state.client.length) q = people('client_id', state.client);
	if (state.status.length) q = q.in('status', state.status);
	if (r.deptIds.length) q = q.in('department_tag_id', r.deptIds);
	if (r.subdeptIds.length) q = q.in('sub_team_tag_id', r.subdeptIds);
	if (r.disciplineNone && r.disciplineIds.length) q = q.or(`discipline_id.in.(${r.disciplineIds.join(',')}),discipline_id.is.null`);
	else if (r.disciplineNone) q = q.is('discipline_id', null);
	else if (r.disciplineIds.length) q = q.in('discipline_id', r.disciplineIds);
	if (r.tagIds) q = r.tagIds.length ? q.in('work_item_tags.tag_id', r.tagIds) : q.eq('id', '00000000-0000-0000-0000-000000000000');

	const due = dueRange(state.due, r.today);
	if (due?.none) q = q.is('ends_at', null);
	else if (due) {
		if (due.from) q = q.gte('ends_at', due.from);
		if (due.to) q = q.lte('ends_at', due.to);
	}

	const search = sanitizeQuery(state.search ?? '');
	if (search) q = q.ilike('name', `%${search}%`);
	// Done items are hidden unless asked for (closed=1). Archived rows and a
	// search show every status: the point is to find them. Overdue never
	// includes closed work.
	const showClosed = state.closed === true || state.archived || (!!search && state.closed !== false);
	if ((!showClosed || due?.overdue) && r.terminal.length) q = q.not('status', 'in', `(${r.terminal.join(',')})`);
	return q;
}

function selectWithTags(columns: string, r: HubResolve): string {
	return r.tagIds?.length ? `${columns}, work_item_tags!inner(tag_id)` : columns;
}

function orderRows(q: any, state: HubState): any {
	const col = state.sort ? SORT_COLUMN[state.sort.key] : undefined;
	if (col) q = q.order(col, { ascending: state.sort!.dir !== 'desc', nullsFirst: false });
	else q = q.order('sort_order', { ascending: true, nullsFirst: false }).order('ends_at', { ascending: true, nullsFirst: false });
	return q.order('id', { ascending: true });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function stripJoin(rows: Record<string, unknown>[]): WorkRow[] {
	return rows.map((row) => {
		if (!('work_item_tags' in row)) return row as unknown as WorkRow;
		const rest = { ...row };
		delete rest.work_item_tags;
		return rest as unknown as WorkRow;
	});
}

export async function countHub(supabase: Supabase, def: HubDef, state: HubState, r: HubResolve): Promise<number> {
	const { count, error } = await applyHubFilters(supabase.from('projects').select(selectWithTags('id', r), { count: 'exact', head: true }), def, state, r);
	if (error) throw new Error(error.message);
	return count ?? 0;
}

/** id + group value over the whole filtered set (paged in parallel). */
export async function facetHub(supabase: Supabase, def: HubDef, state: HubState, r: HubResolve, total: number, groupBy: string | null): Promise<{ ids: string[]; groups: Record<string, number> }> {
	const col = groupBy ? GROUP_COLUMN[groupBy] : undefined;
	const columns = col && col !== 'id' ? `id, ${col}` : 'id';
	const pages = Math.max(1, Math.ceil(total / PAGE));
	const res = await Promise.all(Array.from({ length: pages }, (_, i) =>
		orderRows(applyHubFilters(supabase.from('projects').select(selectWithTags(columns, r)), def, state, r), state).range(i * PAGE, i * PAGE + PAGE - 1)));
	const ids: string[] = [];
	const groups: Record<string, number> = {};
	for (const { data, error } of res) {
		if (error) throw new Error(error.message);
		for (const row of (data ?? []) as Record<string, unknown>[]) {
			ids.push(row.id as string);
			if (col) {
				const k = (row[col] as string | null) ?? '__none__';
				groups[k] = (groups[k] ?? 0) + 1;
			}
		}
	}
	return { ids, groups };
}

export async function pageHub(supabase: Supabase, def: HubDef, state: HubState, r: HubResolve, offset: number, limit: number): Promise<WorkRow[]> {
	const { data, error } = await orderRows(applyHubFilters(supabase.from('projects').select(selectWithTags(WORK_ROW_COLUMNS, r)), def, state, r), state)
		.range(offset, offset + limit - 1);
	if (error) throw new Error(error.message);
	return stripJoin((data ?? []) as Record<string, unknown>[]);
}

/**
 * D2: each tab's count under the current filters. A quarter the user picked
 * carries to the tabs that share the current tab's quarter default (D3:
 * goals, tasks, recurring, process and bugs are not quarter-filtered unless
 * the user adds it THERE), so picking 26-3 on Projects doesn't zero Tasks.
 */
export function stateForTab(state: HubState, from: Pick<HubDef, 'quarterDefault'>, to: Pick<HubDef, 'quarterDefault'>): HubState {
	return from.quarterDefault === to.quarterDefault ? state : { ...state, quarter: null };
}

export async function tabCounts(state: HubState, today: string, from: Pick<HubDef, 'quarterDefault'>, defs: HubDef[] = HUB_TABS): Promise<Record<string, number | null>> {
	const supabase = await createClient();
	const out: Record<string, number | null> = {};
	await Promise.all(defs.map(async (t) => {
		try {
			const s = stateForTab(state, from, t);
			const r = await resolveHub(t, s, today);
			out[t.key] = await countHub(supabase, t, s, r);
		} catch {
			out[t.key] = null;
		}
	}));
	return out;
}

// ------------------------------------------------------------- definitions

/**
 * The HubDef for a hub tab (code definition, with the DB board row's column
 * config and id when 0163 is applied) or a custom board (/the-work/b/<slug>).
 */
export async function hubDefFor(keyOrSlug: string, mode: 'tab' | 'board' | 'pending' | 'client'): Promise<{ def: HubDef; customColumns: CustomColumn[]; canEdit: boolean } | null> {
	if (mode === 'pending') return { def: PENDING_DEF, customColumns: [], canEdit: false };
	if (mode === 'client') {
		if (keyOrSlug.startsWith('d-')) {
			const slug = keyOrSlug.slice(2);
			const disc = Object.values(await loadDisciplines()).find((d) => d.slug === slug);
			return disc ? { def: disciplineTab(disc.slug, disc.label), customColumns: [], canEdit: false } : null;
		}
		const def = clientTab(keyOrSlug);
		return def ? { def, customColumns: [], canEdit: false } : null;
	}
	if (mode === 'tab') {
		const base = hubTab(keyOrSlug);
		if (!base) return null;
		const loaded = await loadBoard(base.slug).catch(() => null);
		if (!loaded) return { def: { ...base, boardId: null }, customColumns: [], canEdit: false };
		const cols = loaded.board.columns.filter((c) => c.visible).map((c) => c.key);
		return { def: { ...base, boardId: loaded.board.id, columns: cols.length ? cols : base.columns }, customColumns: loaded.customColumns, canEdit: loaded.canEdit };
	}
	const loaded = await loadBoard(keyOrSlug);
	if (!loaded || loaded.board.source !== 'work_items') return null;
	const b = loaded.board;
	const kinds = b.base_filter.kinds?.length ? b.base_filter.kinds : ['task'];
	const cols = b.columns.filter((c) => c.visible).map((c) => c.key);
	return {
		def: {
			key: b.slug, slug: b.slug, label: b.name, noun: (kinds[0] ?? 'item').replace(/_/g, ' '), plural: pluralOf((kinds[0] ?? 'item').replace(/_/g, ' ')), kinds,
			quarterDefault: b.base_filter.quarter === 'current' ? 'current' : 'all',
			group: b.group_by || 'status', columns: cols.length ? cols : ['owner', 'status', 'due'], hub: false,
			pinned: { client_id: b.base_filter.client_id, department_tag_ids: b.base_filter.department_tag_ids, owner_id: b.base_filter.owner_id },
			boardId: b.id,
		},
		customColumns: loaded.customColumns,
		canEdit: loaded.canEdit,
	};
}

export interface HubTabLink { key: string; label: string; href: string; quarterDefault: 'current' | 'all'; count: number | null }

/** The tab strip a def sits in (the work hub or Client Work), with counts under the current filters. */
export async function tabStrip(def: HubDef, state: HubState, today: string): Promise<HubTabLink[]> {
	let defs: HubDef[] = [];
	if (def.tabSet === 'client') {
		const disciplines = Object.values(await loadDisciplines()).sort((a, b) => a.position - b.position);
		defs = [...CLIENT_TABS, ...disciplines.map((d) => disciplineTab(d.slug, d.label))];
	} else if (def.hub) defs = HUB_TABS;
	if (!defs.length) return [];
	const counts = await tabCounts(state, today, def, defs);
	return defs.map((d) => ({ key: d.key, label: d.label, href: hubHref(d), quarterDefault: d.quarterDefault, count: counts[d.key] ?? null }));
}

export interface HubPayload {
	rows: WorkRow[];
	total: number;
	ids: string[];
	groupCounts: Record<string, number>;
	tabs: HubTabLink[];
	ctx: BoardContext;
	quarters: QuarterLite[];
	currentQuarterId: string | null;
	quarterId: string | null;
	favorite: boolean;
	ready: boolean;
}

/** Everything the hub screen needs for its first paint. */
export async function loadHub(def: HubDef, state: HubState, groupBy: string | null, customColumns: BoardContext['customColumns']): Promise<HubPayload> {
	const supabase = await createClient();
	const today = localToday();
	const r = await resolveHub(def, state, today);
	const total = await countHub(supabase, def, state, r);
	const [facets, rows, counts, nav] = await Promise.all([
		facetHub(supabase, def, state, r, total, groupBy),
		pageHub(supabase, def, state, r, 0, FIRST_PAGE),
		tabStrip(def, state, today),
		loadBoardNav().catch(() => ({ boards: [], ready: false })),
	]);
	const ctx = await loadBoardContext(rows, customColumns);
	for (const q of r.quarters) ctx.quarters[q.id] ??= { name: q.name };
	return {
		rows,
		total,
		ids: facets.ids,
		groupCounts: facets.groups,
		tabs: counts,
		ctx,
		quarters: r.quarters,
		currentQuarterId: currentQuarterOf(r.quarters, today)?.id ?? null,
		quarterId: r.quarterId,
		favorite: !!def.boardId && nav.boards.some((b) => b.id === def.boardId && b.favorite),
		ready: true,
	};
}

export { isMissingTable };
