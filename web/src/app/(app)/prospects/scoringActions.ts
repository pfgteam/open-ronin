'use server';

// Revenue Engine P2 actions (0122): fit signals + rescore + enrich on a
// deal; scoring config, connector tokens and form links in Admin. Same
// posture as actions.ts: zod on input, RLS (can_manage_revenue) is the
// guard, recordAudit on writes, { ok, error } back to the client.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { BUDGET_BANDS, ROUTINGS, TIMINGS } from '@/lib/revenue/shared';
import { isHttpUrl, isIntakeKey, parseScoringValue, scoringKindForKey } from '@/lib/revenue/adminOptions';
import { enrichBrand } from '@/lib/revenue/enrichment';
import { hashToken, mintToken } from '@/lib/revenue/intake';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const triBool = z.string().optional().transform((v) => (v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : null));

async function viewer() {
	return getAuthProfile();
}

function friendly(message: string): string {
	if (message.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	return message;
}

// ---------------------------------------------------------------- fit signals

const FitInput = z.object({
	deal_id: uuid,
	website: z.string().optional().transform((v) => (v === '' || v == null ? null : Math.max(0, Math.min(3, Number(v))))),
	why_grow: optText(2000),
	roadblock: optText(2000),
	interest_pr: triBool,
	interest_ads: triBool,
	interest_smm: triBool,
	industry: optText(120),
	budget_band: z.enum(BUDGET_BANDS).or(z.literal('')).optional().transform((v) => (v ? v : null)),
	agency_before: triBool,
	timing: z.enum(TIMINGS).or(z.literal('')).optional().transform((v) => (v ? v : null)),
	work_email: triBool,
	brand_presence: optText(40),
	revenue: optText(80),
	locations: optText(40),
	competitors: optText(400),
	pr_goal: optText(1000),
	decision_maker: optText(80),
});

/** Save the Quality inputs on a deal. The DB trigger rescores + routes. */
export async function saveFitSignals(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = FitInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { deal_id, budget_band, timing, ...signals } = parsed.data;
	const supabase = await createClient();
	const { data: cur } = await supabase.from('rev_deals').select('fit_signals').eq('id', deal_id).maybeSingle();
	const next: Record<string, unknown> = { ...((cur?.fit_signals as Record<string, unknown>) ?? {}) };
	for (const [k, v] of Object.entries(signals)) {
		if (v === null || v === undefined) delete next[k];
		else next[k] = v;
	}
	if (budget_band) next.budget_band = budget_band;
	if (timing) next.timing = timing;
	const patch: Record<string, unknown> = { fit_signals: next };
	if (budget_band) patch.budget_band = budget_band;
	if (timing) patch.timing = timing;
	const { error, count } = await supabase.from('rev_deals').update(patch, { count: 'exact' }).eq('id', deal_id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${deal_id}`, action: 'revenue.deal.fit', diff: patch });
	revalidatePath(`/prospects/deals/${deal_id}`);
	revalidatePath('/prospects');
	return { ok: true };
}

export async function rescoreDeal(input: { deal_id: string }): Promise<Result<{ score: Record<string, unknown> | null }>> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.deal_id).success) return { ok: false, error: 'Invalid deal.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('rev_rescore', { p_deal: input.deal_id });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true, score: (data as Record<string, unknown> | null) ?? null };
}

/** Set routing by hand (sticks: rev_rescore never overwrites 'manual'). */
export async function setRouting(input: { deal_id: string; routing: 'book_call' | 'setter_outreach' | 'nurture' | 'beacon_offer' | 'manual' | '' }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.deal_id).success) return { ok: false, error: 'Invalid deal.' };
	const supabase = await createClient();
	const { error, count } = await supabase
		.from('rev_deals')
		.update({ routing: input.routing || null, routed_at: new Date().toISOString() }, { count: 'exact' })
		.eq('id', input.deal_id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${input.deal_id}`, action: 'revenue.deal.route', diff: { routing: input.routing } });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true };
}

/** Run enrichment for one brand now (service role: the providers write facts, not the viewer). */
export async function enrichBrandNow(input: { brand_id: string; deal_id?: string }): Promise<Result<{ providers: string[]; status: string }>> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.brand_id).success) return { ok: false, error: 'Invalid brand.' };
	// the viewer must at least see the brand (RLS) before we enrich it with the service role
	const supabase = await createClient();
	const { data: visible } = await supabase.from('rev_brands').select('id').eq('id', input.brand_id).maybeSingle();
	if (!visible) return { ok: false, error: 'Brand not visible to you.' };
	const log = await enrichBrand(createServiceRoleClient(), input.brand_id);
	if (log.status === 'failed') return { ok: false, error: log.error ?? 'Enrichment failed.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_brands/${input.brand_id}`, action: 'revenue.brand.enrich', diff: { providers: log.providers } });
	if (input.deal_id) revalidatePath(`/prospects/deals/${input.deal_id}`);
	revalidatePath(`/prospects/brands/${input.brand_id}`);
	return { ok: true, providers: log.providers, status: log.status };
}

// ---------------------------------------------------------------- scoring config (manage_revenue)

