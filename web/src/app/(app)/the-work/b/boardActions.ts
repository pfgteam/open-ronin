'use server';

// Board configuration writes (spec §4.2 screens 4 + 6): create a board, edit
// its settings and columns, add/remove custom columns, archive. RLS decides
// who may (can_edit_board); inputs are whitelisted here.

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { BUILTIN_COLUMNS } from '@/lib/work/boards/columns';
import type { BoardSection, BoardView, ColumnConfig, CustomColumnType } from '@/lib/work/boards/types';

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS: BoardSection[] = ['company', 'department', 'client', 'queue'];
const VIEWS: BoardView[] = ['table', 'kanban', 'timeline', 'calendar'];
const KINDS = ['goal', 'priority', 'project', 'task', 'recurring', 'process', 'assignment', 'campaign', 'twelve_week_plan', 'strategy'];
const TYPES: CustomColumnType[] = ['text', 'number', 'date', 'dropdown', 'person', 'link', 'checkbox'];
const PALETTE = ['#579bfc', '#00a35c', '#e8890c', '#a25ddc', '#e2445c', '#069494', '#ff5ac4', '#784bd1'];

function friendly(m: string): string {
	if (/row-level security|permission denied|42501/i.test(m)) return "You can't change this board.";
	if (/duplicate key.*slug/i.test(m)) return 'A board with that name already exists.';
	return m;
}

async function session() {
	const supabase = await createClient();
	const { data } = await supabase.auth.getUser();
	if (!data.user || !(await hasModuleAccess('the_work'))) return null;
	return { supabase, userId: data.user.id };
}

function slugify(name: string): string {
	return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'board';
}

export interface BoardSettingsInput {
	name: string;
	section: BoardSection;
	kinds: string[];
	quarter: 'current' | 'any';
	department_tag_ids: string[];
	/** Pins the board to one client: rows filter to it and new rows get it. */
	client_id: string | null;
	/** Done items show by default (the chip still hides them). */
	show_done: boolean;
	group_by: string;
	default_view: BoardView;
	columns: ColumnConfig[];
}

function cleanSettings(input: BoardSettingsInput): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
	const name = (input.name ?? '').trim();
	if (!name || name.length > 80) return { ok: false, error: 'Name must be 1–80 characters.' };
	if (!SECTIONS.includes(input.section)) return { ok: false, error: 'Pick a section.' };
	const kinds = [...new Set(input.kinds)].filter((k) => KINDS.includes(k));
	if (!kinds.length) return { ok: false, error: 'Pick at least one item type.' };
	const depts = [...new Set(input.department_tag_ids)].filter((d) => UUID.test(d)).slice(0, 20);
	const base: Record<string, unknown> = { kinds };
	if (input.quarter === 'current') base.quarter = 'current';
	if (depts.length) base.department_tag_ids = depts;
	if (input.client_id && UUID.test(input.client_id)) base.client_id = input.client_id;
	if (input.show_done) base.show_done = true;
	if (!/^(c_[a-z0-9_]{1,40}|[a-z_]{2,20})$/.test(input.group_by)) return { ok: false, error: 'Invalid grouping.' };
	if (!VIEWS.includes(input.default_view)) return { ok: false, error: 'Invalid view.' };
	const columns = (input.columns ?? [])
		.filter((c) => typeof c?.key === 'string' && /^(c_[a-z0-9_]{1,40}|[a-z_]{2,20})$/.test(c.key))
		.slice(0, 60)
		.map((c) => ({ key: c.key, visible: c.visible !== false, ...(c.width ? { width: Math.max(60, Math.min(600, Math.round(c.width))) } : {}) }));
	return { ok: true, row: { name, section: input.section, base_filter: base, group_by: input.group_by, default_view: input.default_view, columns } };
}

