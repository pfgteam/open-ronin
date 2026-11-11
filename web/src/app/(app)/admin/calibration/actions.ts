'use server';

// /admin/calibration actions (0118): open/close a cycle, edit the master
// questions + weights, re-sync an untouched open cycle's snapshot, manage the
// exec reconciler list, notify everyone. Admin (role admin/exec) only; RLS and
// the DB functions re-check.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { GROUPS } from '@/lib/calibration/shared';

const PATH = '/admin/calibration';

function fail(message: string, back = PATH): never {
	redirect(`${back}?error=${encodeURIComponent(message)}`);
}

async function requireAdmin() {
	const profile = await getAuthProfile();
	if (!profile) fail('You are signed out — sign in again and retry.');
	if (profile.role !== 'admin' && profile.role !== 'exec') fail('Only an admin manages calibration.');
	return profile;
}

function revalidateAll() {
	revalidatePath(PATH);
	revalidatePath(`${PATH}/questions`);
	revalidatePath('/calibration');
	revalidatePath('/team/calibration');
	revalidatePath('/team/vantage-point');
}

/** Open a cycle for a quarter. The DB snapshots the questions and refuses a second open cycle. */
export async function openCalibrationCycle(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const quarterId = formData.get('quarter_id');
	if (typeof quarterId !== 'string' || !z.string().uuid().safeParse(quarterId).success) fail('Pick a quarter.');
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('calibration_cycles')
		.insert({ quarter_id: quarterId, opened_by: profile.id })
		.select('id')
		.single();
	if (error) {
		if (error.message.includes('calibration_cycles_one_open')) fail('A cycle is already open. Close it before opening the next one.');
		fail(error.message.includes('duplicate') ? 'A cycle already exists for that quarter.' : error.message);
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `calibration_cycles/${data.id}`, action: 'calibration.cycle.open' });
	revalidateAll();
	redirect(PATH);
}

export async function setCalibrationCycleStatus(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const id = formData.get('id');
	const status = formData.get('status');
	if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) fail('Invalid cycle.');
	if (status !== 'open' && status !== 'closed') fail('Invalid status.');
	const supabase = await createClient();
	const { error } = await supabase
		.from('calibration_cycles')
		.update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null })
		.eq('id', id);
	if (error) {
		if (error.message.includes('calibration_cycles_one_open')) fail('Another cycle is already open. Close it first.');
		fail(error.message);
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `calibration_cycles/${id}`, action: `calibration.cycle.${status}` });
	revalidateAll();
	redirect(PATH);
}

/** Bell for every assessable person: the cycle is open, do your self-assessment. */
export async function notifyCalibrationOpen(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const cycleId = formData.get('cycle_id');
	if (typeof cycleId !== 'string' || !z.string().uuid().safeParse(cycleId).success) fail('Invalid cycle.');
	const supabase = await createClient();
	const { data: cycle } = await supabase.from('calibration_cycles').select('id, status, quarter_id, quarters(name)').eq('id', cycleId).maybeSingle();
	if (!cycle || cycle.status !== 'open') fail('That cycle is not open.');
	const { data: people } = await supabase.from('profiles').select('id, calibration_excluded').eq('is_active', true);
	const targets = (people ?? []).filter((p) => !(p as { calibration_excluded?: boolean }).calibration_excluded);
	if (targets.length) {
		const q = (cycle as unknown as { quarters: { name: string } | { name: string }[] | null }).quarters;
		const qname = Array.isArray(q) ? q[0]?.name : q?.name;
		// Admin RLS allows the insert for everyone; the service role is the
		// belt-and-braces path other modules use for cross-user bells.
		const svc = createServiceRoleClient();
		const { error } = await svc.from('notifications').upsert(
			targets.map((p) => ({
				user_id: p.id,
				kind: 'calibration_cycle_opened',
				title: 'Quarterly assessment is open',
				body: `${qname ? `${qname}: ` : ''}rate yourself on the 15 categories in Self → Calibration. Your leader scores next, then exec.`,
				href: '/calibration',
				dedupe_key: `calibration:${cycle.id}:opened`,
			})),
			{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
		);
		if (error) fail(error.message);
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `calibration_cycles/${cycleId}`, action: 'calibration.cycle.notify', diff: { recipients: targets.length } });
	revalidatePath(PATH);
	redirect(`${PATH}?notified=${targets.length}`);
}

// ----- questions ------------------------------------------------------------------

const QuestionInput = z.object({
	id: z.string().uuid().optional(),
	key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'Key: lowercase letters, digits, underscores.'),
	group_key: z.enum(GROUPS),
	label: z.string().trim().min(1).max(120),
	prompt: z.string().trim().min(1).max(300),
	weight: z.coerce.number().min(0).max(100),
	position: z.coerce.number().int().min(0).max(999),
	rubric: z.array(z.string().trim().min(1).max(600)).length(6, 'Six rubric levels (0–5) are required.'),
	is_active: z.boolean(),
});

/** Create or update one master question. */
export async function saveCalibrationQuestion(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const back = `${PATH}/questions`;
	const parsed = QuestionInput.safeParse({
		id: formData.get('id') || undefined,
		key: formData.get('key'),
		group_key: formData.get('group_key'),
		label: formData.get('label'),
		prompt: formData.get('prompt'),
		weight: formData.get('weight'),
		position: formData.get('position'),
		rubric: [0, 1, 2, 3, 4, 5].map((i) => formData.get(`rubric_${i}`) ?? ''),
		is_active: formData.get('is_active') === 'on' || formData.get('is_active') === 'true',
	});
	if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid question.', back);
	const v = parsed.data;
	const supabase = await createClient();
	const row = { key: v.key, group_key: v.group_key, label: v.label, prompt: v.prompt, weight: v.weight, position: v.position, rubric: v.rubric, is_active: v.is_active };
	const { error } = v.id
		? await supabase.from('calibration_questions').update(row).eq('id', v.id)
		: await supabase.from('calibration_questions').insert(row);
	if (error) fail(error.message.includes('duplicate') ? `A question with key "${v.key}" already exists.` : error.message, back);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `calibration_questions/${v.id ?? v.key}`, action: v.id ? 'calibration.question.update' : 'calibration.question.create', diff: row });
	revalidateAll();
	redirect(`${back}?saved=1`);
}

