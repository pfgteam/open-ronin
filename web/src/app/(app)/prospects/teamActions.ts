'use server';

// Revenue Engine P4 actions (0124): lane roster, targets, queue rules.
// manage_revenue in SQL (RLS); { ok, error } back.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { TRACKED_METRICS } from '@/lib/revenue/adminOptions';

type Result = { ok: true } | { ok: false; error: string };
const uuid = z.string().uuid();
const LANES = ['marketing', 'lead_gen', 'setter', 'closer', 'full_cycle'] as const;
const PATH = '/admin/prospects';

function friendly(m: string) {
	return m.includes('row-level security') ? 'Not allowed: you need the manage_revenue capability.' : m;
}

export async function saveLanePerson(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = z
		.object({
			user_id: uuid,
			lane: z.enum(LANES),
			org: z.enum(['all', 'main', 'premium', 'beacon']).default('all'),
			level: z.enum(['individual', 'team_lead', 'exec']).default('individual'),
		})
		.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('rev_lanes_people').upsert({ ...parsed.data, is_active: true }, { onConflict: 'user_id,lane,org' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_lanes_people/${parsed.data.user_id}`, action: 'revenue.lane.save', diff: parsed.data });
	revalidatePath(PATH, 'layout');
	revalidatePath('/');
	return { ok: true };
}

export async function removeLanePerson(input: { id: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid row.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_lanes_people').delete({ count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing removed: you need the manage_revenue capability.' };
	revalidatePath(PATH, 'layout');
	return { ok: true };
}

export async function saveTarget(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = z
		.object({
			user_id: z.string().trim().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
			lane: z.enum(LANES),
			metric: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Metric: lowercase identifier'),
			period: z.enum(['day', 'week', 'month']).default('day'),
			target: z.coerce.number().min(0),
		})
		.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	// Only metrics rev_daily_metrics emits or the app derives can ever show progress (spec 2026-10-19 §9).
	if (!TRACKED_METRICS.some((m) => m.value === d.metric)) return { ok: false, error: `${d.metric} is not a tracked metric — pick one from the list.` };
	const supabase = await createClient();
	// the unique index is on coalesce(user_id, zero-uuid), lane, metric, period: do a manual upsert
	let q = supabase.from('rev_targets').select('id').eq('lane', d.lane).eq('metric', d.metric).eq('period', d.period);
	q = d.user_id ? q.eq('user_id', d.user_id) : q.is('user_id', null);
	const { data: existing } = await q.maybeSingle();
	const { error } = existing
		? await supabase.from('rev_targets').update({ target: d.target }).eq('id', existing.id)
		: await supabase.from('rev_targets').insert(d);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_targets/${d.lane}/${d.metric}`, action: 'revenue.target.save', diff: d });
	revalidatePath(PATH, 'layout');
	revalidatePath('/');
	return { ok: true };
}

export async function deleteTarget(input: { id: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid row.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_targets').delete({ count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing removed.' };
	revalidatePath(PATH, 'layout');
	return { ok: true };
}

export async function saveQueueRules(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const supabase = await createClient();
	for (const [k, raw] of formData.entries()) {
		if (!k.startsWith('rule:')) continue;
		const key = k.slice(5);
		const n = Number(String(raw).trim());
		if (!/^[a-z][a-z0-9_]{1,40}$/.test(key) || !Number.isFinite(n)) continue;
		const { error, count } = await supabase.from('rev_queue_rules').update({ value: n, updated_by: profile.id }, { count: 'exact' }).eq('key', key);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'rev_queue_rules', action: 'revenue.queue_rules.save' });
	revalidatePath(PATH, 'layout');
	revalidatePath('/');
	return { ok: true };
}

/**
 * Change a lane row in place (spec 2026-10-19 §9). Lane and brand are part of
 * the row identity (unique user_id, lane, org), so a change there replaces the
 * row; nobody has to remove and re-add it by hand. The person comes from the
 * saved row, never from the browser, so an edit cannot move a lane to someone else.
 */
export async function updateLanePerson(input: { id: string; lane: string; org: string; level: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = z
		.object({ id: uuid, lane: z.enum(LANES), org: z.enum(['all', 'main', 'premium', 'beacon']), level: z.enum(['individual', 'team_lead', 'exec']) })
		.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...fields } = parsed.data;
	const supabase = await createClient();
	const { data: current } = await supabase.from('rev_lanes_people').select('user_id, lane, org').eq('id', id).maybeSingle();
	if (!current) return { ok: false, error: 'That row is gone; refresh the page.' };
	const cur = current as { user_id: string; lane: string; org: string };
	const row = { user_id: cur.user_id, ...fields };
	if (cur.lane === row.lane && cur.org === row.org) {
		const { error, count } = await supabase.from('rev_lanes_people').update({ level: row.level }, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	} else {
		const { error: insErr } = await supabase.from('rev_lanes_people').upsert({ ...row, is_active: true }, { onConflict: 'user_id,lane,org' });
		if (insErr) return { ok: false, error: friendly(insErr.message) };
		const { error: delErr } = await supabase.from('rev_lanes_people').delete().eq('id', id);
		if (delErr) return { ok: false, error: friendly(delErr.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_lanes_people/${row.user_id}`, action: 'revenue.lane.update', diff: row });
	revalidatePath(PATH, 'layout');
	revalidatePath('/');
	return { ok: true };
}
