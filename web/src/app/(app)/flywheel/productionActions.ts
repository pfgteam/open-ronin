'use server';

// Flywheel F4 actions (0142): run an agent against a target, draft edits,
// the lane → verification → approve ladder, apply, reject, posting queue,
// agent prompt editing (manage).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { FLYWHEEL_ADMIN_PATH, FLYWHEEL_PATH, OUTPUT_KINDS, type MemberRole } from '@/lib/flywheel/shared';
import { loadMyRoles } from '@/lib/flywheel/server';
import { agentFor, discoverSiteKeywords, humanizeDraft, recheckRules, runAgent, type AgentRow, type DraftRow } from '@/lib/flywheel/production';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const flag = z.string().optional().transform((v) => v === 'on' || v === 'true');
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	return m.replace(/^flywheel:\s*/, '');
}

async function canManage(): Promise<boolean> {
	const profile = await getAuthProfile();
	if (!profile) return false;
	if (profile.role === 'admin' || profile.role === 'exec') return true;
	return hasCapability('manage_flywheel');
}

function revalidate(programId?: string | null, extra: string[] = []) {
	revalidatePath(FLYWHEEL_ADMIN_PATH);
	revalidatePath(`${FLYWHEEL_PATH}/inbox`);
	revalidatePath(`${FLYWHEEL_PATH}/queue`);
	if (programId) revalidatePath(`${FLYWHEEL_PATH}/${programId}`, 'layout');
	for (const p of extra) revalidatePath(p);
}

// ---------------------------------------------------------------- run an agent

export async function runAgentAction(formData: FormData): Promise<Result<{ draft_id: string; rules_ok: boolean | null }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, agent_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), target_id: uuid, notes: optText(2000) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data: a } = await supabase.from('fw_agents').select('*').eq('key', p.data.agent_key).eq('is_active', true).maybeSingle();
	const agent = a as AgentRow | null;
	if (!agent) return { ok: false, error: 'Agent not found or inactive.' };
	const r = await runAgent(supabase, { agent, programId: p.data.program_id, targetId: p.data.target_id, requestedBy: profile.id, notes: p.data.notes, auditDb: createServiceRoleClient() });
	revalidate(p.data.program_id);
	if (!r.ok) return { ok: false, error: r.error };
	return { ok: true, draft_id: r.draft_id, rules_ok: r.rules_ok };
}

/** Run the citation agent for every planned citation of a page (one draft each). */
export async function draftPageCitations(formData: FormData): Promise<Result<{ drafted: number; failed: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, page_id: uuid, limit: z.coerce.number().int().min(1).max(25).default(8) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data: cits } = await supabase.from('fw_citations').select('id, channel_key').eq('page_id', p.data.page_id).eq('status', 'planned').is('draft_md', null).order('channel_key').limit(p.data.limit);
	const out = { drafted: 0, failed: 0 };
	for (const c of (cits ?? []) as { id: string; channel_key: string }[]) {
		const { count } = await supabase.from('fw_drafts').select('id', { count: 'exact', head: true }).eq('target_id', c.id).in('status', ['generating', 'draft', 'in_review', 'verification', 'approved']);
		if ((count ?? 0) > 0) continue;
		// per-program roster → channel variant (copywriter_<channel>) → base copywriter → legacy 'citations'
		const agent = (await agentFor(supabase, p.data.program_id, 'citation', c.channel_key)) ?? ((await supabase.from('fw_agents').select('*').eq('key', 'citations').eq('is_active', true).maybeSingle()).data as AgentRow | null);
		if (!agent) {
			out.failed++;
			continue;
		}
		const r = await runAgent(supabase, { agent, programId: p.data.program_id, targetId: c.id, requestedBy: profile.id, auditDb: createServiceRoleClient() });
		if (r.ok) {
			out.drafted++;
			await supabase.from('fw_citations').update({ status: 'drafting' }).eq('id', c.id).eq('status', 'planned');
		} else out.failed++;
	}
	revalidate(p.data.program_id, [`${FLYWHEEL_PATH}/${p.data.program_id}/pages/${p.data.page_id}`]);
	return { ok: true, ...out };
}

