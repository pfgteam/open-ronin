'use server';

// Flywheel F3 actions (0138): the Nous connection (key encrypted at rest,
// enable / cap / judge model), model panel sync + toggles, locked buyer
// prompts, audit runs (baseline / monthly / re-audit / ad hoc) with the
// cost estimate, cancel. Separate file from actions.ts to keep the
// 'use server' module small; same gates.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { FLYWHEEL_ADMIN_PATH, FLYWHEEL_PATH } from '@/lib/flywheel/shared';
import { loadAuditSettings, loadConnection, saveConnection, syncModels, testConnection } from '@/lib/flywheel/audit';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optUuid = z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null));
const flag = z.string().optional().transform((v) => v === 'on' || v === 'true');

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	return m.replace(/^flywheel:\s*/, '').replace(/^FW_AUDIT_(OFF|CAP|PANEL|PROMPTS):\s*/, '');
}

async function canManage(): Promise<boolean> {
	const profile = await getAuthProfile();
	if (!profile) return false;
	if (profile.role === 'admin' || profile.role === 'exec') return true;
	return hasCapability('manage_flywheel');
}

function revalidate(programId?: string | null) {
	revalidatePath(FLYWHEEL_ADMIN_PATH);
	revalidatePath('/admin/integrations');
	if (programId) revalidatePath(`${FLYWHEEL_PATH}/${programId}`, 'layout');
}

// ---------------------------------------------------------------- connection (manage)

export async function saveNousConnection(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The Nous connection needs the manage_flywheel capability (admin/exec hold it).' };
	const p = z
		.object({ api_key: z.string().trim().max(400).optional(), is_enabled: flag, monthly_cap_usd: z.coerce.number().min(0).max(100000).optional(), judge_model: z.string().trim().max(120).optional(), base_url: z.string().trim().url().optional(), max_tokens: z.coerce.number().int().min(50).max(4000).optional(), concurrency: z.coerce.number().int().min(1).max(16).optional() })
		.safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	const svc = createServiceRoleClient();
	const r = await saveConnection(svc, { api_key: d.api_key || null, is_enabled: formData.has('is_enabled_present') ? d.is_enabled : undefined, monthly_cap_usd: d.monthly_cap_usd, judge_model: d.judge_model === undefined ? undefined : d.judge_model || null, base_url: d.base_url, max_tokens: d.max_tokens, concurrency: d.concurrency, installed_by: profile.id });
	if (!r.ok) return r;
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'fw_ai_connections:nous', action: d.api_key ? 'flywheel.nous.key_set' : 'flywheel.nous.update', diff: { enabled: d.is_enabled, cap: d.monthly_cap_usd } });
	revalidate();
	return { ok: true };
}

export async function syncNousModels(): Promise<Result<{ total: number; panel: number; core: number }>> {
	if (!(await canManage())) return { ok: false, error: 'Syncing the model panel needs manage_flywheel.' };
	const svc = createServiceRoleClient();
	const conn = await loadConnection(svc);
	if (!conn) return { ok: false, error: 'No connection row (apply 0138).' };
	const r = await syncModels(svc, conn, await loadAuditSettings(svc));
	if (!r.ok) {
		await svc.from('fw_ai_connections').update({ last_error: r.error }).eq('id', conn.id);
		return r;
	}
	revalidate();
	return r;
}

export async function testNousConnection(): Promise<Result<{ model: string; ms: number }>> {
	if (!(await canManage())) return { ok: false, error: 'Testing the connection needs manage_flywheel.' };
	const svc = createServiceRoleClient();
	const conn = await loadConnection(svc);
	if (!conn?.encrypted_api_key) return { ok: false, error: 'Enter the key first.' };
	const r = await testConnection(svc, conn);
	revalidate();
	return r;
}

