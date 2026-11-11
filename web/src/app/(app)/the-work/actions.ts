'use server';

// Shared server actions for The Work module. Used by /the-work/* pages,
// the universal WorkItemForm, the right-side WorkItemDrawer, and the
// /the-work/[id] detail page. All hit the public.projects table (which
// holds every work_item kind: goal / priority / project / task / etc.).

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { CHILD_KINDS_FOR_PARENT } from './hierarchy';
import { explainAndLog } from '@/lib/errors';

export interface UpsertWorkItemInput {
	id?: string;                          // omit to create, include to update
	name: string;
	kind: string;
	parent_id?: string | null;
	status?: string | null;
	priority?: 'urgent' | 'high' | 'medium' | 'low' | null;
	owner_id?: string | null;             // primary owner (defaults to current user)
	team_lead_id?: string | null;
	project_lead_id?: string | null;      // distinct from owner: day-to-day project driver
	department_tag_id?: string | null;    // FK shortcut into tags (category=department)
	sub_team_tag_id?: string | null;      // FK shortcut into tags (category=sub_team)
	quarter_id?: string | null;
	timeframe_grain?: 'year' | 'quarter' | 'month' | 'week' | 'day' | null;  // goal timeframe grain (0080)
	timeframe_value?: string | null;     // goal timeframe instance, encoded per grain (0080)
	starts_at?: string | null;            // ISO date
	ends_at?: string | null;
	description_md?: string | null;
	notes_md?: string | null;
	lead_measure_md?: string | null;
	lag_measure_md?: string | null;
	target_value?: number | null;
	target_progress?: number | null;
	target_unit?: string | null;
	process_action_md?: string | null;    // for kind=process: what needs to be updated/created
	wiki_page_id?: string | null;         // for kind=process/strategy/twelve_week_plan: linked SOP/doc
	// kind=bug (0111): three real columns, queried by QA bots via list_bugs
	bug_severity?: 'critical' | 'high' | 'medium' | 'low' | null;
	bug_environment?: 'production' | 'preview' | 'staging' | 'local' | null;
	bug_regression?: boolean | null;
	color?: string | null;
	/** Airtable Contract Agreement rec id — links a client-side item to its client.
	 *  undefined = leave untouched (callers without the client picker); null = clear. */
	/** clients_v2 id (the Airtable contract link is retired; rework 5.7). */
	client_id?: string | null;
	tag_ids?: string[];                   // replaces the work_item_tags set
	additional_owner_ids?: string[];      // extra owners beyond owner_id; syncs work_item_owners junction
}

const RV_PATHS = [
	'/the-work',
	'/the-work/priorities',
	'/the-work/planning',
	'/the-work/client-work',
	'/',                       // Home queue (absorbed the old /the-work/my-work)
	'/the-work/calendar',
];

function revalidateAll() { for (const p of RV_PATHS) revalidatePath(p); }