// ---------------------------------------------------------------- draft ladder

const DraftInput = z.object({ draft_id: uuid, program_id: uuid, title: optText(240), content_md: z.string().max(200000).optional(), humanized_md: z.string().max(200000).optional(), structured_json: z.string().max(200000).optional(), review_note: optText(2000), decision: z.enum(['save', 'to_review', 'to_verification', 'approve', 'apply', 'approve_apply', 'changes', 'reject']).default('save') });

export async function reviewDraft(formData: FormData): Promise<Result<{ status: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = DraftInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: cur } = await supabase.from('fw_drafts').select('*').eq('id', d.draft_id).maybeSingle();
	const draft = cur as DraftRow | null;
	if (!draft) return { ok: false, error: 'Draft not found.' };
	const patch: Record<string, unknown> = {};
	if (d.title) patch.title = d.title;
	if (d.content_md != null && formData.has('content_md')) patch.content_md = d.content_md;
	if (formData.has('humanized_md')) patch.humanized_md = d.humanized_md?.trim() ? d.humanized_md : null;
	if (d.structured_json) {
		try {
			patch.structured = JSON.parse(d.structured_json);
		} catch {
			return { ok: false, error: 'Structured output must be valid JSON.' };
		}
	}
	if (d.review_note) patch.review_note = d.review_note;
	// re-check rules after an edit
	if (patch.content_md != null || patch.structured != null) {
		patch.rules_check = await recheckRules(supabase, { ...draft, content_md: (patch.content_md as string | undefined) ?? draft.content_md, structured: (patch.structured as Record<string, unknown> | undefined) ?? draft.structured });
	}
	// The ladder (lane review → verification → approve) was only enforced by
	// which buttons the card rendered; fw_drafts_guard checks the status
	// sequence, not who moves it. Enforce the roles here as well.
	const manage = await canManage();
	const myRoles = manage ? [] : ((await loadMyRoles(supabase, profile.id)).get(draft.program_id) ?? []);
	const isLane = manage || myRoles.includes(draft.lane as MemberRole);
	const isVerifier = manage || myRoles.includes('verifier');
	if ((d.decision === 'changes' || d.decision === 'reject') && !d.review_note) return { ok: false, error: 'Add a review note so the writer knows what to change.' };
	if ((d.decision === 'changes' || d.decision === 'reject') && !isLane && !isVerifier) return { ok: false, error: 'Only the lane reviewer, the verifier or a Flywheel manager can send a draft back.' };
	if (d.decision === 'to_verification' && !isLane) return { ok: false, error: 'Only a member of this draft\'s approval lane (or a Flywheel manager) can pass lane review.' };
	if ((d.decision === 'approve' || d.decision === 'approve_apply') && !isVerifier) {
		// fw_drafts_guard lets the lane approve straight from in_review only when the program has no verifier.
		const { count } = await supabase.from('fw_program_members').select('user_id', { count: 'exact', head: true }).eq('program_id', draft.program_id).eq('role', 'verifier');
		if ((count ?? 0) > 0 || !isLane) return { ok: false, error: 'Only the verifier (or a Flywheel manager) can approve a draft.' };
	}
	const next: Record<typeof d.decision, string | null> = { save: null, to_review: 'in_review', to_verification: 'verification', approve: 'approved', apply: null, approve_apply: 'approved', changes: 'draft', reject: 'rejected' };
	const status = next[d.decision];
	if (status) patch.status = status;
	if (d.decision === 'reject') patch.rejected_reason = d.review_note ?? 'rejected';
	if (Object.keys(patch).length) {
		const { error } = await supabase.from('fw_drafts').update(patch).eq('id', d.draft_id);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	if (d.decision === 'apply' || d.decision === 'approve_apply') {
		const { error } = await supabase.rpc('fw_apply_draft', { p_draft: d.draft_id });
		if (error) return { ok: false, error: friendly(error.message) };
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_drafts:${d.draft_id}`, action: 'flywheel.draft.apply', diff: { kind: draft.kind, target: draft.target_id } });
		revalidate(d.program_id);
		return { ok: true, status: 'applied' };
	}
	revalidate(d.program_id);
	return { ok: true, status: status ?? draft.status };
}

// ---------------------------------------------------------------- posting queue

export async function updateQueueItem(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, program_id: uuid, status: z.enum(['queued', 'claimed', 'posted', 'verified', 'dropped']).optional(), posted_url: optText(600), network_property: optText(200), note: optText(1000), assignee_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), poster_kind: z.enum(['person', 'network', 'fourth_pillar']).optional() }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const d = p.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	if (d.status) patch.status = d.status;
	if (formData.has('posted_url')) patch.posted_url = d.posted_url;
	if (formData.has('network_property')) patch.network_property = d.network_property;
	if (formData.has('note')) patch.note = d.note;
	if (formData.has('assignee_id')) patch.assignee_id = d.assignee_id;
	if (d.poster_kind) patch.poster_kind = d.poster_kind;
	if (d.status === 'posted' && !d.posted_url) {
		const { data: cur } = await supabase.from('fw_posting_queue').select('posted_url').eq('id', d.id).maybeSingle();
		if (!(cur as { posted_url: string | null } | null)?.posted_url) return { ok: false, error: 'Paste the live URL when marking posted (it goes onto the Citation Ledger).' };
	}
	const { error } = await supabase.from('fw_posting_queue').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(d.program_id);
	return { ok: true };
}

// ---------------------------------------------------------------- agents (manage)

export async function saveAgent(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Editing agent prompts needs the manage_flywheel capability (admin/exec hold it).' };
	const p = z
		.object({
			key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
			label: z.string().trim().min(2).max(80).optional(),
			persona: optText(120),
			role_md: optText(400),
			output_kind: z.enum(OUTPUT_KINDS).optional(),
			lane: z.enum(['lane_flywheel', 'lane_writers', 'lane_pubs', 'lane_smm']).optional(),
			system_md: z.string().min(20).max(60000).optional(),
			output_schema_json: optText(10000),
			model: optText(120),
			max_tokens: z.coerce.number().int().min(200).max(16000).optional(),
			is_placeholder: flag,
			is_active: flag,
		})
		.safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	let output_schema: unknown = undefined;
	if (d.output_schema_json !== null && formData.has('output_schema_json')) {
		try {
			output_schema = d.output_schema_json ? JSON.parse(d.output_schema_json) : null;
		} catch {
			return { ok: false, error: 'Output schema must be valid JSON (or blank).' };
		}
	}
	const supabase = await createClient();
	const row: Record<string, unknown> = { key: d.key, updated_by: profile.id };
	if (d.label) row.label = d.label;
	if (formData.has('persona')) row.persona = d.persona;
	if (formData.has('role_md')) row.role_md = d.role_md;
	if (d.output_kind) row.output_kind = d.output_kind;
	if (d.lane) row.lane = d.lane;
	if (d.system_md) row.system_md = d.system_md;
	if (output_schema !== undefined) row.output_schema = output_schema;
	if (formData.has('model')) row.model = d.model;
	if (d.max_tokens) row.max_tokens = d.max_tokens;
	if (formData.has('is_placeholder_present')) row.is_placeholder = d.is_placeholder;
	if (formData.has('is_active_present')) row.is_active = d.is_active;
	const { data: exists } = await supabase.from('fw_agents').select('key').eq('key', d.key).maybeSingle();
	const { error } = exists ? await supabase.from('fw_agents').update(row).eq('key', d.key) : await supabase.from('fw_agents').insert({ ...row, label: d.label ?? d.key, output_kind: d.output_kind ?? 'other', system_md: d.system_md ?? 'PLACEHOLDER' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_agents:${d.key}`, action: 'flywheel.agent.save' });
	revalidate();
	return { ok: true };
}