export async function setModelFlags(formData: FormData): Promise<Result> {
	if (!(await canManage())) return { ok: false, error: 'Editing the panel needs manage_flywheel.' };
	const p = z.object({ id: z.string().min(1).max(200), is_core: flag, in_panel: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	if (formData.has('is_core_present')) patch.is_core = p.data.is_core;
	if (formData.has('in_panel_present')) patch.in_panel = p.data.in_panel;
	const { error } = await supabase.from('fw_ai_models').update(patch).eq('id', p.data.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true };
}

/** Bulk: keep only models matching the vendor list in the panel (or all). */
export async function setPanelByVendors(formData: FormData): Promise<Result<{ in_panel: number }>> {
	if (!(await canManage())) return { ok: false, error: 'Editing the panel needs manage_flywheel.' };
	const vendors = formData.getAll('vendor').map(String).filter(Boolean);
	const all = formData.get('all') === 'on';
	const supabase = await createClient();
	const { error: e1 } = await supabase.from('fw_ai_models').update({ in_panel: all }).eq('is_active', true);
	if (e1) return { ok: false, error: friendly(e1.message) };
	if (!all && vendors.length) {
		const { error: e2 } = await supabase.from('fw_ai_models').update({ in_panel: true }).in('vendor', vendors);
		if (e2) return { ok: false, error: friendly(e2.message) };
	}
	await supabase.from('fw_ai_models').update({ in_panel: true }).eq('is_core', true);
	const { count } = await supabase.from('fw_ai_models').select('id', { count: 'exact', head: true }).eq('in_panel', true).eq('is_active', true);
	revalidate();
	return { ok: true, in_panel: count ?? 0 };
}

// ---------------------------------------------------------------- prompts

export async function savePrompt(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: optUuid, program_id: uuid, prompt: z.string().trim().min(5).max(500).optional(), stage: z.enum(['awareness', 'consideration', 'decision', 'comparison', 'other']).optional(), keyword: z.string().trim().max(200).optional(), position: z.coerce.number().int().min(1).max(99).optional(), retire: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	const supabase = await createClient();
	if (d.id && d.retire) {
		const { error } = await supabase.from('fw_audit_prompts').update({ retired_at: new Date().toISOString() }).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
	} else if (d.id) {
		const patch: Record<string, unknown> = {};
		if (d.prompt) patch.prompt = d.prompt;
		if (d.stage) patch.stage = d.stage;
		if (formData.has('keyword')) patch.keyword = d.keyword || null;
		if (d.position) patch.position = d.position;
		const { error } = await supabase.from('fw_audit_prompts').update(patch).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
	} else {
		if (!d.prompt) return { ok: false, error: 'Write the prompt.' };
		const { data: max } = await supabase.from('fw_audit_prompts').select('position').eq('program_id', d.program_id).order('position', { ascending: false }).limit(1).maybeSingle();
		const { error } = await supabase.from('fw_audit_prompts').insert({ program_id: d.program_id, prompt: d.prompt, stage: d.stage ?? null, keyword: d.keyword || null, position: d.position ?? ((max as { position: number } | null)?.position ?? 0) + 1, created_by: profile.id });
		if (error) return { ok: false, error: friendly(error.message) };
	}
	revalidate(d.program_id);
	return { ok: true };
}

/** Locks every unlocked, unretired prompt (kickoff). Irreversible by design. */
export async function lockPrompts(formData: FormData): Promise<Result<{ locked: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data, error } = await supabase.from('fw_audit_prompts').update({ is_locked: true }).eq('program_id', p.data.program_id).eq('is_locked', false).is('retired_at', null).select('id');
	if (error) return { ok: false, error: friendly(error.message) };
	const n = (data ?? []).length;
	await supabase.rpc('fw_log', { p_program: p.data.program_id, p_kind: 'audit', p_summary: `${n} buyer prompts locked`, p_payload: {}, p_client_visible: true, p_actor_label: null });
	revalidate(p.data.program_id);
	return { ok: true, locked: n };
}

/** AI-suggest 10 buyer prompts from the program's keywords / ICP (draft rows, unlocked). */
export async function suggestPrompts(formData: FormData): Promise<Result<{ added: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data: prog } = await supabase.from('fw_programs').select('brand_name, primary_url, icp_md, keywords, competitors').eq('id', p.data.program_id).maybeSingle();
	const pr = prog as { brand_name: string | null; primary_url: string | null; icp_md: string | null; keywords: string[]; competitors: string[] } | null;
	if (!pr) return { ok: false, error: 'Program not found.' };
	const { generateText, extractJson } = await import('@/lib/flywheel/ai');
	const r = await generateText(
		'You write the 10 locked buyer prompts for an AI visibility audit. They are the literal questions a buyer would ask ChatGPT / Claude / Gemini / Perplexity when looking for what the brand sells — NOT mentioning the brand. Cover the journey: awareness (what is / how to), consideration (best / top), decision (which should I buy / is X worth it), comparison (X vs Y). Return ONLY JSON: {"prompts":[{"prompt":"...","stage":"awareness|consideration|decision|comparison","keyword":"the keyword it targets"}]}',
		`Brand: ${pr.brand_name ?? ''} (${pr.primary_url ?? ''})\nIdeal customer: ${pr.icp_md ?? ''}\nKeywords: ${(pr.keywords ?? []).join('; ')}\nCompetitors: ${(pr.competitors ?? []).join('; ')}`,
		1500,
	);
	if (!r.ok) return r;
	const j = extractJson<{ prompts?: { prompt: string; stage?: string; keyword?: string }[] }>(r.text);
	const list = (j?.prompts ?? []).filter((x) => x?.prompt).slice(0, 10);
	if (list.length === 0) return { ok: false, error: 'The model returned no prompts.' };
	const { data: max } = await supabase.from('fw_audit_prompts').select('position').eq('program_id', p.data.program_id).order('position', { ascending: false }).limit(1).maybeSingle();
	let pos = (max as { position: number } | null)?.position ?? 0;
	const rows = list.map((x) => ({ program_id: p.data.program_id, prompt: String(x.prompt).slice(0, 500), stage: ['awareness', 'consideration', 'decision', 'comparison'].includes(x.stage ?? '') ? x.stage : 'other', keyword: x.keyword ? String(x.keyword).slice(0, 200) : null, position: ++pos, created_by: profile.id }));
	const { error } = await supabase.from('fw_audit_prompts').insert(rows);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true, added: rows.length };
}