export async function upsertWorkItem(input: UpsertWorkItemInput) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	const name = input.name.trim();
	if (!name) return { ok: false as const, error: 'Name is required.' };

	const ownerId = input.owner_id ?? auth.user.id;
	const row: Record<string, unknown> = {
		name,
		kind: input.kind,
		updated_at: new Date().toISOString(),
	};
	// undefined = leave untouched; null = explicit clear. This is the contract
	// for EVERY optional column (generalized from airtable_contract_id after
	// the 18/08 QA audit found edits silently wiping fields the calling form
	// didn't render — team_lead_id, wiki_page_id, quarter_id, lead/lag, color).
	const OPTIONAL_COLUMNS = [
		'parent_id',
		'status',
		'priority',
		'team_lead_id',
		'project_lead_id',
		'department_tag_id',
		'sub_team_tag_id',
		'quarter_id',
		'timeframe_grain',
		'timeframe_value',
		'starts_at',
		'ends_at',
		'description_md',
		'notes_md',
		'lead_measure_md',
		'lag_measure_md',
		'target_value',
		'target_progress',
		'target_unit',
		'process_action_md',
		'wiki_page_id',
		'color',
		'client_id',
	] as const;
	for (const key of OPTIONAL_COLUMNS) {
		if (input[key] !== undefined) row[key] = input[key];
	}
	// The bug fields live in the 0162 columns (severity, environment,
	// is_regression); the form still sends its older names.
	if (input.bug_severity !== undefined) row.severity = input.bug_severity;
	if (input.bug_environment !== undefined) row.environment = input.bug_environment;
	if (input.bug_regression !== undefined) row.is_regression = input.bug_regression;
	// owner_id: creating defaults to the current user; updating only touches
	// it when the caller sent one (otherwise an edit from a drawer without an
	// owner picker would reassign the item to whoever edited it).
	if (!input.id) row.owner_id = ownerId;
	else if (input.owner_id !== undefined) row.owner_id = input.owner_id;

	let id = input.id;
	if (id) {
		const { error } = await supabase.from('projects').update(row).eq('id', id);
		if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	} else {
		row.created_by = auth.user.id;
		const { data, error } = await supabase.from('projects').insert(row).select('id').single();
		if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed.' };
		id = data.id;
	}

	// Replace tags: delete existing, insert new set. Skip if tag_ids not provided.
	if (input.tag_ids !== undefined && id) {
		await supabase.from('work_item_tags').delete().eq('work_item_id', id);
		if (input.tag_ids.length > 0) {
			await supabase.from('work_item_tags').insert(
				input.tag_ids.map((tag_id) => ({ work_item_id: id, tag_id })),
			);
		}
	}

	// Sync work_item_owners. The primary owner_id always gets a row with
	// is_primary=true. Additional owners get is_primary=false. We wipe + rewrite
	// rather than diffing — same pattern as tags. Skip if caller didn't pass an
	// explicit additional_owner_ids list (preserves drawer-only-status edits).
	if (input.additional_owner_ids !== undefined && id) {
		// Rework D16 (audit bug): an edit that did not send owner_id used to
		// rewrite the primary row as the EDITOR. Use the item's real owner.
		let primary = ownerId;
		if (input.id && input.owner_id === undefined) {
			const { data: cur } = await supabase.from('projects').select('owner_id').eq('id', id).maybeSingle();
			primary = (cur?.owner_id as string | null) ?? ownerId;
		}
		await supabase.from('work_item_owners').delete().eq('work_item_id', id).eq('is_primary', false);
		const ownerRows = [
			{ work_item_id: id, user_id: primary, is_primary: true },
			...input.additional_owner_ids
				.filter((uid) => uid && uid !== primary)
				.map((uid) => ({ work_item_id: id!, user_id: uid, is_primary: false })),
		];
		await supabase.from('work_item_owners').upsert(ownerRows, { onConflict: 'work_item_id,user_id' });
	}

	revalidateAll();
	return { ok: true as const, id };
}

export async function archiveWorkItem(id: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		.update({ archived: true, archived_at: new Date().toISOString() })
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}

export async function setWorkItemStatus(id: string, status: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		.update({ status, updated_at: new Date().toISOString() })
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}

// Due-date counterpart to setWorkItemStatus — the one column TaskQuickPopover
// writes when a task has no `ends_at` (a task without one is invisible to the
// engine's `v2_tasks_scheduled` metric and can never read as overdue).
// Deliberately NOT upsertWorkItem: that action requires a non-empty `name`
// (see line 60-61 above) and would reject a `{ id, ends_at }` patch with
// "Name is required." — pass null to clear the date.
export async function setWorkItemDueDate(id: string, endsAt: string | null) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		// `endsAt || null` normalises the empty string a cleared <input
		// type="date"> hands back: '' is not a valid `date` value and would
		// error, while the intent behind it is always "clear this".
		.update({ ends_at: endsAt || null, updated_at: new Date().toISOString() })
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}

// Owner counterpart to setWorkItemStatus — used by ClientWorkView's bulk
// "Set owner…" action (Sam, 2026-08-10). Generic across every kind, same
// as updatePriorityOwner in priorities/actions.ts (which PrioritiesView keeps
// using directly since it was already wired there).
export async function setWorkItemOwner(id: string, owner_id: string | null) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		.update({ owner_id, updated_at: new Date().toISOString() })
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}