// ================================================================ F4b (0143): human layer, keyword discovery, roster, studio scheduling

/** Second pass: humanize a draft (voice, specifics, personal detail from the source). Reviewer sees both texts. */
export async function humanizeDraftAction(formData: FormData): Promise<Result<{ changes: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ draft_id: uuid, program_id: uuid, source_context: optText(30000) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data } = await supabase.from('fw_drafts').select('*').eq('id', p.data.draft_id).maybeSingle();
	const draft = data as DraftRow | null;
	if (!draft) return { ok: false, error: 'Draft not found.' };
	if (draft.status === 'applied') return { ok: false, error: 'Already applied; humanize before approval.' };
	const r = await humanizeDraft(supabase, draft, p.data.source_context);
	if (!r.ok) return { ok: false, error: r.error ?? 'Humanize failed.' };
	revalidate(p.data.program_id);
	return { ok: true, changes: r.changes?.length ?? 0 };
}

/** Accept the humanized text as the working copy (or clear it). */
export async function acceptHumanized(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ draft_id: uuid, program_id: uuid, humanized_md: z.string().max(200000).optional(), clear: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const patch = p.data.clear ? { humanized_md: null, humanized_at: null, humanize_notes: null } : { humanized_md: p.data.humanized_md ?? null };
	const { error } = await supabase.from('fw_drafts').update(patch).eq('id', p.data.draft_id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true };
}

