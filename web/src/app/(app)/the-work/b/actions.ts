'use server';

// Board writes (spec §6). Every action runs with the viewer's session (RLS
// decides), re-validates its input against a whitelist, and returns a plain
// result the client uses for optimistic UI + rollback.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { PARENT_KIND_FOR, isValidParent } from '../hierarchy';
import { WORK_ROW_COLUMNS, type BoardContext, type CustomColumnType, type WorkRow } from '@/lib/work/boards/types';
import { currentQuarterId, lightBoardContext } from '@/lib/work/boards/load';
import { loadFormSupportingData } from '../_lib';
import { mapStatus } from '@/lib/work/fields';

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URGENCY = new Set(['urgent', 'high', 'medium', 'low']);

/**
 * Fields a board cell or the item drawer may write on public.projects. The
 * rework (D11) makes every planning field editable; each save writes ONE
 * field (patch semantics: nothing else in the row is touched).
 */
export type EditableField =
	| 'name' | 'status' | 'owner_id' | 'starts_at' | 'ends_at' | 'department_tag_id' | 'quarter_id' | 'client_id' | 'priority' | 'parent_id' | 'description_md'
	| 'project_lead_id' | 'team_lead_id' | 'sub_team_tag_id' | 'discipline_id' | 'severity' | 'environment' | 'is_regression'
	| 'manual_progress' | 'manual_health' | 'notes_md' | 'twelve_week_goal_md' | 'lead_measure_md' | 'lag_measure_md' | 'process_action_md'
	| 'estimated_hours' | 'budget_cents' | 'target_value' | 'target_progress' | 'target_unit' | 'recurrence_rule' | 'is_rock' | 'is_lead_indicator'
	| 'source_url' | 'timeframe_grain' | 'timeframe_value';
const EDITABLE = new Set<EditableField>([
	'name', 'status', 'owner_id', 'starts_at', 'ends_at', 'department_tag_id', 'quarter_id', 'client_id', 'priority', 'parent_id', 'description_md',
	'project_lead_id', 'team_lead_id', 'sub_team_tag_id', 'discipline_id', 'severity', 'environment', 'is_regression',
	'manual_progress', 'manual_health', 'notes_md', 'twelve_week_goal_md', 'lead_measure_md', 'lag_measure_md', 'process_action_md',
	'estimated_hours', 'budget_cents', 'target_value', 'target_progress', 'target_unit', 'recurrence_rule', 'is_rock', 'is_lead_indicator',
	'source_url', 'timeframe_grain', 'timeframe_value',
]);
const MARKDOWN = new Set<EditableField>(['description_md', 'notes_md', 'twelve_week_goal_md', 'lead_measure_md', 'lag_measure_md', 'process_action_md']);
const NUMERIC = new Set<EditableField>(['manual_progress', 'estimated_hours', 'budget_cents', 'target_value', 'target_progress']);
const BOOLEAN = new Set<EditableField>(['is_regression', 'is_rock', 'is_lead_indicator']);
type DbValue = string | number | boolean | null;

/**
 * Rework phase 0: a bulk action never reports success it did not perform.
 * These used to slice the selection to 200 silently while the screen
 * updated every selected row. Now a call takes at most BATCH ids and refuses
 * more; the list screen sends a big selection in batches with a progress
 * bar (components/work/hub/useBatches.ts).
 */
const BATCH = 500;
const TOO_MANY = `Too many items in one request (max ${BATCH}). Send them in batches.`;
function batchIds(ids: string[]): string[] | null {
	const list = [...new Set(ids)].filter((x) => UUID.test(x));
	return list.length > BATCH ? null : list;
}

function friendly(message: string): string {
	// enforce_work_item_parent() raises readable text; RLS denials don't.
	if (/row-level security|permission denied|42501/i.test(message)) return "You can't edit this board.";
	return message.replace(/^.*?ERROR:\s*/, '');
}

async function session() {
	const supabase = await createClient();
	const { data } = await supabase.auth.getUser();
	if (!data.user) return null;
	if (!(await hasModuleAccess('the_work'))) return null;
	return { supabase, userId: data.user.id };
}

