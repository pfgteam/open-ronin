'use server';

// Item panel data (spec §4.2 screen 3): one call returns everything the
// drawer shows — fields, children, updates + comments (one feed), followers,
// files (own + descendants), activity. Writes reuse the existing actions
// (social.ts comments/follow, actions.ts health updates, attachments-actions).

import { createClient } from '@/lib/supabase/server';
import { CHILD_KINDS_FOR_PARENT } from '../hierarchy';
import { loadFormSupportingData } from '../_lib';
import { WORK_ROW_COLUMNS, type WorkRow } from '@/lib/work/boards/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PanelFeedEntry {
	id: string;
	type: 'update' | 'comment';
	author_id: string | null;
	created_at: string;
	body: string | null;
	health?: 'on_track' | 'at_risk' | 'off_track';
}

export interface PanelFile {
	id: string;
	file_name: string;
	file_size: number | null;
	url: string | null;
	is_deliverable: boolean;
	uploaded_by: string | null;
	created_at: string;
	/** null = attached to the item itself; else the descendant it came from. */
	origin: { id: string; name: string; kind: string } | null;
}

export interface PanelActivity {
	at: string;
	actor_id: string | null;
	text: string;
}

/** Every planning column the drawer can show (rework D4, D11). */
const PANEL_EXTRA_COLUMNS = 'description_md, source_url, notes_md, team_lead_id, twelve_week_goal_md, lead_measure_md, lag_measure_md, process_action_md, estimated_hours, budget_cents, target_value, target_progress, target_unit, recurrence_rule, is_rock, is_lead_indicator, timeframe_grain, timeframe_value';

export type PanelItem = WorkRow & {
	description_md: string | null; source_url: string | null; notes_md: string | null; team_lead_id: string | null;
	twelve_week_goal_md: string | null; lead_measure_md: string | null; lag_measure_md: string | null; process_action_md: string | null;
	estimated_hours: number | null; budget_cents: number | null; target_value: number | null; target_progress: number | null; target_unit: string | null;
	recurrence_rule: string | null; is_rock: boolean | null; is_lead_indicator: boolean | null; timeframe_grain: string | null; timeframe_value: string | null;
};

export interface PanelData {
	item: PanelItem;
	/** Co-owners (work_item_owners, not the primary row). */
	owners: string[];
	tags: string[];
	parent: { id: string; name: string; kind: string } | null;
	children: WorkRow[];
	feed: PanelFeedEntry[];
	followers: string[];
	files: PanelFile[];
	activity: PanelActivity[];
}

