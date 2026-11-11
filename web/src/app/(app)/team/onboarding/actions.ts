'use server';

// Onboarding + DISC + attendance actions (0134, H7). RLS is the guard; these
// validate shape, write, and surface the DB's verdict.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { ATTENDANCE_EVENT_KINDS, ONBOARDING_ITEM_STATUSES, scoreDisc, type DiscAnswer } from '@/lib/hiring/onboarding';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	return m.replace(/^(onboarding|hiring):\s*/, '');
}

function revalidateOnboarding(profileId?: string) {
	revalidatePath('/team/onboarding');
	revalidatePath('/team/attendance');
	if (profileId) {
		revalidatePath(`/team/onboarding/${profileId}`);
		revalidatePath(`/team/${profileId}`);
	}
}

// ---------------------------------------------------------------- plans

/** Start (or complete) a 60/90-day plan for a person already on the team. */
export async function startOnboardingPlan(input: { profile_id: string; start_on?: string | null; manager_id?: string | null; employment_type?: string | null }): Promise<Result<{ plan_id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.profile_id).success) return { ok: false, error: 'Invalid person.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('hire_onboarding_create', {
		p_profile_id: input.profile_id,
		p_start_on: input.start_on && DATE_RE.test(input.start_on) ? input.start_on : null,
		p_manager_id: input.manager_id && uuid.safeParse(input.manager_id).success ? input.manager_id : null,
		p_offer_id: null,
		p_employment: input.employment_type && ['full_time', 'part_time', 'contractor', 'intern'].includes(input.employment_type) ? input.employment_type : null,
		p_hold_calibration: null,
	});
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_onboarding_plans/${data}`, action: 'onboarding.plan.start', diff: { profile_id: input.profile_id } });
	revalidateOnboarding(input.profile_id);
	return { ok: true, plan_id: data as string };
}

export async function setOnboardingPlan(input: { id: string; profile_id: string; status?: string; manager_id?: string | null; start_on?: string; notes_md?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid plan.' };
	const patch: Record<string, unknown> = {};
	if (input.status && ['active', 'paused', 'complete', 'exited'].includes(input.status)) {
		patch.status = input.status;
		if (input.status === 'complete') patch.completed_at = new Date().toISOString();
	}
	if (input.manager_id !== undefined) patch.manager_id = input.manager_id && uuid.safeParse(input.manager_id).success ? input.manager_id : null;
	if (input.start_on && DATE_RE.test(input.start_on)) patch.start_on = input.start_on;
	if (input.notes_md !== undefined) patch.notes_md = input.notes_md?.trim().slice(0, 8000) || null;
	if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to change.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_onboarding_plans').update(patch).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidateOnboarding(input.profile_id);
	return { ok: true };
}

const ItemInput = z.object({
	id: uuid,
	profile_id: uuid,
	status: z.enum(ONBOARDING_ITEM_STATUSES).optional(),
	note_md: z.string().max(8000).optional().nullable(),
	due_on: z.string().regex(DATE_RE).optional(),
	owner_id: z.string().optional().nullable(),
	payload: z.record(z.string(), z.unknown()).optional(),
});

export async function updateOnboardingItem(raw: z.input<typeof ItemInput>): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ItemInput.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const patch: Record<string, unknown> = {};
	if (d.status) patch.status = d.status;
	if (d.note_md !== undefined) patch.note_md = d.note_md?.trim() || null;
	if (d.due_on) patch.due_on = d.due_on;
	if (d.owner_id !== undefined) patch.owner_id = d.owner_id && uuid.safeParse(d.owner_id).success ? d.owner_id : null;
	if (d.payload) patch.payload = d.payload;
	if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to change.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_onboarding_items').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidateOnboarding(d.profile_id);
	return { ok: true };
}

export async function addOnboardingItem(input: { plan_id: string; profile_id: string; label: string; phase: number; owner_role: string; due_on: string; description?: string | null }): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.plan_id).success) return { ok: false, error: 'Invalid plan.' };
	const label = input.label.trim().slice(0, 200);
	if (label.length < 2) return { ok: false, error: 'Give the item a label.' };
	if (![1, 2, 3].includes(input.phase)) return { ok: false, error: 'Phase must be 1, 2 or 3.' };
	if (!['manager', 'hire', 'hr', 'alex'].includes(input.owner_role)) return { ok: false, error: 'Invalid owner.' };
	if (!DATE_RE.test(input.due_on)) return { ok: false, error: 'Due date required.' };
	const supabase = await createClient();
	const { data: plan } = await supabase.from('hire_onboarding_plans').select('profile_id, manager_id').eq('id', input.plan_id).maybeSingle();
	const p = plan as { profile_id: string; manager_id: string | null } | null;
	if (!p) return { ok: false, error: 'Plan not found.' };
	const owner = input.owner_role === 'manager' ? p.manager_id : input.owner_role === 'hire' ? p.profile_id : null;
	const { data, error } = await supabase.from('hire_onboarding_items').insert({ plan_id: input.plan_id, label, description: input.description?.trim() || null, phase: input.phase, kind: 'task', owner_role: input.owner_role, owner_id: owner, due_on: input.due_on, sort: 500 }).select('id').single();
	if (error) return { ok: false, error: friendly(error.message) };
	revalidateOnboarding(input.profile_id);
	return { ok: true, id: (data as { id: string }).id };
}

const CheckinInput = z.object({
	plan_id: uuid,
	profile_id: uuid,
	day_no: z.coerce.number().int().min(1).max(90),
	on_date: z.string().regex(DATE_RE).optional(),
	win_md: z.string().max(4000).optional(),
	unclear_md: z.string().max(4000).optional(),
	intention_md: z.string().max(4000).optional(),
	top3_md: z.string().max(4000).optional(),
	supervisor_note_md: z.string().max(4000).optional(),
	sign: z.enum(['employee', 'supervisor']).optional(),
});

/** The 60-Day Plan targeted-interaction form (one per day; upsert). */
export async function saveOnboardingCheckin(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = CheckinInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: existing } = await supabase.from('hire_onboarding_checkins').select('id, created_by').eq('plan_id', d.plan_id).eq('day_no', d.day_no).maybeSingle();
	const row: Record<string, unknown> = { plan_id: d.plan_id, day_no: d.day_no, on_date: d.on_date ?? new Date().toISOString().slice(0, 10) };
	for (const k of ['win_md', 'unclear_md', 'intention_md', 'top3_md', 'supervisor_note_md'] as const) if (d[k] !== undefined) row[k] = d[k]?.trim() || null;
	if (d.sign === 'employee') row.employee_signed_at = new Date().toISOString();
	if (d.sign === 'supervisor') {
		row.supervisor_id = profile.id;
		row.supervisor_signed_at = new Date().toISOString();
	}
	let id: string;
	if (existing) {
		const { error } = await supabase.from('hire_onboarding_checkins').update(row).eq('id', (existing as { id: string }).id);
		if (error) return { ok: false, error: friendly(error.message) };
		id = (existing as { id: string }).id;
	} else {
		const { data, error } = await supabase.from('hire_onboarding_checkins').insert({ ...row, created_by: profile.id }).select('id').single();
		if (error) return { ok: false, error: friendly(error.message) };
		id = (data as { id: string }).id;
	}
	revalidateOnboarding(d.profile_id);
	return { ok: true, id };
}

// ---------------------------------------------------------------- DISC

/** In-app questionnaire for a signed-in person (self or someone in their onboarding circle). */
export async function submitDiscQuestionnaire(input: { profile_id: string; answers: DiscAnswer[]; summary_md?: string | null }): Promise<Result<{ style: string; scores: Record<string, number> }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.profile_id).success) return { ok: false, error: 'Invalid person.' };
	const answers = (input.answers ?? []).filter((a) => ['D', 'I', 'S', 'C'].includes(a.most) && ['D', 'I', 'S', 'C'].includes(a.least) && a.most !== a.least);
	if (answers.length < 20) return { ok: false, error: 'Answer every group (most AND least, different words) before submitting.' };
	const r = scoreDisc(answers);
	const supabase = await createClient();
	const { error } = await supabase.from('hire_disc_responses').insert({ profile_id: input.profile_id, source: 'in_app', answers, scores: r.scores, style: r.style, summary_md: input.summary_md?.trim() || null, entered_by: profile.id });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `profiles/${input.profile_id}`, action: 'onboarding.disc.in_app', diff: { style: r.style } });
	revalidateOnboarding(input.profile_id);
	return { ok: true, style: r.style, scores: r.scores };
}

/** Manual entry when the person already has results (decision 2). Works for a profile or a candidate. */
export async function enterDiscManually(input: { profile_id?: string | null; candidate_id?: string | null; application_id?: string | null; position_id?: string | null; style: string; scores?: Partial<Record<'D' | 'I' | 'S' | 'C', number>>; provider?: string | null; summary_md?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const style = input.style.trim().slice(0, 40);
	if (!style) return { ok: false, error: 'Enter the style (e.g. Si, CD).' };
	const pid = input.profile_id && uuid.safeParse(input.profile_id).success ? input.profile_id : null;
	const cid = input.candidate_id && uuid.safeParse(input.candidate_id).success ? input.candidate_id : null;
	if (!pid && !cid) return { ok: false, error: 'Pick a person or a candidate.' };
	const scores: Record<string, number> = {};
	for (const k of ['D', 'I', 'S', 'C'] as const) {
		const v = Number(input.scores?.[k]);
		if (Number.isFinite(v) && v >= 0 && v <= 100) scores[k] = v;
	}
	const supabase = await createClient();
	const { error } = await supabase.from('hire_disc_responses').insert({ profile_id: pid, candidate_id: cid, source: input.provider ? 'provider' : 'manual', provider: input.provider?.trim().slice(0, 60) || null, answers: [], scores, style, summary_md: input.summary_md?.trim() || null, entered_by: profile.id });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: pid ? `profiles/${pid}` : `hire_candidates/${cid}`, action: 'onboarding.disc.manual', diff: { style } });
	if (pid) revalidateOnboarding(pid);
	if (input.application_id && input.position_id) revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true };
}

// ---------------------------------------------------------------- attendance

const PolicyInput = z.object({
	id: z.string().optional(),
	key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Key: lowercase letters, digits, underscores.'),
	label: z.string().trim().min(2).max(120),
	region: z.enum(['us', 'os', 'any']).default('any'),
	employment: z.string().optional(),
	accrual_days_per_year: z.coerce.number().min(0).max(60).default(0),
	accrual_method: z.enum(['daily', 'monthly', 'upfront', 'none']).default('daily'),
	waiting_period_days: z.coerce.number().int().min(0).max(365).default(0),
	carryover_max_days: z.coerce.number().min(0).max(60).default(0),
	sick_days_per_year: z.coerce.number().min(0).max(60).default(0),
	holidays: z.string().optional(),
	is_default: z.string().optional(),
	is_active: z.string().optional(),
	notes_md: z.string().max(4000).optional(),
});

export async function saveAttendancePolicy(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = PolicyInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	// holidays: one per line "YYYY-MM-DD Label"
	const holidays: { date: string; label: string }[] = [];
	for (const line of (d.holidays ?? '').split('\n')) {
		const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
		if (m) holidays.push({ date: m[1], label: m[2]?.trim() || 'Holiday' });
	}
	const employment = (d.employment ?? 'full_time,part_time').split(',').map((s) => s.trim()).filter((s) => ['full_time', 'part_time', 'contractor', 'intern'].includes(s));
	const row = { key: d.key, label: d.label, region: d.region, employment: employment.length ? employment : ['full_time'], accrual_days_per_year: d.accrual_days_per_year, accrual_method: d.accrual_method, waiting_period_days: d.waiting_period_days, carryover_max_days: d.carryover_max_days, sick_days_per_year: d.sick_days_per_year, holidays, is_default: d.is_default === 'on', is_active: d.is_active === 'on', notes_md: d.notes_md?.trim() || null, updated_by: profile.id };
	const supabase = await createClient();
	if (row.is_default) await supabase.from('attendance_policies').update({ is_default: false }).eq('is_default', true).neq('key', d.key);
	const q = d.id && uuid.safeParse(d.id).success ? supabase.from('attendance_policies').update(row).eq('id', d.id).select('id').single() : supabase.from('attendance_policies').insert(row).select('id').single();
	const { data, error } = await q;
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `attendance_policies/${(data as { id: string }).id}`, action: 'attendance.policy.save' });
	revalidatePath('/admin/attendance');
	revalidatePath('/team/attendance');
	return { ok: true, id: (data as { id: string }).id };
}

export async function setAttendanceBalance(input: { profile_id: string; year: number; policy_id?: string | null; opening_days?: number; adjustment_days?: number; adjustment_note?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.profile_id).success) return { ok: false, error: 'Invalid person.' };
	if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) return { ok: false, error: 'Invalid year.' };
	const row: Record<string, unknown> = { profile_id: input.profile_id, year: input.year, updated_by: profile.id };
	if (input.policy_id !== undefined) row.policy_id = input.policy_id && uuid.safeParse(input.policy_id).success ? input.policy_id : null;
	if (input.opening_days !== undefined && Number.isFinite(input.opening_days)) row.opening_days = Math.max(-60, Math.min(60, input.opening_days));
	if (input.adjustment_days !== undefined && Number.isFinite(input.adjustment_days)) row.adjustment_days = Math.max(-60, Math.min(60, input.adjustment_days));
	if (input.adjustment_note !== undefined) row.adjustment_note = input.adjustment_note?.trim().slice(0, 400) || null;
	const supabase = await createClient();
	const { error } = await supabase.from('attendance_balances').upsert(row, { onConflict: 'profile_id,year' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `attendance_balances/${input.profile_id}/${input.year}`, action: 'attendance.balance.set', diff: row });
	revalidatePath('/team/attendance');
	revalidatePath(`/team/${input.profile_id}`);
	return { ok: true };
}

export async function recordAttendanceEvent(input: { profile_id: string; on_date: string; kind: string; hours?: number | null; note?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.profile_id).success) return { ok: false, error: 'Invalid person.' };
	if (!DATE_RE.test(input.on_date)) return { ok: false, error: 'Date required.' };
	if (!(ATTENDANCE_EVENT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: 'Invalid kind.' };
	const supabase = await createClient();
	const { error } = await supabase.from('attendance_events').upsert({ profile_id: input.profile_id, on_date: input.on_date, kind: input.kind, hours: input.hours != null && Number.isFinite(input.hours) ? Math.max(0, Math.min(24, input.hours)) : null, note: input.note?.trim().slice(0, 400) || null, recorded_by: profile.id }, { onConflict: 'profile_id,on_date,kind' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/team/attendance');
	revalidatePath(`/team/${input.profile_id}`);
	return { ok: true };
}

export async function deleteAttendanceEvent(input: { id: string; profile_id: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid event.' };
	const supabase = await createClient();
	const { error } = await supabase.from('attendance_events').delete().eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/team/attendance');
	revalidatePath(`/team/${input.profile_id}`);
	return { ok: true };
}

/** Exclude (or re-include) a time_off row from the PTO count without deleting it (mis-promoted calendar OOO). */
export async function setTimeOffCounts(input: { id: string; profile_id: string; counts_as_pto: boolean }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid row.' };
	const supabase = await createClient();
	const { error } = await supabase.from('time_off').update({ counts_as_pto: !!input.counts_as_pto }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `time_off/${input.id}`, action: input.counts_as_pto ? 'attendance.time_off.count' : 'attendance.time_off.exclude' });
	revalidatePath('/team/attendance');
	revalidatePath(`/team/${input.profile_id}`);
	return { ok: true };
}

/** Bulk: every calendar-promoted (source = calendar_event) time_off row for a person in a year → excluded / re-included. For the recurring-OOO-block case (92 rows), people managers only (RLS). */
export async function setCalendarTimeOffCounts(input: { profile_id: string; year: number; counts_as_pto: boolean }): Promise<Result<{ rows: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.profile_id).success) return { ok: false, error: 'Invalid person.' };
	if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) return { ok: false, error: 'Invalid year.' };
	const supabase = await createClient();
	const { data, error } = await supabase.from('time_off').update({ counts_as_pto: !!input.counts_as_pto }).eq('user_id', input.profile_id).eq('source', 'calendar_event').lte('starts_on', `${input.year}-12-31`).gte('ends_on', `${input.year}-01-01`).select('id');
	if (error) return { ok: false, error: friendly(error.message) };
	const n = (data ?? []).length;
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `time_off/${input.profile_id}/${input.year}`, action: input.counts_as_pto ? 'attendance.time_off.count_calendar' : 'attendance.time_off.exclude_calendar', diff: { rows: n } });
	revalidatePath('/team/attendance');
	revalidatePath(`/team/${input.profile_id}`);
	return { ok: true, rows: n };
}