/** Re-copy the master into the open cycle (only while nobody has started). */
export async function resyncCalibrationCycle(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const back = `${PATH}/questions`;
	const cycleId = formData.get('cycle_id');
	if (typeof cycleId !== 'string' || !z.string().uuid().safeParse(cycleId).success) fail('Invalid cycle.', back);
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('calibration_resnapshot_cycle', { p_cycle: cycleId });
	if (error) fail(error.message, back);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `calibration_cycles/${cycleId}`, action: 'calibration.cycle.resync', diff: { rows: data } });
	revalidateAll();
	redirect(`${back}?synced=${data ?? 0}`);
}

// ----- exclude list (profiles.calibration_excluded, 0117) -----------------------------

/** Add or remove someone from the calibration exclude list. Admin-only; the 0117 trigger re-checks. */
export async function setCalibrationExcluded(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const userId = formData.get('user_id');
	const excluded = formData.get('excluded') === '1';
	if (typeof userId !== 'string' || !z.string().uuid().safeParse(userId).success) fail('Pick a person.');
	const supabase = await createClient();
	const { data: target } = await supabase.from('profiles').select('email, calibration_excluded').eq('id', userId).maybeSingle();
	if (!target) fail('That person no longer exists.');
	const { error } = await supabase.from('profiles').update({ calibration_excluded: excluded }).eq('id', userId);
	if (error) fail(/calibration_excluded/.test(error.message) ? 'The exclude flag needs migration 0117.' : error.message);
	await recordAudit({
		actor_id: profile.id,
		entity_kind: 'supabase',
		entity_ref: `profiles/${userId}`,
		action: excluded ? 'calibration.exclude.add' : 'calibration.exclude.remove',
		diff: { email: target.email, before: target.calibration_excluded ?? false, after: excluded },
	});
	revalidateAll();
	revalidatePath('/admin/users');
	redirect(PATH);
}

// ----- planning notes (calibration_notes, 0119) ---------------------------------

/**
 * Autosave the "Notes for next quarter" scratchpad. Upserts the one row per
 * key, stamps updated_by; admin-only (RLS re-checks). Returns the new stamp so
 * the panel can show "last edited by … just now" without a reload.
 */
export async function saveCalibrationNote(input: { key: string; body_md: string }): Promise<{ ok: true; updated_at: string; updated_by_name: string } | { ok: false; error: string }> {
	const parsed = z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/), body_md: z.string().max(20000) }).safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid note.' };
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	if (profile.role !== 'admin' && profile.role !== 'exec') return { ok: false, error: 'Only an admin edits these notes.' };
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('calibration_notes')
		.upsert({ key: parsed.data.key, body_md: parsed.data.body_md, updated_by: profile.id }, { onConflict: 'tenant_id,key' })
		.select('updated_at')
		.single();
	if (error) return { ok: false, error: /calibration_notes/.test(error.message) ? 'The notes panel needs migration 0119.' : error.message };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `calibration_notes/${parsed.data.key}`, action: 'calibration.notes.update', diff: { chars: parsed.data.body_md.length } });
	revalidatePath(PATH);
	const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'you';
	return { ok: true, updated_at: data.updated_at, updated_by_name: name };
}

// ----- exec reconcilers ---------------------------------------------------------

export async function addExecReconciler(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const userId = formData.get('user_id');
	if (typeof userId !== 'string' || !z.string().uuid().safeParse(userId).success) fail('Pick a person.');
	const supabase = await createClient();
	const { data: g } = await supabase.from('reviewer_groups').select('id').eq('key', 'exec_reconcilers').maybeSingle();
	if (!g) fail('The exec reconciler group is missing (0085).');
	const { error } = await supabase.from('reviewer_group_members').upsert({ group_id: g.id, user_id: userId }, { onConflict: 'group_id,user_id', ignoreDuplicates: true });
	if (error) fail(error.message);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `reviewer_groups/exec_reconcilers/${userId}`, action: 'calibration.exec.add' });
	revalidateAll();
	redirect(PATH);
}

export async function removeExecReconciler(formData: FormData): Promise<void> {
	const profile = await requireAdmin();
	const userId = formData.get('user_id');
	if (typeof userId !== 'string' || !z.string().uuid().safeParse(userId).success) fail('Invalid person.');
	const supabase = await createClient();
	const { data: g } = await supabase.from('reviewer_groups').select('id').eq('key', 'exec_reconcilers').maybeSingle();
	if (!g) fail('The exec reconciler group is missing (0085).');
	const { count } = await supabase.from('reviewer_group_members').select('user_id', { count: 'exact', head: true }).eq('group_id', g.id);
	if ((count ?? 0) <= 1) fail('Keep at least one exec reconciler.');
	const { error } = await supabase.from('reviewer_group_members').delete().eq('group_id', g.id).eq('user_id', userId);
	if (error) fail(error.message);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `reviewer_groups/exec_reconcilers/${userId}`, action: 'calibration.exec.remove' });
	revalidateAll();
	redirect(PATH);
}