export async function loadItemPanel(id: string): Promise<{ ok: true; data: PanelData } | { ok: false; error: string }> {
	if (!UUID.test(id)) return { ok: false, error: 'Invalid item.' };
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { ok: false, error: 'Not signed in.' };

	let { data: item, error } = await supabase.from('projects').select(`${WORK_ROW_COLUMNS}, ${PANEL_EXTRA_COLUMNS}`).eq('id', id).maybeSingle();
	if (error && /column/.test(error.message)) ({ data: item, error } = await supabase.from('projects').select(`${WORK_ROW_COLUMNS}, description_md, source_url`).eq('id', id).maybeSingle());
	if (error || !item) return { ok: false, error: 'Item not found.' };
	const row = item as unknown as PanelData['item'];
	const isContainer = !!CHILD_KINDS_FOR_PARENT[row.kind];

	const [parentRes, childrenRes, updatesRes, commentsRes, followersRes, ownFilesRes, statusLogRes, ownersRes, tagsRes, eventsRes] = await Promise.all([
		row.parent_id ? supabase.from('projects').select('id, name, kind').eq('id', row.parent_id).maybeSingle() : Promise.resolve({ data: null }),
		isContainer
			? supabase.from('projects').select(WORK_ROW_COLUMNS).eq('parent_id', id).eq('archived', false).order('ends_at', { ascending: true, nullsFirst: false }).order('id').range(0, 199)
			: Promise.resolve({ data: [] }),
		supabase.from('work_item_updates').select('id, author_id, health, body_md, created_at').eq('work_item_id', id).order('created_at', { ascending: false }).range(0, 99),
		supabase.from('work_item_comments').select('id, author_id, body, created_at').eq('work_item_id', id).order('created_at', { ascending: false }).range(0, 199),
		supabase.from('work_item_followers').select('user_id').eq('work_item_id', id).range(0, 499),
		supabase.from('work_item_attachments').select('id, file_name, file_size, url, is_deliverable, uploaded_by, created_at').eq('work_item_id', id).order('created_at', { ascending: false }).range(0, 199),
		supabase.from('work_item_status_log').select('from_status, to_status, actor_id, created_at').eq('work_item_id', id).order('created_at', { ascending: false }).range(0, 49),
		supabase.from('work_item_owners').select('user_id, is_primary').eq('work_item_id', id).range(0, 99),
		supabase.from('work_item_tags').select('tag_id').eq('work_item_id', id).range(0, 199),
		supabase.from('work_item_events').select('event_type, from_value, to_value, actor_id, occurred_at').eq('entity_id', id).in('event_type', ['created', 'kind_change', 'parent_change', 'assignee_change', 'archived', 'restored']).order('occurred_at', { ascending: false }).range(0, 49),
	]);

	const children = (childrenRes.data ?? []) as unknown as WorkRow[];

	// Files roll up the tree: a project shows its tasks' files, a priority its
	// projects' and their tasks' (spec §6, item panel → Files).
	let descendants: { id: string; name: string; kind: string }[] = children.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
	const grandParents = children.filter((c) => CHILD_KINDS_FOR_PARENT[c.kind]).map((c) => c.id);
	if (grandParents.length) {
		const { data: gc } = await supabase.from('projects').select('id, name, kind').in('parent_id', grandParents.slice(0, 150)).eq('archived', false).range(0, 999);
		descendants = descendants.concat((gc ?? []) as { id: string; name: string; kind: string }[]);
	}
	const byId = new Map(descendants.map((d) => [d.id, d]));
	let descFiles: (Omit<PanelFile, 'origin'> & { work_item_id: string })[] = [];
	if (descendants.length) {
		const ids = descendants.map((d) => d.id);
		const chunks: string[][] = [];
		for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
		const res = await Promise.all(chunks.map((c) =>
			supabase.from('work_item_attachments').select('id, work_item_id, file_name, file_size, url, is_deliverable, uploaded_by, created_at').in('work_item_id', c).range(0, 999)));
		descFiles = res.flatMap((r) => (r.data ?? []) as typeof descFiles);
	}

	const files: PanelFile[] = [
		...((ownFilesRes.data ?? []) as Omit<PanelFile, 'origin'>[]).map((f) => ({ ...f, origin: null })),
		...descFiles.map(({ work_item_id, ...f }) => ({ ...f, origin: byId.get(work_item_id) ?? null })),
	].sort((a, b) => b.created_at.localeCompare(a.created_at));

	const feed: PanelFeedEntry[] = [
		...((updatesRes.data ?? []) as { id: string; author_id: string | null; health: PanelFeedEntry['health']; body_md: string | null; created_at: string }[])
			.map((u) => ({ id: `u:${u.id}`, type: 'update' as const, author_id: u.author_id, created_at: u.created_at, body: u.body_md, health: u.health })),
		...((commentsRes.data ?? []) as { id: string; author_id: string | null; body: string; created_at: string }[])
			.map((c) => ({ id: `c:${c.id}`, type: 'comment' as const, author_id: c.author_id, created_at: c.created_at, body: c.body })),
	].sort((a, b) => b.created_at.localeCompare(a.created_at));

	const { statusesByKind } = await loadFormSupportingData();
	const label = (slug: string | null) => (slug ? (statusesByKind[row.kind] ?? []).find((s) => s.slug === slug)?.label ?? slug : '—');
	const KIND = (k: string | null) => (k ?? '—').replace(/_/g, ' ');
	const events = ((eventsRes.data ?? []) as { event_type: string; from_value: string | null; to_value: string | null; actor_id: string | null; occurred_at: string }[]).map((e) => {
		switch (e.event_type) {
			case 'kind_change': return { at: e.occurred_at, actor_id: e.actor_id, text: `Type ${KIND(e.from_value)} → ${KIND(e.to_value)}` };
			case 'parent_change': return { at: e.occurred_at, actor_id: e.actor_id, text: e.to_value ? 'Moved under a new parent' : 'Detached from its parent' };
			case 'assignee_change': return { at: e.occurred_at, actor_id: e.actor_id, text: e.to_value ? 'Owner changed' : 'Owner removed' };
			case 'archived': return { at: e.occurred_at, actor_id: e.actor_id, text: 'Archived' };
			case 'restored': return { at: e.occurred_at, actor_id: e.actor_id, text: 'Restored' };
			default: return { at: e.occurred_at, actor_id: e.actor_id, text: 'Created' };
		}
	});
	const activity: PanelActivity[] = [
		...((statusLogRes.data ?? []) as { from_status: string | null; to_status: string | null; actor_id: string | null; created_at: string }[])
			.map((l) => ({ at: l.created_at, actor_id: l.actor_id, text: `Status ${label(l.from_status)} → ${label(l.to_status)}` })),
		...events,
		{ at: row.updated_at, actor_id: null, text: 'Last edited' },
	].sort((a, b) => b.at.localeCompare(a.at));

	return {
		ok: true,
		data: {
			item: row,
			owners: ((ownersRes.data ?? []) as { user_id: string; is_primary: boolean }[]).filter((o) => !o.is_primary).map((o) => o.user_id),
			tags: ((tagsRes.data ?? []) as { tag_id: string }[]).map((x) => x.tag_id),
			parent: (parentRes.data as PanelData['parent']) ?? null,
			children,
			feed,
			followers: ((followersRes.data ?? []) as { user_id: string }[]).map((f) => f.user_id),
			files,
			activity,
		},
	};
}