async function validateValue(
	supabase: Awaited<ReturnType<typeof createClient>>,
	field: EditableField,
	value: unknown,
	kind: string,
): Promise<{ ok: true; value: DbValue } | { ok: false; error: string }> {
	if (value === null || value === '') {
		if (field === 'name' || field === 'status') return { ok: false, error: `${field === 'name' ? 'Name' : 'Status'} can't be empty.` };
		return { ok: true, value: null };
	}
	if (typeof value !== 'string') return { ok: false, error: 'Invalid value.' };
	if (MARKDOWN.has(field)) {
		if (value.length > 20000) return { ok: false, error: 'Too long (20,000 characters max).' };
		return { ok: true, value: value.trim() || null };
	}
	if (NUMERIC.has(field)) {
		const n = Number(value.replace(/[, $%]/g, ''));
		if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Enter a number (0 or more).' };
		if (field === 'manual_progress' && n > 100) return { ok: false, error: 'Progress is 0 to 100.' };
		return { ok: true, value: field === 'budget_cents' ? Math.round(n) : n };
	}
	if (BOOLEAN.has(field)) {
		if (value !== 'true' && value !== 'false') return { ok: false, error: 'Invalid value.' };
		return { ok: true, value: value === 'true' };
	}
	switch (field) {
		case 'severity':
			return ['critical', 'high', 'medium', 'low'].includes(value) ? { ok: true, value } : { ok: false, error: 'Invalid severity.' };
		case 'manual_health':
			return ['on_track', 'at_risk', 'off_track'].includes(value) ? { ok: true, value } : { ok: false, error: 'Invalid health.' };
		case 'environment':
		case 'target_unit':
			return value.trim().length <= 80 ? { ok: true, value: value.trim() || null } : { ok: false, error: 'Keep it under 80 characters.' };
		case 'recurrence_rule':
			return value.trim().length <= 300 ? { ok: true, value: value.trim() || null } : { ok: false, error: 'Keep it under 300 characters.' };
		case 'timeframe_grain':
			return ['year', 'quarter', 'month', 'week', 'day'].includes(value) ? { ok: true, value } : { ok: false, error: 'Invalid timeframe.' };
		case 'timeframe_value':
			return value.length <= 20 ? { ok: true, value } : { ok: false, error: 'Invalid timeframe.' };
		case 'source_url':
			return /^https?:\/\/\S{3,1990}$/i.test(value.trim()) ? { ok: true, value: value.trim() } : { ok: false, error: 'Links must start with http:// or https://' };
		case 'name': {
			const v = value.trim();
			if (!v || v.length > 300) return { ok: false, error: 'Name must be 1–300 characters.' };
			return { ok: true, value: v };
		}
		case 'status': {
			const { statusesByKind } = await loadFormSupportingData();
			if (!(statusesByKind[kind] ?? []).some((s) => s.slug === value)) return { ok: false, error: 'That status does not exist for this item type.' };
			return { ok: true, value };
		}
		case 'starts_at':
		case 'ends_at':
			return DATE.test(value) ? { ok: true, value } : { ok: false, error: 'Invalid date.' };
		case 'priority':
			return URGENCY.has(value) ? { ok: true, value } : { ok: false, error: 'Invalid urgency.' };
		case 'parent_id': {
			if (!UUID.test(value)) return { ok: false, error: 'Invalid parent.' };
			const { data } = await supabase.from('projects').select('kind').eq('id', value).maybeSingle();
			if (!data || !isValidParent(kind, data.kind as string)) {
				const need = PARENT_KIND_FOR[kind];
				return { ok: false, error: need ? `A ${kind} can only sit under a ${need}.` : `A ${kind} can't have a parent.` };
			}
			return { ok: true, value };
		}
		default:
			return UUID.test(value) ? { ok: true, value } : { ok: false, error: 'Invalid value.' };
	}
}

/** One cell on one row. */
export async function updateItemField(id: string, field: EditableField, value: string | null): Promise<Result<WorkRow>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	if (!UUID.test(id) || !EDITABLE.has(field)) return { ok: false, error: 'Invalid request.' };
	const { data: cur } = await s.supabase.from('projects').select('kind').eq('id', id).maybeSingle();
	if (!cur) return { ok: false, error: 'Item not found.' };
	const v = await validateValue(s.supabase, field, value, cur.kind as string);
	if (!v.ok) return v;
	const { data, error } = await s.supabase.from('projects').update({ [field]: v.value }).eq('id', id).select(WORK_ROW_COLUMNS).single();
	if (error) return { ok: false, error: friendly(error.message) };
	// 0162's projects_sync_primary_owner trigger keeps work_item_owners in
	// step now; the app-side sync stays as a fallback until it is everywhere.
	if (field === 'owner_id') await syncPrimaryOwner(s.supabase, [id], (v.value as string | null) ?? null);
	// No revalidatePath: every caller (board, Home, item panel) patches its row
	// optimistically from the returned data, and a revalidation re-renders the
	// current page — on a board that reloaded the rows and lost the view.
	return { ok: true, data: data as unknown as WorkRow };
}

