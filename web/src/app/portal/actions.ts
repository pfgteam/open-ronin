'use server';

// Client portal writes (F5). Every action resolves the portal session, then
// writes through the SERVICE ROLE scoped to that session's client_id. The
// client's own JWT never touches a table.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getPortalSession, portalLabel, pullGoogleMetrics } from '@/lib/flywheel/portal';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const flag = z.string().optional().transform((v) => v === 'on' || v === 'true');

export async function decideApproval(formData: FormData): Promise<Result> {
	const s = await getPortalSession(String(formData.get('client') ?? '') || null);
	if (!s) return { ok: false, error: 'Please sign in again.' };
	const p = z.object({ approval_id: uuid, decision: z.enum(['approved', 'changes_requested']), comment: optText(4000) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	if (p.data.decision === 'changes_requested' && !p.data.comment) return { ok: false, error: 'Tell us what to change.' };
	const svc = createServiceRoleClient();
	const { data, error } = await svc.from('fw_approvals').update({ status: p.data.decision, decided_by_user: s.user.id, decided_by_label: portalLabel(s), client_comment: p.data.comment }).eq('id', p.data.approval_id).eq('client_id', s.client_id).eq('status', 'pending').select('id');
	if (error) return { ok: false, error: error.message };
	if (!data || data.length === 0) return { ok: false, error: 'That approval is no longer open.' };
	revalidatePath('/portal');
	return { ok: true };
}

export async function setAutoApprove(formData: FormData): Promise<Result> {
	const s = await getPortalSession(String(formData.get('client') ?? '') || null);
	if (!s) return { ok: false, error: 'Please sign in again.' };
	const p = z.object({ program_id: uuid, plans: flag, plans_days: z.coerce.number().int().min(1).max(10).default(3), content: flag, content_days: z.coerce.number().int().min(1).max(10).default(2) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const svc = createServiceRoleClient();
	const { data, error } = await svc.from('fw_programs').update({ auto_approve: { plans: { enabled: p.data.plans, business_days: p.data.plans_days }, content: { enabled: p.data.content, business_days: p.data.content_days } } }).eq('id', p.data.program_id).eq('client_id', s.client_id).select('id');
	if (error) return { ok: false, error: error.message };
	if (!data?.length) return { ok: false, error: 'Program not found.' };
	await svc.rpc('fw_log', { p_program: p.data.program_id, p_kind: 'approval', p_summary: `Auto-approve set by the client: plans ${p.data.plans ? `on (${p.data.plans_days} d)` : 'off'}, content ${p.data.content ? `on (${p.data.content_days} d)` : 'off'}`, p_payload: {}, p_client_visible: true, p_actor_label: portalLabel(s) });
	revalidatePath('/portal');
	return { ok: true };
}

export async function submitNote(formData: FormData): Promise<Result> {
	const s = await getPortalSession(String(formData.get('client') ?? '') || null);
	if (!s) return { ok: false, error: 'Please sign in again.' };
	const p = z
		.object({ kind: z.enum(['request', 'idea', 'brand_story', 'media_contact', 'product_request', 'question', 'news']), title: z.string().trim().min(1).max(240), body_md: optText(8000), program_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), contact_name: optText(120), contact_outlet: optText(160), contact_email: optText(160), product: optText(200), qty: optText(20), address: optText(400), by_date: optText(20) })
		.safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	const meta: Record<string, unknown> = {};
	if (d.kind === 'media_contact') Object.assign(meta, { name: d.contact_name, outlet: d.contact_outlet, email: d.contact_email });
	if (d.kind === 'product_request') Object.assign(meta, { product: d.product, qty: d.qty, address: d.address, by_date: d.by_date });
	const svc = createServiceRoleClient();
	// program_id is client input: it must be one of THIS client's programs, or
	// the note (and the client-visible event + bells below) lands on another client's program.
	if (d.program_id) {
		const { data: own } = await svc.from('fw_programs').select('id').eq('id', d.program_id).eq('client_id', s.client_id).maybeSingle();
		if (!own) return { ok: false, error: 'That program is not yours.' };
	}
	const { error } = await svc.from('fw_portal_notes').insert({ client_id: s.client_id, program_id: d.program_id, kind: d.kind, title: d.title, body_md: d.body_md, meta, created_by_user: s.user.id, created_by_label: portalLabel(s) });
	if (error) return { ok: false, error: error.message };
	if (d.program_id) await svc.rpc('fw_log', { p_program: d.program_id, p_kind: 'portal', p_summary: `Client ${d.kind.replace('_', ' ')}: ${d.title}`, p_payload: {}, p_client_visible: true, p_actor_label: portalLabel(s) });
	// bell the strategist(s)
	const { data: members } = d.program_id ? await svc.from('fw_program_members').select('user_id').eq('program_id', d.program_id).in('role', ['strategist', 'lane_flywheel']) : { data: [] };
	for (const m of (members ?? []) as { user_id: string }[]) {
		await svc.from('notifications').upsert({ user_id: m.user_id, kind: 'flywheel', title: `${s.client_name}: new ${d.kind.replace('_', ' ')}`, body: d.title.slice(0, 200), href: `/flywheel/${d.program_id}?tab=timeline`, dedupe_key: `fw:note:${Date.now()}:${m.user_id}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	}
	revalidatePath('/portal');
	return { ok: true };
}

export async function updateBrandStory(formData: FormData): Promise<Result> {
	const s = await getPortalSession(String(formData.get('client') ?? '') || null);
	if (!s) return { ok: false, error: 'Please sign in again.' };
	const p = z.object({ program_id: uuid, icp_md: optText(4000), angles_md: optText(4000), sme_name: optText(120), sme_email: optText(160) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const svc = createServiceRoleClient();
	const patch: Record<string, unknown> = {};
	if (formData.has('icp_md')) patch.icp_md = p.data.icp_md;
	if (formData.has('angles_md')) patch.angles_md = p.data.angles_md;
	if (formData.has('sme_name')) patch.sme_name = p.data.sme_name;
	if (formData.has('sme_email')) patch.sme_email = p.data.sme_email;
	const { data, error } = await svc.from('fw_programs').update(patch).eq('id', p.data.program_id).eq('client_id', s.client_id).select('id');
	if (error) return { ok: false, error: error.message };
	if (!data?.length) return { ok: false, error: 'Program not found.' };
	await svc.rpc('fw_log', { p_program: p.data.program_id, p_kind: 'portal', p_summary: 'Client updated brand story / SME', p_payload: {}, p_client_visible: true, p_actor_label: portalLabel(s) });
	revalidatePath('/portal');
	return { ok: true };
}

export async function addFact(formData: FormData): Promise<Result> {
	const s = await getPortalSession(String(formData.get('client') ?? '') || null);
	if (!s) return { ok: false, error: 'Please sign in again.' };
	const p = z.object({ program_id: uuid, fact: z.string().trim().min(3).max(600), source_url: optText(500) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Write the fact (3–600 characters).' };
	const svc = createServiceRoleClient();
	const { data: prog } = await svc.from('fw_programs').select('id').eq('id', p.data.program_id).eq('client_id', s.client_id).maybeSingle();
	if (!prog) return { ok: false, error: 'Program not found.' };
	const { error } = await svc.from('fw_facts').insert({ program_id: p.data.program_id, fact: p.data.fact, source_url: p.data.source_url, status: 'proposed' });
	if (error) return { ok: false, error: error.message };
	await svc.rpc('fw_log', { p_program: p.data.program_id, p_kind: 'portal', p_summary: `Client added a fact: ${p.data.fact.slice(0, 120)}`, p_payload: {}, p_client_visible: true, p_actor_label: portalLabel(s) });
	revalidatePath('/portal');
	return { ok: true };
}

export async function selectGoogleAssets(formData: FormData): Promise<Result> {
	const s = await getPortalSession(String(formData.get('client') ?? '') || null);
	if (!s) return { ok: false, error: 'Please sign in again.' };
	const p = z.object({ ga4: optText(100), ga4_name: optText(200), sc: optText(300), gbp: optText(200), gbp_name: optText(200) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const svc = createServiceRoleClient();
	const { error } = await svc.from('fw_google_connections').update({ ga4_property_id: p.data.ga4, ga4_property_name: p.data.ga4_name, sc_site_url: p.data.sc, gbp_location_id: p.data.gbp, gbp_location_name: p.data.gbp_name }).eq('client_id', s.client_id);
	if (error) return { ok: false, error: error.message };
	const r = await pullGoogleMetrics(svc, s.client_id);
	revalidatePath('/portal');
	return r.ok ? { ok: true } : { ok: false, error: `Saved, but the first pull failed: ${r.error}` };
}

