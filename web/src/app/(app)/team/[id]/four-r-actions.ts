'use server';

// The 4R form's one write (migration 0093).
//
// Permission: the person, their leadership chain, people-managers, exec/admin
// (can_edit_four_r). RLS is authoritative; the check here exists so a
// forbidden save fails with a sentence instead of a bare Postgres error.
//
// Every save writes the single profile_four_r row: INSERT the first time,
// UPDATE after that. NOT an upsert: Postgres fires BEFORE INSERT row triggers
// before it resolves ON CONFLICT, so an upsert onto an existing row made the
// trigger log a "revision 1" for a person who already had one, and the save
// died on profile_four_r_revisions_user_id_revision_key (seen live
// 2026-09-22: 33 people with a 4R, none past revision 1). The revision log is
// written by that DB trigger (log_profile_four_r_revision), not here, so
// nothing can save without leaving a trace. The optional note rides on
// `pending_note`, which the trigger copies into the revision and blanks.
//
// This action RETURNS a result rather than redirecting: the section is a
// client component that keeps the form open on error and drops back to read
// mode on success (the New Task modal pattern), so a redirect would throw
// away the person's half-edited text.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canEditFourR } from '@/lib/people/permissions';
import { isInLeadershipChain, normaliseListMarkdown, type FourRDraft } from '@/lib/people/fourR';

const MAX_SECTION = 20_000;

const Input = z.object({
	position_label: z.string().trim().min(1, 'Give the position a name.').max(120),
	department: z.string().trim().max(80).nullable(),
	reports_to: z.string().trim().max(120).nullable(),
	role_md: z.string().max(MAX_SECTION, 'The Role section is too long.'),
	responsibilities_md: z.string().max(MAX_SECTION, 'Responsibilities is too long.'),
	results_md: z.string().max(MAX_SECTION, 'Results is too long.'),
	requirements_md: z.string().max(MAX_SECTION, 'Requirements is too long.'),
	template_slug: z.string().max(80).nullable(),
	note: z.string().trim().max(500).nullable(),
});

export type SaveFourRResult =
	| { ok: true; revision: number }
	| { ok: false; error: string };

/** Loads the (id → manager_id) map for the chain check. One query. */
async function viewerLeadsSubject(viewerId: string | null, subjectId: string): Promise<boolean> {
	if (!viewerId) return false;
	const supabase = await createClient();
	const { data } = await supabase.from('profiles').select('id, manager_id');
	const managerOf = new Map<string, string | null>(
		((data ?? []) as { id: string; manager_id: string | null }[]).map((p) => [p.id, p.manager_id]),
	);
	return isInLeadershipChain(viewerId, subjectId, managerOf);
}

export async function saveFourR(
	subjectId: string,
	draft: FourRDraft & { template_slug: string | null; note: string | null },
): Promise<SaveFourRResult> {
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) return { ok: false, error: 'You are signed out. Sign in again and retry.' };

	const leads = await viewerLeadsSubject(ctx.viewerId, subjectId);
	if (!canEditFourR(ctx, subjectId, leads)) {
		return {
			ok: false,
			error: 'Only the team member, their leadership, and people-managers can edit this 4R.',
		};
	}

	const parsed = Input.safeParse({
		...draft,
		department: draft.department?.trim() || null,
		reports_to: draft.reports_to?.trim() || null,
		note: draft.note?.trim() || null,
	});
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
	const v = parsed.data;

	// The three list sections are normalised so a pasted plain list renders
	// as bullets; Role stays prose.
	const row = {
		user_id: subjectId,
		position_label: v.position_label,
		department: v.department,
		reports_to: v.reports_to,
		role_md: v.role_md.trim(),
		responsibilities_md: normaliseListMarkdown(v.responsibilities_md),
		results_md: normaliseListMarkdown(v.results_md),
		requirements_md: normaliseListMarkdown(v.requirements_md),
		template_slug: v.template_slug,
		source: v.template_slug ? 'template' : 'manual',
		updated_by: ctx.viewerId,
		pending_note: v.note,
	};

	const supabase = await createClient();
	const { data: existing } = await supabase
		.from('profile_four_r')
		.select('user_id, source, template_slug, created_by')
		.eq('user_id', subjectId)
		.maybeSingle();

	// A later edit never rewrites where the FIRST version came from.
	const { data: saved, error } = existing
		? await supabase
				.from('profile_four_r')
				.update({
					...row,
					source: existing.source as string,
					template_slug: existing.template_slug as string | null,
				})
				.eq('user_id', subjectId)
				.select('revision')
				.single()
		: await supabase
				.from('profile_four_r')
				.insert({ ...row, created_by: ctx.viewerId })
				.select('revision')
				.single();

	if (error || !saved) {
		return { ok: false, error: `Could not save: ${error?.message ?? 'unknown error'}` };
	}

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `profile_four_r/${subjectId}`,
		action: existing ? 'update' : 'create',
		diff: { revision: saved.revision, note: v.note, template_slug: existing ? undefined : v.template_slug },
	});

	revalidatePath(`/team/${subjectId}`);
	return { ok: true, revision: saved.revision as number };
}