/**
 * Keep work_item_owners' is_primary row in step with projects.owner_id.
 * Board edits used to change owner_id alone, leaving the previous owner's
 * primary row behind. Best-effort: the owner change itself already committed.
 */
async function syncPrimaryOwner(supabase: NonNullable<Awaited<ReturnType<typeof session>>>['supabase'], ids: string[], ownerId: string | null): Promise<void> {
	let del = supabase.from('work_item_owners').delete().in('work_item_id', ids).eq('is_primary', true);
	if (ownerId) del = del.neq('user_id', ownerId);
	const { error: delErr } = await del;
	if (delErr) console.error('[work] owner junction cleanup failed', delErr.message);
	if (!ownerId) return;
	const { error } = await supabase.from('work_item_owners')
		.upsert(ids.map((work_item_id) => ({ work_item_id, user_id: ownerId, is_primary: true })), { onConflict: 'work_item_id,user_id' });
	if (error) console.error('[work] owner junction upsert failed', error.message);
}

/** Bulk bar: same field/value on many rows (max 500 per call; callers batch). */
export async function bulkUpdateItems(ids: string[], field: EditableField, value: string | null): Promise<Result<{ updated: number }>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const list = batchIds(ids);
	if (!list) return { ok: false, error: TOO_MANY };
	if (!list.length || !EDITABLE.has(field) || field === 'name' || field === 'parent_id') return { ok: false, error: 'Invalid request.' };
	const { data: rows } = await s.supabase.from('projects').select('id, kind').in('id', list);
	const kinds = [...new Set((rows ?? []).map((r) => r.kind as string))];
	for (const k of kinds) {
		const v = await validateValue(s.supabase, field, value, k);
		if (!v.ok) return v;
	}
	const v0 = await validateValue(s.supabase, field, value, kinds[0] ?? 'task');
	const dbValue = v0.ok ? v0.value : null;
	const { error, count } = await s.supabase.from('projects').update({ [field]: dbValue }, { count: 'exact' }).in('id', list);
	if (error) return { ok: false, error: friendly(error.message) };
	if (field === 'owner_id') await syncPrimaryOwner(s.supabase, list, value || null);
	// No revalidatePath, same reason as updateItemField: callers patch locally.
	return { ok: true, data: { updated: count ?? list.length } };
}

export async function archiveItems(ids: string[]): Promise<Result<{ archived: number }>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const list = batchIds(ids);
	if (!list) return { ok: false, error: TOO_MANY };
	if (!list.length) return { ok: false, error: 'Nothing selected.' };
	const { error, count } = await s.supabase
		.from('projects')
		.update({ archived: true, archived_at: new Date().toISOString() }, { count: 'exact' })
		.in('id', list);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: { archived: count ?? list.length } };
}

/** Bring archived items back (the board's Archived view, the panel's Restore, Undo toasts). */
export async function unarchiveItems(ids: string[]): Promise<Result<{ restored: number }>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const list = batchIds(ids);
	if (!list) return { ok: false, error: TOO_MANY };
	if (!list.length) return { ok: false, error: 'Nothing selected.' };
	const { error, count } = await s.supabase
		.from('projects')
		.update({ archived: false, archived_at: null }, { count: 'exact' })
		.in('id', list);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: { restored: count ?? list.length } };
}

/**
 * Hard delete — only for rows that are ALREADY archived (two steps: archive,
 * then delete from the Archived view). Children are re-parented to nothing by
 * the FK; satellites (owners, tags, comments, followers, files) cascade.
 */