/**
 * Save scoring values (spec 2026-10-19 §7). Each key keeps its kind: a numeric
 * weight never becomes an array (rev_cfg_num would silently fall back to its
 * default) and a list stays a list. Only keys that exist are updated.
 */
export async function saveScoringConfig(input: { values: Record<string, unknown> }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const supabase = await createClient();
	const keys = Object.keys(input.values ?? {}).filter((k) => /^[a-z][a-z0-9_]{1,60}$/.test(k));
	if (!keys.length) return { ok: true };
	const { data: current, error: readErr } = await supabase.from('rev_scoring_config').select('key, value').in('key', keys);
	if (readErr) return { ok: false, error: friendly(readErr.message) };
	const byKey = new Map(((current ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
	const parsed: [string, number | string[]][] = [];
	for (const key of keys) {
		if (!byKey.has(key)) continue;
		const r = parseScoringValue(scoringKindForKey(key), input.values[key]);
		if (!r.ok) return { ok: false, error: `${key}: ${r.error}` };
		parsed.push([key, r.value]);
	}
	for (const [key, value] of parsed) {
		const { error, count } = await supabase.from('rev_scoring_config').update({ value, updated_by: profile.id }, { count: 'exact' }).eq('key', key);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'rev_scoring_config', action: 'revenue.scoring.save', diff: Object.fromEntries(parsed) });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

/** Open-deal count for the Rescore confirmation and progress bar. */
export async function countOpenDeals(): Promise<number> {
	const supabase = await createClient();
	const { count } = await supabase.from('rev_deals').select('id', { count: 'exact', head: true }).eq('status', 'open');
	return count ?? 0;
}

/**
 * One page of "Rescore all open" (spec §7): keyset over id so every open
 * deal is reached (the old version read .limit(2000) under PostgREST's 1000
 * cap and timed out). The client loops until finished.
 */
export async function rescoreOpenPage(input: { afterId: string | null; size?: number }): Promise<Result<{ done: number; failed: number; firstError: string | null; lastId: string | null; finished: boolean }>> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await hasCapability('manage_revenue'))) return { ok: false, error: 'You need the manage_revenue capability.' };
	const size = Math.min(Math.max(1, Math.floor(input.size ?? 200)), 300);
	const db = createServiceRoleClient();
	let q = db.from('rev_deals').select('id').eq('status', 'open').order('id', { ascending: true }).limit(size);
	if (input.afterId && uuid.safeParse(input.afterId).success) q = q.gt('id', input.afterId);
	const { data, error } = await q;
	if (error) return { ok: false, error: error.message };
	const ids = ((data ?? []) as { id: string }[]).map((d) => d.id);
	let done = 0;
	let failed = 0;
	let firstError: string | null = null;
	for (const id of ids) {
		const { error: e } = await db.rpc('rev_rescore', { p_deal: id });
		if (!e) done++;
		else {
			failed++;
			firstError ??= e.message;
		}
	}
	const finished = ids.length < size;
	if (finished) {
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'rev_deals', action: 'revenue.scoring.rescore_all', diff: { last_page: done, failed } });
		revalidatePath('/prospects');
	}
	return { ok: true, done, failed, firstError, lastId: ids[ids.length - 1] ?? input.afterId, finished };
}

// ---------------------------------------------------------------- connectors (manage_revenue)

async function pipelineExists(db: Awaited<ReturnType<typeof createClient>>, slug: string): Promise<boolean> {
	const { data } = await db.from('rev_pipelines').select('id').eq('slug', slug).eq('is_active', true).maybeSingle();
	return !!data;
}

