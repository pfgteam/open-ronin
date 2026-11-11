'use server';

// Revenue Engine P3 actions (0123): GHL private-token connections, cutover
// toggles, settings, push now / replay. manage_revenue in SQL for the config
// tables; connections and the sync log are service-role writes behind an
// explicit capability check (the 0007 tables are admin-only through RLS).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { encryptToken } from '@/lib/ghl/crypto';
import { connectionFor, pushDeal, replayLog, testConnection } from '@/lib/revenue/ghlSync';
import { runBackfillChunk, startBackfill, type BackfillChunk } from '@/lib/revenue/ghlBackfill';
import { normalizeGhlSetting } from '@/lib/revenue/adminOptions';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const PATH = '/admin/prospects';

async function manager(): Promise<{ id: string } | null> {
	const profile = await getAuthProfile();
	if (!profile) return null;
	if (!(await hasCapability('manage_revenue'))) return null;
	return { id: profile.id };
}

const ConnInput = z.object({
	label: z.string().trim().min(1).max(80),
	ghl_location_id: z.string().trim().min(6).max(80),
	token: z.string().trim().min(20).max(400),
	org: z.enum(['main', 'premium', 'beacon']).or(z.literal('')).optional().transform((v) => (v ? v : null)),
	is_default: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

/** Add a sub-account with a Private Integration token (GHL → Settings → Private Integrations). */
export async function addPrivateTokenConnection(formData: FormData): Promise<Result<{ id: string; name?: string }>> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	const parsed = ConnInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { label, ghl_location_id, token, org, is_default } = parsed.data;
	let enc: string;
	try {
		enc = encryptToken(token);
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
	const db = createServiceRoleClient();
	if (is_default) await db.from('ghl_connections').update({ is_default: false }).eq('is_default', true);
	const { data, error } = await db
		.from('ghl_connections')
		.upsert(
			{ scope: 'location', ghl_location_id, ghl_company_id: null, label, auth_kind: 'private_token', org, is_default, encrypted_access_token: enc, encrypted_refresh_token: enc, expires_at: null, scopes: 'private', installed_by: me.id, disconnected_at: null },
			{ onConflict: 'scope,ghl_location_id,ghl_company_id' },
		)
		.select('id')
		.single();
	if (error) return { ok: false, error: error.message };
	const t = await testConnection(db, data.id);
	await recordAudit({ actor_id: me.id, entity_kind: 'supabase', entity_ref: `ghl_connections/${data.id}`, action: 'ghl.connection.private_token', diff: { label, ghl_location_id, org, test: t.ok } });
	revalidatePath(PATH, 'layout');
	revalidatePath('/admin/integrations/ghl');
	if (!t.ok) return { ok: false, error: `Saved, but the token did not work: ${t.error}` };
	return { ok: true, id: data.id, name: t.name };
}

export async function testGhlConnection(input: { id: string }): Promise<Result<{ name?: string }>> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid connection.' };
	const r = await testConnection(createServiceRoleClient(), input.id);
	revalidatePath(PATH, 'layout');
	return r.ok ? { ok: true, name: r.name } : { ok: false, error: r.error ?? 'failed' };
}

export async function disconnectGhl(input: { id: string }): Promise<Result> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid connection.' };
	const db = createServiceRoleClient();
	const { error } = await db.from('ghl_connections').update({ disconnected_at: new Date().toISOString(), is_default: false }).eq('id', input.id);
	if (error) return { ok: false, error: error.message };
	await recordAudit({ actor_id: me.id, entity_kind: 'supabase', entity_ref: `ghl_connections/${input.id}`, action: 'ghl.connection.disconnect' });
	revalidatePath(PATH, 'layout');
	return { ok: true };
}

export async function setCutover(input: { key: string; owner: 'ghl' | 'main' | 'off' }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key) || !['ghl', 'main', 'off'].includes(input.owner)) return { ok: false, error: 'Invalid toggle.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('ghl_cutover').update({ owner: input.owner, updated_by: profile.id }, { count: 'exact' }).eq('key', input.key);
	if (error) return { ok: false, error: error.message };
	if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `ghl_cutover/${input.key}`, action: 'ghl.cutover', diff: { owner: input.owner } });
	revalidatePath(PATH, 'layout');
	return { ok: true };
}