export async function deleteItems(ids: string[]): Promise<Result<{ deleted: number }>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const list = batchIds(ids);
	if (!list) return { ok: false, error: TOO_MANY };
	if (!list.length) return { ok: false, error: 'Nothing selected.' };
	// RLS lets any signed-in member delete any row; a permanent delete is held
	// to the item's creator or owner, or an admin / exec.
	const { data: me } = await s.supabase.from('profiles').select('role').eq('id', s.userId).maybeSingle();
	const elevated = me?.role === 'admin' || me?.role === 'exec';
	// parent_id is ON DELETE SET NULL: deleting a priority that still has live
	// projects would silently push them to the top level. Refuse instead.
	const { count: liveChildren } = await s.supabase.from('projects').select('id', { count: 'exact', head: true }).in('parent_id', list).eq('archived', false);
	if (liveChildren) return { ok: false, error: `${liveChildren} open ${liveChildren === 1 ? 'item still hangs' : 'items still hang'} under this. Move or archive them first.` };
	let q = s.supabase.from('projects').delete({ count: 'exact' }).in('id', list).eq('archived', true);
	if (!elevated) q = q.or(`created_by.eq.${s.userId},owner_id.eq.${s.userId}`);
	const { error, count } = await q;
	if (error) {
		if (/foreign key|violates/i.test(error.message)) return { ok: false, error: 'Something still links to this item (a child, a calendar event, a time entry…). Keep it archived instead.' };
		return { ok: false, error: friendly(error.message) };
	}
	if (!count) return { ok: false, error: elevated ? 'Only archived items can be deleted. Archive first.' : 'Only the creator, the owner or an admin can delete this for good. Archive it instead.' };
	if (count < list.length) {
		revalidatePath('/the-work', 'layout');
		return { ok: false, error: `${count} of ${list.length} deleted. The rest belong to someone else (or were not archived): archive is always available.` };
	}
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: { deleted: count } };
}

export interface CreateItemInput {
	name: string;
	kind: string;
	parent_id?: string | null;
	owner_id?: string | null;
	ends_at?: string | null;
	status?: string | null;
	quarter_id?: string | null;
	department_tag_id?: string | null;
	client_id?: string | null;
}

/** Inline row and the "+ New" modal. Kind/parent/quarter come from the board context. */
export async function createItem(input: CreateItemInput): Promise<Result<WorkRow>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const name = (input.name ?? '').trim();
	if (!name || name.length > 300) return { ok: false, error: 'Give it a name (up to 300 characters).' };
	if (!/^[a-z_]{2,30}$/.test(input.kind)) return { ok: false, error: 'Invalid type.' };

	const { statusesByKind } = await loadFormSupportingData();
	const statuses = statusesByKind[input.kind] ?? [];
	if (!statuses.length) return { ok: false, error: 'This type has no statuses configured.' };
	const status = input.status && statuses.some((x) => x.slug === input.status)
		? input.status
		: (statuses.find((x) => (x as { is_initial?: boolean }).is_initial)?.slug ?? statuses[0].slug);

	const row: Record<string, unknown> = { name, kind: input.kind, status, created_by: s.userId, owner_id: s.userId };
	for (const f of ['parent_id', 'owner_id', 'ends_at', 'quarter_id', 'department_tag_id', 'client_id'] as const) {
		const raw = input[f];
		if (raw === undefined) continue;
		const v = await validateValue(s.supabase, f, raw, input.kind);
		if (!v.ok) return v;
		row[f] = v.value;
	}
	// A project born under a priority (sub-row, panel tab, Goals & Priorities
	// board) arrives without a quarter; the Projects board filters on the
	// current quarter, so without this default the new project vanished.
	if (input.kind === 'project' && input.quarter_id === undefined) row.quarter_id = await currentQuarterId(s.supabase);
	const { data, error } = await s.supabase.from('projects').insert(row).select(WORK_ROW_COLUMNS).single();
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: data as unknown as WorkRow };
}