const SourceInput = z.object({
	key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
	label: z.string().trim().min(1).max(120),
	default_pipeline: z.string().trim().min(1).max(60),
	default_source: optText(60),
	default_channel: optText(60),
	default_motion: z.string().trim().min(1).max(30),
	field_map: z.string().trim(),
	note: optText(1000),
	enabled: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

export async function saveIntakeSource(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = SourceInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { key, field_map, ...rest } = parsed.data;
	let map: unknown;
	try {
		map = field_map ? JSON.parse(field_map) : {};
	} catch {
		return { ok: false, error: 'Field map must be a JSON object.' };
	}
	if (!map || typeof map !== 'object' || Array.isArray(map)) return { ok: false, error: 'Field map must be a JSON object.' };
	const badKey = Object.entries(map as Record<string, unknown>).find(([k, v]) => !isIntakeKey(k) || typeof v !== 'string' || !v);
	if (badKey) return { ok: false, error: `Field map: "${badKey[0]}" is not a field the engine reads.` };
	const supabase = await createClient();
	// A connector pointing at a pipeline that does not exist rejects every lead (the 'lead_gen' vs 'lead-gen' bug): never enable one.
	if (rest.enabled && !(await pipelineExists(supabase, rest.default_pipeline))) return { ok: false, error: `Pick an existing pipeline before enabling (${rest.default_pipeline} does not exist).` };
	const { error, count } = await supabase.from('rev_intake_sources').update({ ...rest, field_map: map }, { count: 'exact' }).eq('key', key);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) {
		const { error: e2 } = await supabase.from('rev_intake_sources').insert({ key, ...rest, field_map: map, kind: 'webhook' });
		if (e2) return { ok: false, error: friendly(e2.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_intake_sources/${key}`, action: 'revenue.source.save', diff: { ...rest } });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

/**
 * Issue (or rotate) the webhook token for a source. Shown ONCE in the
 * response; only the sha256 is stored. Enables the source.
 */
export async function issueIntakeToken(input: { key: string }): Promise<Result<{ token: string; url: string }>> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) return { ok: false, error: 'Invalid source.' };
	if (!(await hasCapability('manage_revenue'))) return { ok: false, error: 'You need the manage_revenue capability.' };
	{
		const supabase = await createClient();
		const { data: src } = await supabase.from('rev_intake_sources').select('default_pipeline').eq('key', input.key).maybeSingle();
		const pipe = (src as { default_pipeline: string | null } | null)?.default_pipeline ?? null;
		if (pipe && !(await pipelineExists(supabase, pipe))) return { ok: false, error: `Pick an existing pipeline first (${pipe} does not exist); a token enables the connector.` };
	}
	const token = mintToken(input.key);
	// token_hash is admin-only through a column grant, so the write goes
	// through the service role after the capability check above.
	const db = createServiceRoleClient();
	const { error, count } = await db.from('rev_intake_sources').update({ token_hash: hashToken(token), token_issued_at: new Date().toISOString(), enabled: true }, { count: 'exact' }).eq('key', input.key);
	if (error) return { ok: false, error: error.message };
	if (!count) return { ok: false, error: 'Unknown source.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_intake_sources/${input.key}`, action: 'revenue.source.token' });
	revalidatePath('/admin/prospects', 'layout');
	const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	return { ok: true, token, url: `${base}/api/intake/${input.key}` };
}

export async function revokeIntakeToken(input: { key: string }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) return { ok: false, error: 'Invalid source.' };
	if (!(await hasCapability('manage_revenue'))) return { ok: false, error: 'You need the manage_revenue capability.' };
	const db = createServiceRoleClient();
	const { error } = await db.from('rev_intake_sources').update({ token_hash: null, token_issued_at: null, enabled: false }).eq('key', input.key);
	if (error) return { ok: false, error: error.message };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_intake_sources/${input.key}`, action: 'revenue.source.revoke' });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

// ---------------------------------------------------------------- form links

const LinkInput = z.object({
	form_id: uuid,
	enabled: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	public: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	default_pipeline: z.string().trim().min(1).max(60),
	default_source: z.string().trim().min(1).max(60),
	default_channel: optText(60),
	default_motion: z.string().trim().min(1).max(30),
	field_map: z.string().trim(),
	routing_copy: z.string().trim(),
});

export async function saveFormLink(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = LinkInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { form_id, field_map, routing_copy, ...rest } = parsed.data;
	let map: unknown, copy: unknown;
	try {
		map = field_map ? JSON.parse(field_map) : {};
		copy = routing_copy ? JSON.parse(routing_copy) : {};
	} catch {
		return { ok: false, error: 'Field map and routing copy must be JSON objects.' };
	}
	const mapObj = (map ?? {}) as Record<string, unknown>;
	const bad = Object.entries(mapObj).find(([k, v]) => !isIntakeKey(k) || typeof v !== 'string' || !v);
	if (bad) return { ok: false, error: `Answer map: "${bad[0]}" is not a field the engine reads.` };
	const copyObj = (copy ?? {}) as Record<string, { title?: unknown; body?: unknown; cta_label?: unknown; cta_url?: unknown }>;
	for (const [k, v] of Object.entries(copyObj)) {
		if (!(ROUTINGS as readonly string[]).includes(k)) return { ok: false, error: `Unknown outcome "${k}".` };
		if (v?.cta_url && (typeof v.cta_url !== 'string' || !isHttpUrl(v.cta_url))) return { ok: false, error: `${k}: the button link must be a full https:// URL.` };
	}
	const supabase = await createClient();
	const { error } = await supabase.from('rev_form_links').upsert({ form_id, ...rest, field_map: map, routing_copy: copy }, { onConflict: 'form_id' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_form_links/${form_id}`, action: 'revenue.form_link.save', diff: rest });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

/** Turn a connector on or off (spec 2026-10-19 §8). Never on while it points at a pipeline that does not exist. */
export async function setIntakeSourceEnabled(input: { key: string; enabled: boolean }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) return { ok: false, error: 'Invalid source.' };
	const supabase = await createClient();
	if (input.enabled) {
		const { data: src } = await supabase.from('rev_intake_sources').select('default_pipeline').eq('key', input.key).maybeSingle();
		const pipe = (src as { default_pipeline: string | null } | null)?.default_pipeline ?? '';
		if (!(await pipelineExists(supabase, pipe))) return { ok: false, error: `Pick an existing pipeline before enabling (${pipe || 'none set'}).` };
	}
	const { error, count } = await supabase.from('rev_intake_sources').update({ enabled: input.enabled }, { count: 'exact' }).eq('key', input.key);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_intake_sources/${input.key}`, action: input.enabled ? 'revenue.source.enable' : 'revenue.source.disable' });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}