export async function saveGhlSettings(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const supabase = await createClient();
	for (const [k, raw] of formData.entries()) {
		if (!k.startsWith('set:')) continue;
		const key = k.slice(4);
		if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) continue;
		// No blanket trim: opportunity_name_suffix keeps its leading space (spec 2026-10-19 §8).
		const norm = normalizeGhlSetting(key, String(raw));
		if (!norm.ok) return { ok: false, error: `${key}: ${norm.error}` };
		const value = norm.value;
		const { error, count } = await supabase.from('ghl_settings').update({ value, updated_by: profile.id }, { count: 'exact' }).eq('key', key);
		if (error) return { ok: false, error: error.message };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'ghl_settings', action: 'ghl.settings.save' });
	revalidatePath(PATH, 'layout');
	return { ok: true };
}

/** Push one deal now (ignores the eligibility flag, respects the cutover unless force). */
export async function pushDealToGhl(input: { deal_id: string; force?: boolean }): Promise<Result<{ status: string; ghl_contact_id?: string | null }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.deal_id).success) return { ok: false, error: 'Invalid deal.' };
	const supabase = await createClient();
	const { data: visible } = await supabase.from('rev_deals').select('id').eq('id', input.deal_id).maybeSingle();
	if (!visible) return { ok: false, error: 'Deal not visible to you.' };
	const r = await pushDeal(createServiceRoleClient(), input.deal_id, { force: !!input.force });
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${input.deal_id}`, action: 'ghl.push', diff: { status: r.status, error: r.error } });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	revalidatePath(PATH, 'layout');
	if (r.status === 'failed') return { ok: false, error: r.error ?? 'Push failed.' };
	if (r.status === 'skipped') return { ok: false, error: r.error ?? 'Skipped.' };
	return { ok: true, status: r.status, ghl_contact_id: r.ghl_contact_id };
}

export async function replaySyncLog(input: { id: string }): Promise<Result<{ status: string }>> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid row.' };
	const r = await replayLog(createServiceRoleClient(), input.id);
	revalidatePath(PATH, 'layout');
	if (!r) return { ok: false, error: 'That row has no deal to replay.' };
	if (r.status !== 'pushed') return { ok: false, error: r.error ?? r.status };
	return { ok: true, status: r.status };
}

/** Create (or resume) the backfill runs for the Open Ronin location. */
export async function startGhlBackfill(): Promise<Result<{ runs: number }>> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	const db = createServiceRoleClient();
	const r = await startBackfill(db, await connectionFor(db, 'main'), me.id);
	if (!r.ok) return { ok: false, error: r.error };
	await recordAudit({ actor_id: me.id, entity_kind: 'supabase', entity_ref: 'ghl_backfill_runs', action: 'ghl.backfill.start', diff: { runs: r.runs } });
	revalidatePath(PATH, 'layout');
	return { ok: true, runs: r.runs };
}

/** Advance the backfill for ~45 seconds. The Admin card calls this in a loop until it returns chunk: null. */
export async function runGhlBackfillNow(): Promise<Result<{ chunk: BackfillChunk | null }>> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	const chunk = await runBackfillChunk(createServiceRoleClient(), { budgetMs: 45_000 });
	if (!chunk) revalidatePath(PATH, 'layout');
	return { ok: true, chunk };
}

const StageMapInput = z.object({
	ghl_stage_id: z.string().trim().min(1).max(80),
	pipeline_slug: z.string().trim().regex(/^[a-z0-9-]+$/),
	stage_slug: z.string().trim().regex(/^[a-z0-9-]+$/),
	icp_band: z.enum(['0-7', '8-15', '16-20']).or(z.literal('')).optional().transform((v) => (v ? v : null)),
});

/** Where one GHL stage lands in the app (ghl_stage_map; RLS: can_manage_revenue, 0155:350). */
export async function saveStageMapRow(input: { ghl_stage_id: string; pipeline_slug: string; stage_slug: string; icp_band?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = StageMapInput.safeParse({ ...input, icp_band: input.icp_band ?? '' });
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid mapping.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: pipe } = await supabase.from('rev_pipelines').select('id').eq('slug', d.pipeline_slug).maybeSingle();
	if (!pipe) return { ok: false, error: 'Unknown pipeline.' };
	const { data: stage } = await supabase.from('rev_stages').select('id').eq('pipeline_id', (pipe as { id: string }).id).eq('slug', d.stage_slug).maybeSingle();
	if (!stage) return { ok: false, error: 'That stage is not in the chosen pipeline.' };
	const { error, count } = await supabase
		.from('ghl_stage_map')
		.update({ pipeline_slug: d.pipeline_slug, stage_slug: d.stage_slug, icp_band: d.icp_band, updated_by: profile.id }, { count: 'exact' })
		.eq('ghl_stage_id', d.ghl_stage_id);
	if (error) return { ok: false, error: error.message };
	if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `ghl_stage_map/${d.ghl_stage_id}`, action: 'ghl.stage_map.save', diff: d });
	revalidatePath(PATH, 'layout');
	return { ok: true };
}