/** Crawl the client site → keyword scout draft on the program. */
export async function discoverKeywordsAction(formData: FormData): Promise<Result<{ pages: number; terms: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const r = await discoverSiteKeywords(supabase, p.data.program_id, profile.id);
	revalidate(p.data.program_id);
	if (!r.ok) return { ok: false, error: r.error };
	return { ok: true, pages: r.pages, terms: r.terms };
}

/** Program roster: enable / disable an agent for this client, set the persona the portal shows. */
export async function setProgramAgent(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, agent_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), enabled: flag, show_in_portal: flag, persona_override: optText(120), identity_slug: optText(80) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const row: Record<string, unknown> = { program_id: p.data.program_id, agent_key: p.data.agent_key, assigned_by: profile.id };
	if (formData.has('enabled_present')) row.enabled = p.data.enabled;
	if (formData.has('show_in_portal_present')) row.show_in_portal = p.data.show_in_portal;
	if (formData.has('persona_override')) row.persona_override = p.data.persona_override;
	if (formData.has('identity_slug')) row.identity_slug = p.data.identity_slug;
	const { error } = await supabase.from('fw_program_agents').upsert(row, { onConflict: 'program_id,agent_key' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true };
}

/** Studio: schedule / assign / publish an asset (page, citation, video) from the calendar. */
export async function scheduleAsset(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ kind: z.enum(['page', 'citation', 'video']), id: uuid, program_id: uuid, scheduled_for: optText(40), assignee_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), keyword: optText(200), publish_url: optText(600), mark_published: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const d = p.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	if (formData.has('scheduled_for')) {
		// datetime-local or ISO only; `new Date('10/06 9am')` throws RangeError out of the action.
		if (d.scheduled_for && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(d.scheduled_for) || Number.isNaN(Date.parse(d.scheduled_for)))) return { ok: false, error: 'Pick a date and time from the picker.' };
		patch.scheduled_for = d.scheduled_for ? new Date(d.scheduled_for).toISOString() : null;
	}
	if (formData.has('assignee_id') && d.kind !== 'video') patch.assignee_id = d.assignee_id;
	if (d.keyword && d.kind !== 'video') patch.keyword = d.keyword;
	if (d.mark_published) {
		const now = new Date().toISOString();
		if (d.kind === 'page') {
			if (!d.publish_url) return { ok: false, error: 'Paste the live URL to mark the page live.' };
			Object.assign(patch, { status: 'live', live_url: d.publish_url, live_at: now });
		} else if (d.kind === 'citation') {
			if (!d.publish_url) return { ok: false, error: 'Paste the live URL to mark the citation posted.' };
			Object.assign(patch, { status: 'posted', url: d.publish_url, posted_on: now.slice(0, 10), published_at: now, poster_id: d.assignee_id ?? profile.id });
		} else Object.assign(patch, { status: 'published', published_at: now, youtube_url: d.publish_url ?? undefined });
	}
	const table = d.kind === 'page' ? 'fw_pages' : d.kind === 'citation' ? 'fw_citations' : 'fw_videos';
	const { error } = await supabase.from(table).update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(`${FLYWHEEL_PATH}/studio`);
	revalidate(d.program_id);
	return { ok: true };
}