// Undo counterpart for archiveWorkItem — used by the bulk-archive toast's
// Undo button, same "archive immediately, 5s undo window" pattern as
// Priorities' unarchivePriority.
export async function unarchiveWorkItem(id: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		.update({ archived: false, archived_at: null })
		.eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}

// ============================================================================
// Hierarchy (parent/children editing) — bounded Goal → Priority → Project →
// Task (and the client-side mirror Strategy → 12WP → Campaign → Assignment).
// Kind→allowed-children map lives in ./hierarchy.ts (plain data, no 'use
// server'/'use client') so both this file and ChildrenPanel.tsx can use it.
// ============================================================================

/** Search candidates to add as a child of `parentKind` — name search, excludes archived + the parent itself. Pass `kindFilter` to restrict to one child kind (Overview's children section). */
export async function searchChildCandidates(parentKind: string, query: string, excludeId?: string, kindFilter?: string) {
	let kinds = CHILD_KINDS_FOR_PARENT[parentKind] ?? [];
	if (kindFilter) kinds = kinds.filter((k) => k === kindFilter);
	if (kinds.length === 0) return [] as { id: string; name: string; kind: string; parent_id: string | null }[];

	const supabase = await createClient();
	let q = supabase
		.from('projects')
		.select('id, name, kind, parent_id')
		.in('kind', kinds)
		.eq('archived', false)
		.order('name')
		.limit(20);

	if (query.trim()) q = q.ilike('name', `%${query.trim()}%`);
	if (excludeId) q = q.neq('id', excludeId);

	const { data, error } = await q;
	if (error) return [];
	return data ?? [];
}

/** Attach an existing item as a child of `parentId` (moves it if it already had a different parent). */
export async function addChild(parentId: string, childId: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		.update({ parent_id: parentId, updated_at: new Date().toISOString() })
		.eq('id', childId);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}

/** Current children of a work item — used by ChildrenPanel, which fetches this itself so it works both in the compact drawer and the full detail page. */
export async function getChildren(parentId: string) {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('projects')
		.select('id, name, kind, status')
		.eq('parent_id', parentId)
		.eq('archived', false)
		.order('created_at');
	if (error) return [];
	return data ?? [];
}

// ============================================================================
// Project updates + health (Linear-style, migration 0019). A lead posts an
// async status note tagged on_track / at_risk / off_track; the newest one is
// the project's current health. Works for any kind (campaigns use it too).
// ============================================================================

export type WorkItemHealth = 'on_track' | 'at_risk' | 'off_track';

export async function createWorkItemUpdate(input: { work_item_id: string; health: WorkItemHealth; body_md?: string | null }) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	// A goal never types health: it inherits the worst health among its active
	// priorities (2026-08-25 rule, lib/work/goalHealth). Enforced here, not only in the UI.
	const { data: target } = await supabase.from('projects').select('kind').eq('id', input.work_item_id).maybeSingle();
	if (target?.kind === 'goal') return { ok: false as const, error: 'A goal inherits its health from its priorities. Post the update on the priority instead.' };

	const { data, error } = await supabase
		.from('work_item_updates')
		.insert({
			work_item_id: input.work_item_id,
			author_id: auth.user.id,
			health: input.health,
			body_md: input.body_md?.trim() || null,
		})
		.select('id')
		.single();
	if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed.' };

	revalidateAll();
	revalidatePath(`/the-work/${input.work_item_id}`);
	return { ok: true as const, id: data.id };
}

export async function deleteWorkItemUpdate(id: string, workItemId: string) {
	const supabase = await createClient();
	const { error } = await supabase.from('work_item_updates').delete().eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	revalidatePath(`/the-work/${workItemId}`);
	return { ok: true as const };
}

/** Detach a child — does not archive/delete it, just clears parent_id. */
export async function removeChild(childId: string) {
	const supabase = await createClient();
	const { error } = await supabase
		.from('projects')
		.update({ parent_id: null, updated_at: new Date().toISOString() })
		.eq('id', childId);
	if (error) return { ok: false as const, error: explainAndLog(error, 'the-work.actions') };
	revalidateAll();
	return { ok: true as const };
}
