'use server';

// Revenue Engine P5 actions (0125): calls on a deal, briefs, analysis,
// action items, rubrics, documents.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { analyzeCall, buildBrief, pullZoomRecording } from '@/lib/revenue/ai';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

function friendly(m: string) {
	return m.includes('row-level security') ? 'Not allowed: you do not hold the permission for this write.' : m;
}
async function visibleDeal(dealId: string): Promise<boolean> {
	const supabase = await createClient();
	const { data } = await supabase.from('rev_deals').select('id').eq('id', dealId).maybeSingle();
	return !!data;
}

const CallInput = z.object({
	deal_id: uuid,
	person_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	call_kind: z.enum(['triage', 'discovery', 'closing', 'other']).default('other'),
	source: z.enum(['zoom', 'ghl', 'manual', 'upload']).default('manual'),
	external_id: optText(120),
	scheduled_at: optText(40),
	occurred_at: optText(40),
	recording_url: optText(500),
	transcript_md: z.string().optional().transform((v) => (v && v.trim() ? v.trim().slice(0, 2_000_000) : null)),
});

/** Add a call (scheduled or past; paste a transcript or a Zoom meeting id). */
export async function addCall(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = CallInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const status = d.transcript_md ? 'transcribed' : d.recording_url ? 'recorded' : d.occurred_at ? 'recorded' : 'scheduled';
	const { data, error } = await supabase
		.from('rev_calls')
		.insert({
			deal_id: d.deal_id,
			person_id: d.person_id,
			call_kind: d.call_kind,
			rubric_key: d.call_kind === 'other' ? null : d.call_kind,
			source: d.source,
			external_id: d.external_id,
			owner_id: profile.id,
			scheduled_at: d.scheduled_at ? new Date(d.scheduled_at).toISOString() : null,
			occurred_at: d.occurred_at ? new Date(d.occurred_at).toISOString() : null,
			recording_url: d.recording_url,
			transcript_md: d.transcript_md,
			status,
			created_by: profile.id,
		})
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_calls/${data.id}`, action: 'revenue.call.add', diff: { kind: d.call_kind, source: d.source, status } });
	revalidatePath(`/prospects/deals/${d.deal_id}`);
	return { ok: true, id: data.id };
}

export async function generateBrief(input: { deal_id: string; call_id?: string | null }): Promise<Result<{ body_md: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.deal_id).success || !(await visibleDeal(input.deal_id))) return { ok: false, error: 'Deal not visible to you.' };
	const r = await buildBrief(createServiceRoleClient(), input.deal_id, { callId: input.call_id ?? null, forUserId: profile.id });
	if ('error' in r) return { ok: false, error: r.error };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_briefs/${r.id}`, action: 'revenue.brief.generate' });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true, body_md: r.body_md };
}

export async function runCallAnalysis(input: { call_id: string; deal_id: string }): Promise<Result<{ score: number | null }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.call_id).success || !(await visibleDeal(input.deal_id))) return { ok: false, error: 'Call not visible to you.' };
	const r = await analyzeCall(createServiceRoleClient(), input.call_id);
	if (!r.ok) return { ok: false, error: r.error };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_calls/${input.call_id}`, action: 'revenue.call.analyze', diff: { score: r.analysis.score } });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true, score: r.analysis.score };
}

export async function pullRecording(input: { call_id: string; deal_id: string }): Promise<Result<{ transcript: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.call_id).success || !(await visibleDeal(input.deal_id))) return { ok: false, error: 'Call not visible to you.' };
	const r = await pullZoomRecording(createServiceRoleClient(), input.call_id);
	if (!r.ok) return { ok: false, error: r.error };
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true, transcript: r.transcript };
}

export async function decideActionItem(input: { id: string; deal_id: string; decision: 'accept' | 'dismiss' }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid item.' };
	const supabase = await createClient();
	if (input.decision === 'accept') {
		const { error } = await supabase.rpc('rev_accept_action_item', { p_item: input.id });
		if (error) return { ok: false, error: friendly(error.message) };
	} else {
		const { error } = await supabase.from('rev_call_action_items').update({ status: 'dismissed' }).eq('id', input.id);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true };
}

export async function applySuggestedStage(input: { call_id: string; deal_id: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const supabase = await createClient();
	const { data: call } = await supabase.from('rev_calls').select('suggested_stage_slug').eq('id', input.call_id).maybeSingle();
	const slug = (call as { suggested_stage_slug: string | null } | null)?.suggested_stage_slug;
	if (!slug) return { ok: false, error: 'No suggested stage.' };
	const { data: deal } = await supabase.from('rev_deals').select('pipeline_id').eq('id', input.deal_id).maybeSingle();
	if (!deal) return { ok: false, error: 'Deal not visible.' };
	const { data: stage } = await supabase.from('rev_stages').select('id').eq('pipeline_id', deal.pipeline_id).eq('slug', slug).maybeSingle();
	if (!stage) return { ok: false, error: `Stage "${slug}" is not in this pipeline.` };
	const { error } = await supabase.from('rev_deals').update({ stage_id: stage.id }).eq('id', input.deal_id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${input.deal_id}`, action: 'revenue.deal.move', diff: { stage: slug, via: 'call_suggestion' } });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	revalidatePath('/prospects');
	return { ok: true };
}

const RubricInput = z.object({
	key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
	label: z.string().trim().min(1).max(120),
	call_kind: z.enum(['triage', 'discovery', 'closing', 'other']),
	body_md: z.string().trim().min(10).max(20000),
	is_active: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

/** Parse "- **Name** (weight): …" lines under "## Criteria". */
export async function parseRubricCriteria(body: string): Promise<{ name: string; weight: number }[]> {
	const out: { name: string; weight: number }[] = [];
	const re = /^-\s+\*\*(.+?)\*\*\s*\((\d+(?:\.\d+)?)\)/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) out.push({ name: m[1].trim(), weight: Number(m[2]) });
	return out;
}

export async function saveRubric(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = RubricInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const criteria = await parseRubricCriteria(d.body_md);
	if (!criteria.length) return { ok: false, error: 'No criteria found: list them as "- **Name** (weight): description" under "## Criteria".' };
	const total = criteria.reduce((n, c) => n + c.weight, 0);
	if (Math.abs(total - 100) > 0.01) return { ok: false, error: `Weights sum to ${total}; they must sum to 100.` };
	const supabase = await createClient();
	const { data: existing } = await supabase.from('rev_call_rubrics').select('version').eq('key', d.key).maybeSingle();
	const row = { ...d, criteria, updated_by: profile.id, version: ((existing as { version: number } | null)?.version ?? 0) + 1 };
	const { error } = await supabase.from('rev_call_rubrics').upsert(row, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_call_rubrics/${d.key}`, action: 'revenue.rubric.save', diff: { version: row.version, criteria: criteria.length } });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

const DocInput = z.object({ deal_id: uuid, kind: z.enum(['proposal', 'presentation', 'contract', 'brief', 'other']), title: z.string().trim().min(1).max(200), url: optText(1000) });

export async function addDocument(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = DocInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (d.url && !/^https?:\/\//.test(d.url)) return { ok: false, error: 'Link must start with http(s)://' };
	const supabase = await createClient();
	const { data: deal } = await supabase.from('rev_deals').select('brand_id').eq('id', d.deal_id).maybeSingle();
	const { error } = await supabase.from('rev_documents').insert({ deal_id: d.deal_id, brand_id: deal?.brand_id ?? null, kind: d.kind, title: d.title, url: d.url, status: 'draft', created_by: profile.id });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(`/prospects/deals/${d.deal_id}`);
	return { ok: true };
}
