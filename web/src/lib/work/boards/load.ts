// Board engine — server loaders (spec §6). RLS-scoped createClient only.
//
// Reads are always ranged (PostgREST caps an un-ranged select at 1000 rows,
// silently) with a unique tiebreak (id) so pages never overlap or skip. `.in()`
// lists are chunked: thousands of uuids in the GET url kill the request.
//
// Fails soft while 0141 is not applied: a missing `boards` table yields no
// boards, so the old pages keep working during the migration gap.

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { loadFormSupportingData } from '@/app/(app)/the-work/_lib';
import { CHILD_KINDS_FOR_PARENT } from '@/app/(app)/the-work/hierarchy';
import { sanitizeQuery } from '@/components/nav/searchShared';
import {
	WORK_ROW_COLUMNS,
	parseBaseFilter,
	parseColumns,
	type Board,
	type BoardContext,
	type CustomColumn,
	type CustomValue,
	type WorkRow,
} from './types';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const PAGE_SIZE = 300;
const IN_CHUNK = 150;

function isMissingTable(error: { code?: string; message: string } | null): boolean {
	if (!error) return false;
	return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/.test(error.message);
}

async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
	const uniq = [...new Set(ids)].filter(Boolean);
	const chunks: string[][] = [];
	for (let i = 0; i < uniq.length; i += IN_CHUNK) chunks.push(uniq.slice(i, i + IN_CHUNK));
	const res = await Promise.all(chunks.map(run));
	const out: T[] = [];
	for (const r of res) {
		if (r.error) throw new Error(r.error.message);
		out.push(...(r.data ?? []));
	}
	return out;
}

function toBoard(r: Record<string, unknown>): Board {
	return {
		id: r.id as string,
		slug: r.slug as string,
		name: r.name as string,
		icon: (r.icon as string | null) ?? null,
		section: r.section as Board['section'],
		source: r.source as Board['source'],
		base_filter: parseBaseFilter(r.base_filter),
		group_by: (r.group_by as string) || 'status',
		default_view: (r.default_view as Board['default_view']) || 'table',
		columns: parseColumns(r.columns),
		visibility: (r.visibility as Board['visibility']) || 'module',
		is_system: !!r.is_system,
		position: (r.position as number) ?? 0,
		created_by: (r.created_by as string | null) ?? null,
	};
}

const BOARD_COLUMNS_SELECT = 'id, slug, name, icon, section, source, base_filter, group_by, default_view, columns, visibility, is_system, position, created_by';

export interface BoardNavEntry {
	id: string;
	slug: string;
	name: string;
	icon: string | null;
	section: Board['section'];
	favorite: boolean;
}

/** Side nav: every board the viewer can see + their favourites. */
export const loadBoardNav = cache(async (): Promise<{ boards: BoardNavEntry[]; ready: boolean }> => {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { boards: [], ready: false };
	const [{ data, error }, { data: favs }] = await Promise.all([
		supabase.from('boards').select('id, slug, name, icon, section, position').is('archived_at', null).order('section').order('position').order('name').range(0, 499),
		supabase.from('board_favorites').select('board_id').eq('user_id', auth.user.id),
	]);
	if (isMissingTable(error)) return { boards: [], ready: false };
	const fav = new Set((favs ?? []).map((f) => f.board_id as string));
	return {
		ready: true,
		boards: (data ?? []).map((b) => ({
			id: b.id as string,
			slug: b.slug as string,
			name: b.name as string,
			icon: (b.icon as string | null) ?? null,
			section: b.section as Board['section'],
			favorite: fav.has(b.id as string),
		})),
	};
});

export const loadBoard = cache(async (slug: string): Promise<{ board: Board; customColumns: CustomColumn[]; canEdit: boolean } | null> => {
	const supabase = await createClient();
	const { data, error } = await supabase.from('boards').select(BOARD_COLUMNS_SELECT).eq('slug', slug).is('archived_at', null).maybeSingle();
	if (error || !data) return null;
	const board = toBoard(data);
	const [{ data: cols }, { data: canEdit }] = await Promise.all([
		supabase.from('board_columns').select('id, key, label, type, options, position').eq('board_id', board.id).order('position').range(0, 199),
		supabase.rpc('can_edit_board', { p_board_id: board.id }),
	]);
	return {
		board,
		customColumns: (cols ?? []).map((c) => ({ ...c, options: (c.options ?? {}) as CustomColumn['options'] })) as CustomColumn[],
		canEdit: !!canEdit,
	};
});

