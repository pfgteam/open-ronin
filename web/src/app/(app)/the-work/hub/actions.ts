'use server';

// The Work hub: background loading, select-all and saved views (rework D8,
// D13). Row edits and bulk writes stay in ../b/actions.ts (one write path).
// Every action runs with the viewer's session; RLS decides what is visible.

import { createClient } from '@/lib/supabase/server';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { loadBoardContext } from '@/lib/work/boards/load';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { parseHubState, serializeHubState } from '@/lib/work/hub/state';
import { facetHub, countHub, hubDefFor, pageHub, resolveHub, PAGE } from '@/lib/work/hub/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function session() {
	const supabase = await createClient();
	const { data } = await supabase.auth.getUser();
	if (!data.user) return null;
	if (!(await hasModuleAccess('the_work'))) return null;
	return { supabase, userId: data.user.id };
}

function stateFrom(query: string) {
	return parseHubState(new URLSearchParams(query.replace(/^\?/, '')));
}

/** One background page of the filtered set plus the context for just those rows. */
export async function loadHubRows(key: string, mode: 'tab' | 'board' | 'pending' | 'client', query: string, offset: number): Promise<Result<{ rows: WorkRow[]; ctx: BoardContext }>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const found = await hubDefFor(key, mode);
	if (!found) return { ok: false, error: 'Board not found.' };
	const state = stateFrom(query);
	try {
		const r = await resolveHub(found.def, state);
		const rows = await pageHub(s.supabase, found.def, state, r, Math.max(0, offset), PAGE);
		const ctx = await loadBoardContext(rows, found.customColumns);
		return { ok: true, data: { rows, ctx } };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

/** Every id in the filtered set (select all = the whole set, D8). */
export async function listHubIds(key: string, mode: 'tab' | 'board' | 'pending' | 'client', query: string): Promise<Result<string[]>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const found = await hubDefFor(key, mode);
	if (!found) return { ok: false, error: 'Board not found.' };
	const state = stateFrom(query);
	try {
		const r = await resolveHub(found.def, state);
		const total = await countHub(s.supabase, found.def, state, r);
		const { ids } = await facetHub(s.supabase, found.def, state, r, total, null);
		return { ok: true, data: ids };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

// ----------------------------------------------------------- saved views

export interface SavedView {
	id: string;
	name: string;
	query: string;
	shared: boolean;
	mine: boolean;
	ownerId: string;
}

export async function listSavedViews(boardSlug: string): Promise<Result<SavedView[]>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const { data, error } = await s.supabase.from('saved_views')
		.select('id, name, config, is_shared, user_id')
		.eq('source', 'work_board').eq('board_slug', boardSlug)
		.order('name').range(0, 199);
	if (error) return { ok: false, error: error.message };
	return {
		ok: true,
		data: (data ?? []).map((v) => ({
			id: v.id as string,
			name: v.name as string,
			query: String((v.config as { query?: string } | null)?.query ?? ''),
			shared: !!v.is_shared,
			mine: v.user_id === s.userId,
			ownerId: v.user_id as string,
		})),
	};
}

export async function saveView(boardSlug: string, name: string, query: string, shared: boolean, id?: string): Promise<Result<SavedView>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const clean = name.trim().slice(0, 80);
	if (!clean) return { ok: false, error: 'Give the view a name.' };
	if (!/^[a-z0-9-]{1,80}$/.test(boardSlug)) return { ok: false, error: 'Invalid board.' };
	// Store the normalised query (parse → serialize) so nothing odd rides along.
	const normal = serializeHubState(stateFrom(query)).toString();
	const row = { user_id: s.userId, source: 'work_board', board_slug: boardSlug, name: clean, config: { query: normal }, is_shared: shared };
	const q = id
		? s.supabase.from('saved_views').update({ name: clean, config: row.config, is_shared: shared, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', s.userId).select('id').single()
		: s.supabase.from('saved_views').insert(row).select('id').single();
	const { data, error } = await q;
	if (error) return { ok: false, error: error.message };
	return { ok: true, data: { id: data.id as string, name: clean, query: normal, shared, mine: true, ownerId: s.userId } };
}

export async function deleteView(id: string): Promise<Result<null>> {
	const s = await session();
	if (!s) return { ok: false, error: 'Not signed in.' };
	const { error, count } = await s.supabase.from('saved_views').delete({ count: 'exact' }).eq('id', id).eq('user_id', s.userId);
	if (error) return { ok: false, error: error.message };
	if (!count) return { ok: false, error: 'Only the person who saved a view can delete it.' };
	return { ok: true, data: null };
}
