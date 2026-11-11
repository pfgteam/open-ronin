'use server';

// Calibration scorecard actions (0118). The DB guards enforce the round
// sequence, who writes which round, immutability after submit and the
// totals; RLS scopes reads. These validate shape and pass through, returning
// `{ ok, error }` for the client form (no redirects: the form autosaves).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { OUTCOMES, ROUNDS } from '@/lib/calibration/shared';

type Result = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();

/** Create the draft row for a round (the form needs a score id for its answers). Form-posted. */
export async function startCalibrationRound(formData: FormData): Promise<void> {
	const parsed = z
		.object({ cycle_id: uuid, subject_id: uuid, round: z.enum(ROUNDS), return_to: z.string().startsWith('/') })
		.safeParse({
			cycle_id: formData.get('cycle_id'),
			subject_id: formData.get('subject_id'),
			round: formData.get('round'),
			return_to: formData.get('return_to') ?? '/calibration',
		});
	if (!parsed.success) redirect('/calibration?error=' + encodeURIComponent('Invalid round.'));
	const v = parsed.data;
	const back = v.return_to;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const { data: existing } = await supabase
		.from('calibration_scores')
		.select('id')
		.eq('cycle_id', v.cycle_id)
		.eq('subject_id', v.subject_id)
		.eq('round', v.round)
		.maybeSingle();
	if (!existing) {
		const { error } = await supabase.from('calibration_scores').insert({
			cycle_id: v.cycle_id,
			subject_id: v.subject_id,
			round: v.round,
			scorer_id: profile.id,
			model: 'scorecard',
		});
		if (error) redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.message)}`);
		await recordAudit({
			actor_id: profile.id,
			entity_kind: 'supabase',
			entity_ref: `calibration/${v.cycle_id}/${v.subject_id}/${v.round}`,
			action: 'calibration.start',
		});
	}
	revalidatePath(back.split('?')[0]);
	redirect(back);
}

/** Autosave one answer (rating and/or notes). Upsert on (score, question). */
export async function saveCalibrationAnswer(input: {
	score_id: string;
	cycle_question_id: string;
	rating: number | null;
	notes: string | null;
}): Promise<Result> {
	const parsed = z
		.object({
			score_id: uuid,
			cycle_question_id: uuid,
			rating: z.number().int().min(0).max(5).nullable(),
			notes: z.string().trim().max(4000).nullable(),
		})
		.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid answer.' };
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const supabase = await createClient();
	const { error } = await supabase
		.from('calibration_answers')
		.upsert(
			{
				score_id: parsed.data.score_id,
				cycle_question_id: parsed.data.cycle_question_id,
				rating: parsed.data.rating,
				notes: parsed.data.notes || null,
			},
			{ onConflict: 'score_id,cycle_question_id' },
		);
	if (error) return { ok: false, error: error.message };
	return { ok: true };
}

/** Autosave the wrap-up fields (priorities; outcome on the exec round). */
export async function saveCalibrationWrapUp(input: {
	score_id: string;
	priorities_md?: string | null;
	outcome?: string | null;
}): Promise<Result> {
	const parsed = z
		.object({
			score_id: uuid,
			priorities_md: z.string().trim().max(4000).nullable().optional(),
			outcome: z.enum(OUTCOMES).nullable().optional(),
		})
		.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const patch: Record<string, unknown> = {};
	if (parsed.data.priorities_md !== undefined) patch.priorities_md = parsed.data.priorities_md || null;
	if (parsed.data.outcome !== undefined) patch.outcome = parsed.data.outcome;
	if (Object.keys(patch).length === 0) return { ok: true };
	const supabase = await createClient();
	const { error } = await supabase.from('calibration_scores').update(patch).eq('id', parsed.data.score_id);
	if (error) return { ok: false, error: error.message };
	return { ok: true };
}

/** Submit a round. The DB computes the totals and freezes the row. */
export async function submitCalibrationRound(input: { score_id: string; return_to: string }): Promise<Result> {
	const parsed = z.object({ score_id: uuid, return_to: z.string().startsWith('/') }).safeParse(input);
	if (!parsed.success) return { ok: false, error: 'Invalid round.' };
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const supabase = await createClient();
	const { data: row } = await supabase
		.from('calibration_scores')
		.select('id, cycle_id, subject_id, round, submitted_at')
		.eq('id', parsed.data.score_id)
		.maybeSingle();
	if (!row) return { ok: false, error: 'That round no longer exists.' };
	if (row.submitted_at) return { ok: false, error: 'That round is already submitted.' };
	const { error } = await supabase
		.from('calibration_scores')
		.update({ submitted_at: new Date().toISOString() })
		.eq('id', row.id);
	if (error) return { ok: false, error: error.message };
	await recordAudit({
		actor_id: profile.id,
		entity_kind: 'supabase',
		entity_ref: `calibration/${row.cycle_id}/${row.subject_id}/${row.round}`,
		action: 'calibration.submit',
	});
	// The next scorer gets a bell (0039 notifications): the leader after self,
	// the execs after leader. Best effort — a failed bell never blocks a submit.
	try {
		if (row.round === 'self' || row.round === 'leader') {
			const { data: subject } = await supabase.from('profiles').select('first_name, last_name, manager_id').eq('id', row.subject_id).maybeSingle();
			const name = [subject?.first_name, subject?.last_name].filter(Boolean).join(' ') || 'A teammate';
			let targets: string[] = [];
			if (row.round === 'self' && subject?.manager_id) targets = [subject.manager_id];
			if (row.round === 'leader') {
				const { data: g } = await supabase.from('reviewer_groups').select('reviewer_group_members(user_id)').eq('key', 'exec_reconcilers').maybeSingle();
				targets = ((g?.reviewer_group_members as { user_id: string }[] | null) ?? []).map((m) => m.user_id);
			}
			if (targets.length) {
				await supabase.from('notifications').upsert(
					targets.map((uid) => ({
						user_id: uid,
						kind: 'calibration_round_ready',
						title: row.round === 'self' ? `${name} finished their self-assessment` : `${name} is ready for the exec round`,
						body: row.round === 'self' ? 'Their leader round is waiting on you in Team → Calibration.' : 'Both earlier rounds are in. Score the exec round in Team → Calibration.',
						href: `/team/calibration/${row.subject_id}`,
						dedupe_key: `calibration:${row.cycle_id}:${row.subject_id}:${row.round}:submitted`,
					})),
					{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
				);
			}
		}
	} catch {
		// bell is best effort
	}
	revalidatePath(parsed.data.return_to.split('?')[0]);
	revalidatePath('/team/calibration');
	revalidatePath('/team/vantage-point');
	revalidatePath('/admin/calibration');
	return { ok: true };
}