// ---------------------------------------------------------------- runs

export async function queueAudit(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, kind: z.enum(['baseline', 'monthly', 'reaudit', 'adhoc']).default('monthly'), cluster_id: optUuid, core_only: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	let modelIds: string[] | null = null;
	if (p.data.core_only) {
		const { data } = await supabase.from('fw_ai_models').select('id').eq('is_core', true).eq('is_active', true);
		modelIds = ((data ?? []) as { id: string }[]).map((m) => m.id);
		if (modelIds.length === 0) return { ok: false, error: 'No core models flagged; sync the panel in Admin → Flywheel → AI panel.' };
	}
	const { data, error } = await supabase.rpc('fw_audit_queue', { p_program: p.data.program_id, p_kind: p.data.kind, p_model_ids: modelIds, p_cluster: p.data.cluster_id });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true, id: data as string };
}

export async function cancelAudit(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ run_id: uuid, program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('fw_audit_runs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', p.data.run_id).in('status', ['queued', 'running', 'capped']);
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('fw_audit_answers').update({ status: 'skipped' }).eq('run_id', p.data.run_id).eq('status', 'queued');
	revalidate(p.data.program_id);
	return { ok: true };
}

/** Estimate for the UI before queuing (full panel vs core). */
export async function estimateAudit(formData: FormData): Promise<Result<{ models: number; prompts: number; usd: number; cap: number; used: number; enabled: boolean }>> {
	const p = z.object({ program_id: uuid, core_only: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const svc = createServiceRoleClient();
	const conn = await loadConnection(svc);
	const q = supabase.from('fw_ai_models').select('id').eq('is_active', true);
	const { data: models } = p.data.core_only ? await q.eq('is_core', true) : await q.eq('in_panel', true);
	const ids = ((models ?? []) as { id: string }[]).map((m) => m.id);
	const { count } = await supabase.from('fw_audit_prompts').select('id', { count: 'exact', head: true }).eq('program_id', p.data.program_id).eq('is_locked', true).is('retired_at', null);
	const { data: est } = await supabase.rpc('fw_audit_estimate', { p_model_ids: ids, p_prompts: count ?? 0, p_max_tokens: conn?.max_tokens ?? 600 });
	return { ok: true, models: ids.length, prompts: count ?? 0, usd: Number(est ?? 0), cap: conn?.monthly_cap_usd ?? 0, used: conn?.spend_month_usd ?? 0, enabled: !!(conn?.is_enabled && conn.encrypted_api_key) };
}