export async function createBoard(input: BoardSettingsInput): Promise<Result<{ slug: string }>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const clean = cleanSettings({
		...input,
		columns: input.columns?.length ? input.columns : BUILTIN_COLUMNS.filter((c) => ['owner', 'status', 'due'].includes(c.key)).map((c) => ({ key: c.key, visible: true })),
	});
	if (!clean.ok) return clean;
	let slug = slugify(clean.row.name as string);
	const { data: taken } = await s.supabase.from('boards').select('slug').like('slug', `${slug}%`).range(0, 99);
	if (taken?.some((t) => t.slug === slug)) {
		let n = 2;
		while (taken.some((t) => t.slug === `${slug}-${n}`)) n++;
		slug = `${slug}-${n}`;
	}
	const { error } = await s.supabase.from('boards').insert({ ...clean.row, slug, created_by: s.userId, position: 100 });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: { slug } };
}

export async function updateBoard(boardId: string, input: BoardSettingsInput): Promise<Result> {
	const s = await session();
	if (!s || !UUID.test(boardId)) return { ok: false, error: 'Invalid request.' };
	const clean = cleanSettings(input);
	if (!clean.ok) return clean;
	// The form does not edit owner_id; keep it instead of wiping it with a rebuilt base_filter.
	const { data: current } = await s.supabase.from('boards').select('base_filter').eq('id', boardId).maybeSingle();
	const ownerId = (current?.base_filter as { owner_id?: unknown } | null)?.owner_id;
	if (typeof ownerId === 'string' && UUID.test(ownerId)) (clean.row.base_filter as Record<string, unknown>).owner_id = ownerId;
	const { error } = await s.supabase.from('boards').update(clean.row).eq('id', boardId);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: null };
}

export async function archiveBoard(boardId: string): Promise<Result> {
	const s = await session();
	if (!s || !UUID.test(boardId)) return { ok: false, error: 'Invalid request.' };
	const { data, error } = await s.supabase.from('boards').update({ archived_at: new Date().toISOString() }).eq('id', boardId).eq('is_system', false).select('id');
	if (error) return { ok: false, error: friendly(error.message) };
	if (!data?.length) return { ok: false, error: "Built-in boards can't be archived." };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: null };
}

export async function addCustomColumn(boardId: string, input: { label: string; type: CustomColumnType; options?: string[] }): Promise<Result<{ id: string; key: string }>> {
	const s = await session();
	if (!s || !UUID.test(boardId)) return { ok: false, error: 'Invalid request.' };
	const label = (input.label ?? '').trim();
	if (!label || label.length > 60) return { ok: false, error: 'Column name must be 1–60 characters.' };
	if (!TYPES.includes(input.type)) return { ok: false, error: 'Pick a column type.' };
	let options = {};
	if (input.type === 'dropdown') {
		const labels = [...new Set((input.options ?? []).map((o) => o.trim()).filter(Boolean))].slice(0, 30);
		if (!labels.length) return { ok: false, error: 'Add at least one option for a dropdown.' };
		options = { options: labels.map((l, i) => ({ id: randomUUID().slice(0, 8), label: l.slice(0, 40), color: PALETTE[i % PALETTE.length] })) };
	}
	const key = `c_${slugify(label).replace(/-/g, '_').slice(0, 30)}_${randomUUID().slice(0, 4)}`;
	const { data: last } = await s.supabase.from('board_columns').select('position').eq('board_id', boardId).order('position', { ascending: false }).limit(1);
	const { data, error } = await s.supabase.from('board_columns')
		.insert({ board_id: boardId, key, label, type: input.type, options, position: ((last?.[0]?.position as number | undefined) ?? 0) + 10, created_by: s.userId })
		.select('id, key').single();
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: data as { id: string; key: string } };
}

export async function deleteCustomColumn(columnId: string): Promise<Result> {
	const s = await session();
	if (!s || !UUID.test(columnId)) return { ok: false, error: 'Invalid request.' };
	const { error } = await s.supabase.from('board_columns').delete().eq('id', columnId);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/the-work', 'layout');
	return { ok: true, data: null };
}