/** Custom column cell. Value is coerced to the column's typed slot. */
export async function setCustomValue(columnId: string, itemId: string, value: string | number | boolean | null): Promise<Result> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	if (!UUID.test(columnId) || !UUID.test(itemId)) return { ok: false, error: 'Invalid request.' };
	const { data: col } = await s.supabase.from('board_columns').select('id, type, options').eq('id', columnId).maybeSingle();
	if (!col) return { ok: false, error: 'Column not found.' };
	const type = col.type as CustomColumnType;

	if (value === null || value === '') {
		const { error } = await s.supabase.from('work_item_field_values').delete().eq('board_column_id', columnId).eq('work_item_id', itemId);
		return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
	}
	const slot: Record<string, unknown> = { value_text: null, value_number: null, value_date: null, value_bool: null, value_uuid: null };
	if (type === 'number') {
		const n = typeof value === 'number' ? value : Number(String(value).replace(/[, $]/g, ''));
		if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
		slot.value_number = n;
	} else if (type === 'checkbox') {
		slot.value_bool = value === true || value === 'true';
	} else if (type === 'date') {
		if (typeof value !== 'string' || !DATE.test(value)) return { ok: false, error: 'Invalid date.' };
		slot.value_date = value;
	} else if (type === 'person') {
		if (typeof value !== 'string' || !UUID.test(value)) return { ok: false, error: 'Invalid person.' };
		slot.value_uuid = value;
	} else if (type === 'dropdown') {
		const options = ((col.options as { options?: { id: string }[] })?.options ?? []).map((o) => o.id);
		if (typeof value !== 'string' || !options.includes(value)) return { ok: false, error: 'Pick one of the options.' };
		slot.value_text = value;
	} else if (type === 'link') {
		const v = String(value).trim();
		if (!/^https?:\/\/\S{3,1990}$/i.test(v)) return { ok: false, error: 'Links must start with http:// or https://' };
		slot.value_text = v;
	} else {
		const v = String(value).trim();
		if (v.length > 2000) return { ok: false, error: 'Text is too long (2000 characters max).' };
		slot.value_text = v;
	}
	const { error } = await s.supabase
		.from('work_item_field_values')
		.upsert({ board_column_id: columnId, work_item_id: itemId, ...slot, updated_by: s.userId, updated_at: new Date().toISOString() });
	if (error) return { ok: false, error: friendly(error.message) };
	return { ok: true, data: null };
}

export async function toggleFavorite(boardId: string, on: boolean): Promise<Result> {
	const s = await session();
	if (!s || !UUID.test(boardId)) return { ok: false, error: 'Invalid request.' };
	const q = on
		? s.supabase.from('board_favorites').insert({ user_id: s.userId, board_id: boardId })
		: s.supabase.from('board_favorites').delete().eq('user_id', s.userId).eq('board_id', boardId);
	const { error } = await q;
	if (error && !/duplicate key/.test(error.message)) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: null };
}

/** People + statuses for the global ⌘K "+ New task" modal (fetched on first open, never on page load). */
export async function loadNewItemContext(): Promise<Result<BoardContext>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	return { ok: true, data: lightBoardContext(await loadFormSupportingData()) };
}

/** Parent picker for the New modal: open items of the one valid parent kind. */
export async function searchParents(parentKind: string, query: string): Promise<Result<{ id: string; name: string }[]>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	if (!/^[a-z_]{2,30}$/.test(parentKind)) return { ok: false, error: 'Invalid type.' };
	let q = s.supabase.from('projects').select('id, name').eq('kind', parentKind).eq('archived', false);
	const term = (query ?? '').trim().replace(/[%_,()"'\\*]/g, '_').slice(0, 80);
	if (term) q = q.ilike('name', `%${term}%`);
	const { data, error } = await q.order('updated_at', { ascending: false }).order('id').range(0, 29);
	if (error) return { ok: false, error: friendly(error.message) };
	return { ok: true, data: (data ?? []) as { id: string; name: string }[] };
}

/** Subitems: the open children of one item (max 200), newest due first. */
export async function loadChildRows(parentId: string): Promise<Result<WorkRow[]>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	if (!UUID.test(parentId)) return { ok: false, error: 'Invalid request.' };
	const { data, error } = await s.supabase
		.from('projects')
		.select(WORK_ROW_COLUMNS)
		.eq('parent_id', parentId)
		.eq('archived', false)
		.order('ends_at', { ascending: true, nullsFirst: false })
		.order('id')
		.range(0, 199);
	if (error) return { ok: false, error: friendly(error.message) };
	return { ok: true, data: (data ?? []) as unknown as WorkRow[] };
}

// ------------------------------------------------------------ type change

export interface KindChangeCheck {
	id: string;
	name: string;
	fromKind: string;
	/** Status the item lands in, mapped by category (5.6). */
	status: { slug: string; label: string } | null;
	/** Current parent cannot hold the new kind: it must be detached. */
	parentProblem: string | null;
	/** Open + closed children the item has; the DB refuses a kind change while any remain attached. */
	children: number;
}

const TYPE_KINDS = new Set(['goal', 'priority', 'project', 'task', 'recurring', 'process', 'bug', 'strategy', 'twelve_week_plan', 'campaign', 'assignment']);