/** "+ follower": adds someone else (followers' insert policy is own-row). */
export async function addFollower(itemId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!UUID.test(itemId) || !UUID.test(userId)) return { ok: false, error: 'Invalid request.' };
	const supabase = await createClient();
	const { error } = await supabase.rpc('work_item_add_follower', { p_item: itemId, p_user: userId });
	if (error) return { ok: false, error: /does not exist/.test(error.message) ? 'Followers need migration 0141.' : error.message };
	return { ok: true };
}

/** Co-owner on / off (patch: touches one junction row, never the others). */
export async function setCoOwner(itemId: string, userId: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!UUID.test(itemId) || !UUID.test(userId)) return { ok: false, error: 'Invalid request.' };
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { ok: false, error: 'Not signed in.' };
	const q = on
		? supabase.from('work_item_owners').upsert({ work_item_id: itemId, user_id: userId, is_primary: false }, { onConflict: 'work_item_id,user_id', ignoreDuplicates: true })
		: supabase.from('work_item_owners').delete().eq('work_item_id', itemId).eq('user_id', userId).eq('is_primary', false);
	const { error } = await q;
	return error ? { ok: false, error: error.message } : { ok: true };
}

/** Tag on / off (patch: one junction row). */
export async function setItemTag(itemId: string, tagId: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!UUID.test(itemId) || !UUID.test(tagId)) return { ok: false, error: 'Invalid request.' };
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { ok: false, error: 'Not signed in.' };
	const q = on
		? supabase.from('work_item_tags').upsert({ work_item_id: itemId, tag_id: tagId }, { onConflict: 'work_item_id,tag_id', ignoreDuplicates: true })
		: supabase.from('work_item_tags').delete().eq('work_item_id', itemId).eq('tag_id', tagId);
	const { error } = await q;
	return error ? { ok: false, error: error.message } : { ok: true };
}
