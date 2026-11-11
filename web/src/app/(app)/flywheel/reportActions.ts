'use server';

// F6 / F7 actions: draft a report (AI), review / approve / send / cancel,
// run the health check, mute a flag, record asset views.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { FLYWHEEL_PATH } from '@/lib/flywheel/shared';
import { draftReport, sendReport } from '@/lib/flywheel/reports';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function canView(): Promise<boolean> {
	const sb = await createClient();
	const { data } = await sb.rpc('can_view_flywheel');
	return data === true;
}
function revalidate(programId?: string | null) {
	revalidatePath(`${FLYWHEEL_PATH}/reports`);
	revalidatePath(`${FLYWHEEL_PATH}/health`);
	if (programId) revalidatePath(`${FLYWHEEL_PATH}/${programId}`, 'layout');
}

export async function draftReportAction(formData: FormData): Promise<Result<{ id: string; ai: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canView())) return { ok: false, error: 'Flywheel access needed.' };
	const p = z.object({ client_id: uuid, program_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), template_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), from: z.string().regex(DATE_RE), to: z.string().regex(DATE_RE) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Pick a template and a date window.' };
	const r = await draftReport(createServiceRoleClient(), { ...p.data, created_by: profile.id });
	revalidate(p.data.program_id);
	return r.ok ? { ok: true, id: r.id, ai: r.ai } : { ok: false, error: r.error };
}

export async function reviewReport(formData: FormData): Promise<Result<{ status: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, program_id: z.string().optional(), subject: optText(200), body_md: z.string().max(100000).optional(), to_email: optText(160), decision: z.enum(['save', 'review', 'approve', 'approve_send', 'send', 'cancel']).default('save') }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	// The send branch runs with the service role, so the module check cannot be
	// left to RLS (a bare {id, decision: send} would skip the RLS update entirely).
	if (!(await canView())) return { ok: false, error: 'Flywheel access needed.' };
	const d = p.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	if (d.subject) patch.subject = d.subject;
	if (formData.has('body_md')) patch.body_md = d.body_md;
	if (formData.has('to_email')) patch.to_email = d.to_email;
	if (d.decision === 'review') patch.status = 'awaiting_review';
	if (d.decision === 'approve' || d.decision === 'approve_send') patch.status = 'approved';
	if (d.decision === 'cancel') patch.status = 'cancelled';
	if (Object.keys(patch).length) {
		const { error } = await supabase.from('fw_reports').update(patch).eq('id', d.id);
		if (error) return { ok: false, error: error.message.includes('row-level security') ? 'Flywheel access needed.' : error.message.replace(/^flywheel:\s*/, '') };
	}
	if (d.decision === 'send' || d.decision === 'approve_send') {
		const r = await sendReport(createServiceRoleClient(), d.id, profile.id);
		if (!r.ok) return r;
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_reports:${d.id}`, action: 'flywheel.report.send' });
		revalidate(d.program_id);
		return { ok: true, status: 'sent' };
	}
	revalidate(d.program_id);
	return { ok: true, status: (patch.status as string) ?? 'saved' };
}

export async function runHealthCheck(formData: FormData): Promise<Result<{ flags_open: number; resolved: number; bells: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	if (!(await canView())) return { ok: false, error: 'Flywheel access required.' };
	// 0148: fw_health_check is service-role only (it writes flags / bells / metrics for any program).
	const { data, error } = await createServiceRoleClient().rpc('fw_health_check', { p_program: p.data.program_id });
	if (error) return { ok: false, error: error.message };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_health_check:${p.data.program_id ?? 'all'}`, action: 'flywheel.health.check' });
	revalidate(p.data.program_id);
	const j = (data ?? {}) as { flags_open?: number; resolved?: number; bells?: number };
	return { ok: true, flags_open: j.flags_open ?? 0, resolved: j.resolved ?? 0, bells: j.bells ?? 0 };
}

export async function setFlag(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, program_id: z.string().optional(), action: z.enum(['mute_7', 'resolve', 'reopen']) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	// Mute keeps the flag OPEN: fw_health_check dedupes on the partial index
	// `where status = 'open'` and its bell loop already skips muted_until > now().
	// Flipping status to 'muted' let the next daily run re-insert a fresh open
	// flag for the same key and bell everyone again.
	const patch = p.data.action === 'mute_7' ? { status: 'open', muted_by: profile.id, muted_until: new Date(Date.now() + 7 * 86_400_000).toISOString() } : p.data.action === 'resolve' ? { status: 'resolved', resolved_at: new Date().toISOString() } : { status: 'open', muted_until: null };
	const { error } = await supabase.from('fw_health_flags').update(patch).eq('id', p.data.id);
	if (error) return { ok: false, error: error.message };
	revalidate(p.data.program_id);
	return { ok: true };
}

export async function recordAssetViews(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ client_id: uuid, program_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), asset_kind: z.enum(['page', 'citation', 'video', 'media_opp', 'article']), url: optText(600), source: z.enum(['ga4', 'youtube', 'medium', 'manual', 'media_boost', 'other']).default('manual'), day: z.string().regex(DATE_RE), views: z.coerce.number().int().min(0).max(100000000) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	// fw_asset_views_uq is an expression index (coalesce on asset_id / url), so
	// PostgREST's on_conflict cannot target it: find the day's row, then update or insert.
	let q = supabase.from('fw_asset_views').select('id').eq('client_id', p.data.client_id).eq('asset_kind', p.data.asset_kind).eq('source', p.data.source).eq('day', p.data.day).is('asset_id', null);
	q = p.data.url ? q.eq('url', p.data.url) : q.or('url.is.null,url.eq.');
	const { data: existing } = await q.limit(1).maybeSingle();
	const row = { client_id: p.data.client_id, program_id: p.data.program_id, asset_kind: p.data.asset_kind, url: p.data.url, source: p.data.source, day: p.data.day, views: p.data.views };
	const { error } = existing ? await supabase.from('fw_asset_views').update(row).eq('id', (existing as { id: string }).id) : await supabase.from('fw_asset_views').insert(row);
	if (error) return { ok: false, error: error.message };
	revalidate(p.data.program_id);
	return { ok: true };
}