/** Rework 5.6: what a type change would do to each item (no writes). */
export async function previewKindChange(ids: string[], toKind: string): Promise<Result<KindChangeCheck[]>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const list = batchIds(ids);
	if (!list) return { ok: false, error: TOO_MANY };
	if (!TYPE_KINDS.has(toKind)) return { ok: false, error: 'Pick a type.' };
	const [{ data: rows, error }, { statusesByKind }] = await Promise.all([
		s.supabase.from('projects').select('id, name, kind, status, parent_id').in('id', list),
		loadFormSupportingData(),
	]);
	if (error) return { ok: false, error: friendly(error.message) };
	const parentIds = [...new Set((rows ?? []).map((r) => r.parent_id as string | null).filter((x): x is string => !!x))];
	const [{ data: parents }, { data: kids }] = await Promise.all([
		parentIds.length ? s.supabase.from('projects').select('id, kind, name').in('id', parentIds) : Promise.resolve({ data: [] as { id: string; kind: string; name: string }[] }),
		s.supabase.from('projects').select('parent_id').in('parent_id', list).range(0, 9999),
	]);
	const parentById = new Map((parents ?? []).map((p) => [p.id as string, p as { id: string; kind: string; name: string }]));
	const childCount = new Map<string, number>();
	for (const k of kids ?? []) childCount.set(k.parent_id as string, (childCount.get(k.parent_id as string) ?? 0) + 1);
	const target = statusesByKind[toKind] ?? [];
	return {
		ok: true,
		data: (rows ?? []).map((r) => {
			const from = (statusesByKind[r.kind as string] ?? []).find((x) => x.slug === r.status) ?? { slug: r.status as string };
			const mapped = mapStatus(from, target);
			const parent = r.parent_id ? parentById.get(r.parent_id as string) : undefined;
			const legal = !parent || isValidParent(toKind, parent.kind);
			return {
				id: r.id as string,
				name: r.name as string,
				fromKind: r.kind as string,
				status: mapped ? { slug: mapped.slug, label: mapped.label } : null,
				parentProblem: legal ? null : `It sits under the ${parent!.kind} “${parent!.name}”, which can't hold a ${toKind.replace(/_/g, ' ')}.`,
				children: childCount.get(r.id as string) ?? 0,
			};
		}),
	};
}

/**
 * Rework 5.6 (Alex approved Nov 5): change an item's type. The status maps
 * by category to the confirmed slug; nothing is deleted (fields the new type
 * doesn't show stay in the row and come back if the type is changed back);
 * an illegal parent or attached children are detached only when the caller
 * confirmed it; the change lands in Activity (log_project_event, 0162).
 */
export async function changeItemKind(id: string, toKind: string, opts: { status: string; detachParent?: boolean; detachChildren?: boolean }): Promise<Result<WorkRow>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	if (!UUID.test(id) || !TYPE_KINDS.has(toKind)) return { ok: false, error: 'Invalid request.' };
	const { data: cur } = await s.supabase.from('projects').select('id, kind, parent_id').eq('id', id).maybeSingle();
	if (!cur) return { ok: false, error: 'Item not found.' };
	if (cur.kind === toKind) return { ok: false, error: 'It is already that type.' };
	const { statusesByKind } = await loadFormSupportingData();
	if (!(statusesByKind[toKind] ?? []).some((x) => x.slug === opts.status)) return { ok: false, error: 'That status does not exist for the new type.' };

	let detachParent = false;
	if (cur.parent_id) {
		const { data: parent } = await s.supabase.from('projects').select('kind').eq('id', cur.parent_id).maybeSingle();
		if (parent && !isValidParent(toKind, parent.kind as string)) {
			if (!opts.detachParent) return { ok: false, error: `Its parent can't hold a ${toKind.replace(/_/g, ' ')}. Confirm detaching it first.` };
			detachParent = true;
		}
	}
	const { count: kids } = await s.supabase.from('projects').select('id', { count: 'exact', head: true }).eq('parent_id', id);
	if (kids) {
		if (!opts.detachChildren) return { ok: false, error: `${kids} item${kids === 1 ? '' : 's'} sit under it. Confirm detaching ${kids === 1 ? 'it' : 'them'} first.` };
		const { error: detErr } = await s.supabase.from('projects').update({ parent_id: null }).eq('parent_id', id);
		if (detErr) return { ok: false, error: friendly(detErr.message) };
	}
	const patch: Record<string, unknown> = { kind: toKind, status: opts.status };
	if (detachParent) patch.parent_id = null;
	const { data, error } = await s.supabase.from('projects').update(patch).eq('id', id).select(WORK_ROW_COLUMNS).single();
	if (error) return { ok: false, error: friendly(error.message) };
	return { ok: true, data: data as unknown as WorkRow };
}
