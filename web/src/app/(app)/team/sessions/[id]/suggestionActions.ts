'use server';

// Deciding a suggestion is the ONLY user-session mutation in Sessions.
// Authorization = can_view_call, enforced twice: here (explicit check via
// RLS on the `call_suggested_tasks` select/update below) and by the
// call_suggested_tasks_decide RLS policy underneath (migration 0056). That
// policy's WITH CHECK additionally PINS three columns on the update this
// action performs — status in ('accepted','dismissed'), decided_by =
// auth.uid(), and created_task_id null-or-a-project-this-user-created — so a
// future edit that drifts from those exact values is rejected by the
// database, not just by this file. The task row is inserted with the SAME
// column names upsertWorkItem writes (the-work/actions.ts) - verified
// against 0004/0009, since Supabase types are not generated and tsc cannot
// catch a wrong column.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

type Decision = {
	suggestionId: string;
	decision: 'accept' | 'dismiss';
	title?: string;
	ownerId?: string;
	endsAt?: string | null;
};

export async function decideSuggestedTask(
	input: Decision,
): Promise<{ ok: true; taskId?: string } | { ok: false; error: string }> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth.user) return { ok: false, error: 'You are signed out — sign in again and retry.' };

	const { data: sug } = await supabase
		.from('call_suggested_tasks')
		.select('id, call_id, title, detail_md, status')
		.eq('id', input.suggestionId)
		.maybeSingle();
	// RLS already hides calls the viewer may not see, so a null here covers
	// both "does not exist" and "not yours" - deliberately indistinguishable.
	if (!sug) return { ok: false, error: 'Suggestion not found.' };
	if (sug.status !== 'pending') return { ok: false, error: 'This suggestion was already decided.' };

	let taskId: string | undefined;
	if (input.decision === 'accept') {
		const title = (input.title ?? sug.title).trim();
		if (!title) return { ok: false, error: 'Give the task a title.' };
		if (!input.ownerId) return { ok: false, error: 'Pick an owner for the task.' };

		// Client prefill: calls link clients_v2; The Work links a client via
		// projects.airtable_contract_id. Cross via contracts - prefer active,
		// newest start. No contract -> the task is created without a client
		// link (never guess).
		const { data: call } = await supabase
			.from('calls')
			.select('client_id, attendee_user_ids')
			.eq('id', sug.call_id)
			.single();

		// Authorization boundary for owner_id: the modal only OFFERS attendees
		// + "Me", but that is UI, not enforcement — neither the decide RLS
		// policy (which pins decided_by/created_task_id, not projects.owner_id)
		// nor projects' own write policy (0004: `with check (true)`) constrains
		// who a task can be assigned to. A direct caller could otherwise land a
		// task owned by anyone in the company. Deliberately no is_admin escape:
		// an exec accepting a suggestion can still only assign to an attendee
		// or themselves — wider reassignment belongs to The Work's own edit
		// flow, not this queue.
		const attendeeIds = call?.attendee_user_ids ?? [];
		if (input.ownerId !== auth.user.id && !attendeeIds.includes(input.ownerId)) {
			return { ok: false, error: 'Pick an owner who was on this call.' };
		}

		let contractId: string | null = null;
		if (call?.client_id) {
			const { data: contracts } = await supabase
				.from('contracts')
				.select('airtable_contract_id, status, starts_on')
				.eq('client_id', call.client_id)
				.not('airtable_contract_id', 'is', null)
				.order('starts_on', { ascending: false, nullsFirst: false });
			const active = (contracts ?? []).find((c) => c.status === 'active');
			contractId = (active ?? (contracts ?? [])[0])?.airtable_contract_id ?? null;
		}

		const { data: task, error: taskError } = await supabase
			.from('projects')
			.insert({
				name: title,
				kind: 'task',
				owner_id: input.ownerId,
				ends_at: input.endsAt ?? null,
				description_md: sug.detail_md ?? null,
				airtable_contract_id: contractId,
				created_by: auth.user.id,
				updated_at: new Date().toISOString(),
			})
			.select('id')
			.single();
		if (taskError || !task) {
			// Never surface raw Postgres text to the user — English, human, and
			// actionable instead.
			return { ok: false, error: 'Could not create the task — try again or create it by hand.' };
		}
		taskId = task.id;
	}

	const { data: updRows, error: updError } = await supabase
		.from('call_suggested_tasks')
		.update({
			status: input.decision === 'accept' ? 'accepted' : 'dismissed',
			decided_by: auth.user.id,
			decided_at: new Date().toISOString(),
			created_task_id: taskId ?? null,
		})
		.eq('id', input.suggestionId)
		.eq('status', 'pending')
		.select('id');
	if (updError) {
		return { ok: false, error: 'Could not record the decision — try again.' };
	}
	// PostgREST returns NO error for an update that matched zero rows — the
	// `.eq('status', 'pending')` above silently no-ops if another tab already
	// decided this suggestion between our read and this write. Without this
	// check the loser would report {ok:true} pointing at a task it just
	// inserted that the suggestion row never ends up referencing: two tasks
	// exist, one of them an orphan. Detect the zero-row case explicitly and
	// clean up the orphan we just created rather than leaving it silently
	// duplicated.
	if (!updRows || updRows.length === 0) {
		if (taskId) {
			// Safe to delete: this row was inserted by this exact call, two
			// statements ago, with created_by = this user.
			const { error: cleanupError } = await supabase.from('projects').delete().eq('id', taskId);
			if (cleanupError) {
				// A stray task a human can see beats a silent duplicate — log
				// and still report the failure below.
				console.error('[sessions] failed to clean up orphaned task after lost decide race:', cleanupError, { taskId });
			}
		}
		return { ok: false, error: 'This suggestion was already decided in another window.' };
	}

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `call_suggested_tasks/${input.suggestionId}`,
		action: input.decision === 'accept' ? 'sessions.suggestion.accept' : 'sessions.suggestion.dismiss',
		diff: { call_id: sug.call_id, created_task_id: taskId ?? null },
	});

	revalidatePath(`/team/sessions/${sug.call_id}`);
	revalidatePath('/team/sessions');
	if (taskId) revalidatePath('/the-work');
	return { ok: true, taskId };
}

// Known gap, accepted for v1: accept is two writes without a transaction.
// The lost-the-race case (two tabs deciding the same suggestion concurrently)
// is now handled above — the loser's update matches zero rows, so it deletes
// its own just-inserted task and reports failure instead of leaving an
// orphan. The residual gap is narrower: only a hard mid-flight crash between
// the insert and the update (process killed, connection dropped) leaves the
// task row committed with the suggestion still 'pending' — the retry then
// either double-creates (caught by the human seeing the first task) or is
// blocked by the decide RLS policy once the row is no longer 'pending'. A
// `security definer` SQL function would make it atomic; add it the day this
// ever actually happens.