/** Today's quarter from starts_on/ends_on (is_current has been found stale). */
export async function currentQuarterId(supabase: Supabase): Promise<string | null> {
	const today = new Date().toISOString().slice(0, 10);
	const { data } = await supabase.from('quarters').select('id, starts_on, ends_on').lte('starts_on', today).gte('ends_on', today).limit(1);
	return (data?.[0]?.id as string | undefined) ?? null;
}

export interface RowQuery {
	search?: string;
	owners?: string[];
	/** Show closed (terminal) items too. Default: hidden. */
	includeClosed?: boolean;
	/** The board's "Archived" view: only soft-deleted rows, every status. */
	archived?: boolean;
	offset?: number;
}

export interface BoardRows {
	rows: WorkRow[];
	total: number;
	offset: number;
	hasMore: boolean;
}

/** One page of a work_items board, filtered server-side. */
export async function loadBoardRows(board: Board, q: RowQuery, statusesByKind: BoardContext['statusesByKind']): Promise<BoardRows> {
	const supabase = await createClient();
	const f = board.base_filter;
	const kinds = f.kinds?.length ? f.kinds : ['task'];
	const offset = Math.max(0, q.offset ?? 0);

	let query = supabase.from('projects').select(WORK_ROW_COLUMNS, { count: 'exact' }).in('kind', kinds).eq('archived', q.archived === true);
	if (f.quarter) {
		const qid = f.quarter === 'current' ? await currentQuarterId(supabase) : f.quarter;
		if (qid) query = query.eq('quarter_id', qid);
	}
	if (f.department_tag_ids?.length) query = query.in('department_tag_id', f.department_tag_ids);
	if (f.client_id) query = query.eq('client_id', f.client_id);
	if (f.owner_id) query = query.eq('owner_id', f.owner_id);
	if (q.owners?.length) query = query.in('owner_id', q.owners.slice(0, 50));
	const search = sanitizeQuery(q.search ?? '');
	if (search) query = query.ilike('name', `%${search}%`);
	// Archived rows are shown whatever their status: the point is to find them.
	// A search also covers done items, so finished work can always be found.
	if (!q.includeClosed && !q.archived && !search) {
		const terminal = [...new Set(kinds.flatMap((k) => (statusesByKind[k] ?? []).filter((s) => s.is_terminal).map((s) => s.slug)))];
		if (terminal.length) query = query.not('status', 'in', `(${terminal.join(',')})`);
	}
	const { data, error, count } = await query
		.order('sort_order', { ascending: true, nullsFirst: false })
		.order('ends_at', { ascending: true, nullsFirst: false })
		.order('id', { ascending: true })
		.range(offset, offset + PAGE_SIZE - 1);
	if (error) throw new Error(error.message);
	const rows = (data ?? []) as unknown as WorkRow[];
	const total = count ?? rows.length;
	return { rows, total, offset, hasMore: offset + rows.length < total };
}

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; email: string };
type TagLite = { id: string; slug: string; label: string; color: string | null; category: string | null; parent_tag_id: string | null };

/** Department / sub-department / all-tag lookups from the tags table. */
export function tagMaps(rows: TagLite[]): Pick<BoardContext, 'departments'> & Required<Pick<BoardContext, 'subdepts' | 'tags'>> {
	const departments: BoardContext['departments'] = {};
	const subdepts: NonNullable<BoardContext['subdepts']> = {};
	const tags: NonNullable<BoardContext['tags']> = {};
	for (const t of rows) {
		tags[t.id] = { label: t.label, slug: t.slug, category: t.category };
		if (t.category === 'department') departments[t.id] = { label: t.label, color: t.color };
		if (t.category === 'sub_team') subdepts[t.id] = { label: t.label, parent: t.parent_tag_id };
	}
	return { departments, subdepts, tags };
}

/** Assignment disciplines (0162). Empty when the table is missing. */
export const loadDisciplines = cache(async (): Promise<NonNullable<BoardContext['disciplines']>> => {
	const supabase = await createClient();
	const { data, error } = await supabase.from('work_disciplines').select('id, slug, label, position').is('archived_at', null).order('position').range(0, 199);
	if (error) return {};
	return Object.fromEntries((data ?? []).map((d) => [d.id as string, { label: d.label as string, slug: d.slug as string, position: (d.position as number) ?? 0 }]));
});

export function peopleFromProfiles(profiles: ProfileLite[]): BoardContext['people'] {
	const people: BoardContext['people'] = {};
	for (const p of profiles) {
		const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
		const initials = ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() || p.email.slice(0, 2).toUpperCase();
		people[p.id] = { name, initials };
	}
	return people;
}

/**
 * A context with people + statuses only, no row lookups: enough for the "+ New"
 * modal on pages that render no board (Self → Overview). Avoids the ~10
 * row-scoped queries loadBoardContext runs.
 */
export function lightBoardContext(support: { statusesByKind: BoardContext['statusesByKind']; profiles: unknown[]; tags?: unknown[]; quarters?: unknown[] }): BoardContext {
	const maps = tagMaps((support.tags ?? []) as TagLite[]);
	const quarters: BoardContext['quarters'] = {};
	for (const q of (support.quarters ?? []) as { id: string; name: string }[]) quarters[q.id] = { name: q.name };
	return {
		statusesByKind: support.statusesByKind,
		people: peopleFromProfiles(support.profiles as ProfileLite[]),
		...maps,
		quarters, parents: {}, clients: {}, progress: {}, followers: {}, customValues: {}, customColumns: [],
	};
}

/** Labels, colours, rollups and custom values for a set of rows. */
export async function loadBoardContext(rows: WorkRow[], customColumns: CustomColumn[]): Promise<BoardContext> {
	const supabase = await createClient();
	const support = await loadFormSupportingData();
	const ids = rows.map((r) => r.id);
	const parentIds = rows.map((r) => r.parent_id).filter((x): x is string => !!x);
	const clientIds = rows.map((r) => r.client_id).filter((x): x is string => !!x);
	const containerIds = rows.filter((r) => CHILD_KINDS_FOR_PARENT[r.kind]).map((r) => r.id);

	const [parents, clients, children, followers, values] = await Promise.all([
		inChunks<{ id: string; name: string; kind: string }>(parentIds, (c) => supabase.from('projects').select('id, name, kind').in('id', c)),
		inChunks<{ id: string; display_name: string }>(clientIds, (c) => supabase.from('clients_v2').select('id, display_name').in('id', c)),
		inChunks<{ parent_id: string; kind: string; status: string }>(containerIds, (c) =>
			supabase.from('projects').select('parent_id, kind, status').in('parent_id', c).eq('archived', false).range(0, 4999)),
		inChunks<{ work_item_id: string; user_id: string }>(ids, (c) => supabase.from('work_item_followers').select('work_item_id, user_id').in('work_item_id', c).range(0, 4999)),
		customColumns.length
			? inChunks<{ board_column_id: string; work_item_id: string; value_text: string | null; value_number: number | null; value_date: string | null; value_bool: boolean | null; value_uuid: string | null }>(
				ids,
				(c) => supabase.from('work_item_field_values')
					.select('board_column_id, work_item_id, value_text, value_number, value_date, value_bool, value_uuid')
					.in('board_column_id', customColumns.map((x) => x.id)).in('work_item_id', c).range(0, 9999),
			)
			: Promise.resolve([]),
	]);

	const statusesByKind = support.statusesByKind;
	const terminal = (kind: string, slug: string) => (statusesByKind[kind] ?? []).find((s) => s.slug === slug)?.is_terminal;
	const progress: BoardContext['progress'] = {};
	for (const ch of children) {
		const p = (progress[ch.parent_id] ??= { done: 0, total: 0 });
		if (/discard|archived|abandoned/.test(ch.status)) continue; // discarded children don't count
		p.total++;
		if (terminal(ch.kind, ch.status)) p.done++;
	}

	const followerMap: BoardContext['followers'] = {};
	for (const f of followers) (followerMap[f.work_item_id] ??= []).push(f.user_id);

	const colById = new Map(customColumns.map((c) => [c.id, c]));
	const customValues: BoardContext['customValues'] = {};
	for (const v of values) {
		const col = colById.get(v.board_column_id);
		if (!col) continue;
		let value: CustomValue = null;
		if (col.type === 'number') value = v.value_number;
		else if (col.type === 'checkbox') value = v.value_bool;
		else if (col.type === 'date') value = v.value_date;
		else if (col.type === 'person') value = v.value_uuid;
		else value = v.value_text;
		(customValues[v.work_item_id] ??= {})[col.key] = value;
	}

	const people = peopleFromProfiles(support.profiles as ProfileLite[]);
	const { departments, subdepts, tags } = tagMaps(support.tags as TagLite[]);
	const disciplines = await loadDisciplines();
	const quarters: BoardContext['quarters'] = {};
	for (const q of support.quarters as { id: string; name: string }[]) quarters[q.id] = { name: q.name };

	return {
		statusesByKind,
		people,
		departments,
		subdepts,
		tags,
		disciplines,
		quarters,
		parents: Object.fromEntries(parents.map((p) => [p.id, { name: p.name, kind: p.kind }])),
		clients: Object.fromEntries(clients.map((c) => [c.id, { name: c.display_name }])),
		progress,
		followers: followerMap,
		customValues,
		customColumns,
	};
}

export { isMissingTable };
