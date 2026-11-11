'use server';

// Flywheel F1 actions (0136): programs, members, clusters, pages, facts,
// citations, videos, deliverables, package templates. RLS is the real guard
// (can_view_flywheel for the team, can_manage_flywheel for settings/deletes);
// the readable refusal comes from the can*() checks here.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { CITATION_STATUSES, CLUSTER_STATUSES, FLYWHEEL_ADMIN_PATH, FLYWHEEL_PATH, MEMBER_ROLES, PAGE_KINDS, PAGE_STATUSES, PLAN_STATUSES, POSTER_KINDS, PROGRAM_STATUSES, VIDEO_STATUSES, addBusinessDays, type AutoApprove, type ChecklistItem } from '@/lib/flywheel/shared';
import { answersToIntake, nextIntakeQuestion, normaliseAnswer, type IntakeQuestion } from '@/lib/flywheel/intake';
import { extractIntake } from '@/lib/flywheel/ai';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optUuid = z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null));
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = z.string().optional().transform((v) => (v && DATE_RE.test(v) ? v : null));
const optCents = z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null));
const lines = (max: number) => z.string().optional().transform((v) => (v ?? '').split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, max));
const flag = z.string().optional().transform((v) => v === 'on' || v === 'true');

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	if (m.includes('fw_programs_one_per_contract')) return 'That contract line already has a program for this package.';
	if (m.includes('fw_clusters_program_id_number_key')) return 'That cluster number is taken.';
	if (m.includes('fw_videos_program_id_month_key')) return 'There is already a recording row for that month.';
	if (m.includes('fw_citations_url_uq')) return 'That URL is already in the ledger for this program.';
	return m.replace(/^flywheel:\s*/, '');
}

async function canManage(): Promise<boolean> {
	const profile = await getAuthProfile();
	if (!profile) return false;
	if (profile.role === 'admin' || profile.role === 'exec') return true;
	return hasCapability('manage_flywheel');
}

function revalidate(programId?: string | null, extra: string[] = []) {
	revalidatePath(FLYWHEEL_PATH);
	revalidatePath(FLYWHEEL_ADMIN_PATH);
	if (programId) revalidatePath(`${FLYWHEEL_PATH}/${programId}`, 'layout');
	for (const p of extra) revalidatePath(p);
}

// ---------------------------------------------------------------- programs

const ProgramInput = z.object({
	id: optUuid,
	client_id: uuid,
	contract_id: optUuid,
	package_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).default('flywheel'),
	label: optText(80),
	status: z.enum(PROGRAM_STATUSES).default('onboarding'),
	is_internal_pilot: flag,
	setup_fee_usd: optCents,
	monthly_fee_usd: optCents,
	setup_paid_on: optDate,
	kickoff_on: optDate,
	first_set_live_on: optDate,
	brand_name: optText(160),
	primary_url: optText(400),
	competitors: lines(10),
	keywords: lines(20),
	icp_md: optText(4000),
	sme_name: optText(120),
	sme_email: optText(160),
	sme_phone: optText(40),
	dev_contact: optText(200),
	access_gbp: flag,
	access_search_console: flag,
	access_analytics: flag,
	access_site_backend: flag,
	access_notes: optText(1000),
	drive_hub_url: optText(400),
	tracker_sheet_url: optText(400),
	auto_plans: flag,
	auto_plans_days: z.coerce.number().int().min(1).max(15).default(3),
	auto_content: flag,
	auto_content_days: z.coerce.number().int().min(1).max(15).default(2),
	notes_md: optText(8000),
	voice_md: optText(8000),
	brand_facts_md: optText(12000),
	cta_md: optText(1000),
});

export async function saveProgram(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ProgramInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const auto_approve: AutoApprove = { plans: { enabled: d.auto_plans, business_days: d.auto_plans_days }, content: { enabled: d.auto_content, business_days: d.auto_content_days } };
	const row = {
		client_id: d.client_id,
		contract_id: d.contract_id,
		package_key: d.package_key,
		label: d.label,
		status: d.status,
		is_internal_pilot: d.is_internal_pilot,
		setup_fee_cents: d.setup_fee_usd,
		monthly_fee_cents: d.monthly_fee_usd,
		setup_paid_on: d.setup_paid_on,
		kickoff_on: d.kickoff_on,
		first_set_live_on: d.first_set_live_on,
		brand_name: d.brand_name,
		primary_url: d.primary_url,
		competitors: d.competitors,
		keywords: d.keywords,
		icp_md: d.icp_md,
		sme_name: d.sme_name,
		sme_email: d.sme_email,
		sme_phone: d.sme_phone,
		dev_contact: d.dev_contact,
		access: { gbp: d.access_gbp, search_console: d.access_search_console, analytics: d.access_analytics, site_backend: d.access_site_backend, notes: d.access_notes ?? undefined },
		drive_hub_url: d.drive_hub_url,
		tracker_sheet_url: d.tracker_sheet_url,
		auto_approve,
		notes_md: d.notes_md,
		voice_md: d.voice_md,
		brand_facts_md: d.brand_facts_md,
		cta_md: d.cta_md,
	};
	if (d.id) {
		const { error } = await supabase.from('fw_programs').update(row).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_programs:${d.id}`, action: 'flywheel.program.update' });
		revalidate(d.id, [`/clients/${d.client_id}/packages`]);
		return { ok: true, id: d.id };
	}
	const { data, error } = await supabase.from('fw_programs').insert({ ...row, created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: friendly(error.message) };
	const id = (data as { id: string }).id;
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_programs:${id}`, action: 'flywheel.program.create', diff: { client_id: d.client_id, package_key: d.package_key } });
	revalidate(id, [`/clients/${d.client_id}/packages`]);
	return { ok: true, id };
}

export async function setProgramStatus(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, status: z.enum(PROGRAM_STATUSES) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const today = new Date().toISOString().slice(0, 10);
	const patch: Record<string, unknown> = { status: p.data.status };
	if (p.data.status === 'paused') patch.paused_on = today;
	if (p.data.status === 'closed') patch.closed_on = today;
	const { error } = await supabase.from('fw_programs').update(patch).eq('id', p.data.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.id);
	return { ok: true };
}

export async function setMember(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, user_id: uuid, role: z.enum(MEMBER_ROLES), remove: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	if (p.data.remove) {
		// Members may remove themselves or (manage) anyone; RLS delete is manage-only, so self-removal uses the manage path.
		if (!(await canManage()) && p.data.user_id !== profile.id) return { ok: false, error: 'Only an admin or a manage_flywheel holder removes other people from a program.' };
		const { error } = await supabase.from('fw_program_members').delete().match({ program_id: p.data.program_id, user_id: p.data.user_id, role: p.data.role });
		if (error) return { ok: false, error: friendly(error.message) };
	} else {
		const { error } = await supabase.from('fw_program_members').upsert({ program_id: p.data.program_id, user_id: p.data.user_id, role: p.data.role, added_by: profile.id }, { onConflict: 'program_id,user_id,role', ignoreDuplicates: true });
		if (error) return { ok: false, error: friendly(error.message) };
	}
	revalidate(p.data.program_id);
	return { ok: true };
}

// ---------------------------------------------------------------- clusters

export async function scaffoldCluster(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, anchor_keyword: optText(200), starts_on: optDate }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('fw_scaffold_cluster', { p_program: p.data.program_id, p_anchor: p.data.anchor_keyword, p_starts_on: p.data.starts_on });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true, id: data as string };
}

const ClusterInput = z.object({
	id: uuid,
	program_id: uuid,
	anchor_keyword: optText(200),
	title: optText(200),
	status: z.enum(CLUSTER_STATUSES).optional(),
	plan_status: z.enum(PLAN_STATUSES).optional(),
	plan_md: optText(60000),
	plan_loom_url: optText(400),
	starts_on: optDate,
	ends_on: optDate,
	reaudit_due_on: optDate,
	notes_md: optText(8000),
});

export async function saveCluster(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ClusterInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = { anchor_keyword: d.anchor_keyword, title: d.title, plan_md: d.plan_md, plan_loom_url: d.plan_loom_url, notes_md: d.notes_md };
	if (d.status) patch.status = d.status;
	if (d.starts_on) patch.starts_on = d.starts_on;
	if (d.ends_on) patch.ends_on = d.ends_on;
	if (d.reaudit_due_on) patch.reaudit_due_on = d.reaudit_due_on;
	if (d.plan_status) {
		patch.plan_status = d.plan_status;
		if (d.plan_status === 'awaiting_client') {
			// Stamp the send + the silent-approval deadline from the program's toggle.
			const { data: prog } = await supabase.from('fw_programs').select('auto_approve').eq('id', d.program_id).maybeSingle();
			const aa = ((prog as { auto_approve?: AutoApprove } | null)?.auto_approve ?? null) as AutoApprove | null;
			patch.plan_sent_at = new Date().toISOString();
			patch.plan_auto_approve_at = aa?.plans?.enabled ? addBusinessDays(new Date(), aa.plans.business_days).toISOString() : null;
		}
		if (d.plan_status === 'approved') patch.plan_approved_by = `internal:${profile.id}`;
	}
	const { error } = await supabase.from('fw_clusters').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(d.program_id);
	return { ok: true };
}

// ---------------------------------------------------------------- pages

const PageInput = z.object({
	id: uuid,
	program_id: uuid,
	kind: z.enum(PAGE_KINDS).optional(),
	keyword: z.string().trim().min(1).max(200).optional(),
	title: optText(240),
	chapter_index: z.coerce.number().int().min(1).max(20).optional(),
	chapter_title: optText(200),
	video_id: optUuid,
	word_target_min: z.coerce.number().int().min(100).max(10000).optional(),
	word_target_max: z.coerce.number().int().min(100).max(10000).optional(),
	status: z.enum(PAGE_STATUSES).optional(),
	body_md: optText(200000),
	quick_answer_md: optText(4000),
	internal_links: lines(10),
	meta_title: optText(200),
	handed_off_to: optText(200),
	live_url: optText(500),
	target_citations: z.coerce.number().int().min(1).max(60).optional(),
	notes_md: optText(8000),
});

export async function savePage(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = PageInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	for (const k of ['kind', 'keyword', 'title', 'chapter_index', 'chapter_title', 'video_id', 'word_target_min', 'word_target_max', 'body_md', 'quick_answer_md', 'meta_title', 'handed_off_to', 'live_url', 'target_citations', 'notes_md'] as const) {
		if (formData.has(k)) patch[k] = d[k] ?? null;
	}
	if (formData.has('internal_links')) patch.internal_links = d.internal_links;
	if (d.status) {
		patch.status = d.status;
		if (d.status === 'awaiting_client') {
			const { data: prog } = await supabase.from('fw_programs').select('auto_approve').eq('id', d.program_id).maybeSingle();
			const aa = ((prog as { auto_approve?: AutoApprove } | null)?.auto_approve ?? null) as AutoApprove | null;
			patch.sent_to_client_at = new Date().toISOString();
			patch.auto_approve_at = aa?.content?.enabled ? addBusinessDays(new Date(), aa.content.business_days).toISOString() : null;
		}
		if (d.status === 'approved') patch.approved_by = `internal:${profile.id}`;
		if (d.status === 'verification') {
			/* nothing: the verifier stamps on the way out */
		}
		if (['awaiting_client', 'approved'].includes(d.status)) {
			const { data: cur } = await supabase.from('fw_pages').select('status, verified_by').eq('id', d.id).maybeSingle();
			const c = cur as { status: string; verified_by: string | null } | null;
			if (c?.status === 'verification' && !c.verified_by) {
				patch.verified_by = profile.id;
				patch.verified_at = new Date().toISOString();
			}
		}
	}
	const { error } = await supabase.from('fw_pages').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(d.program_id, [`${FLYWHEEL_PATH}/${d.program_id}/pages/${d.id}`]);
	return { ok: true };
}

export async function planCitations(formData: FormData): Promise<Result<{ added: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ page_id: uuid, program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('fw_plan_citations', { p_page: p.data.page_id });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id, [`${FLYWHEEL_PATH}/${p.data.program_id}/pages/${p.data.page_id}`]);
	return { ok: true, added: Number(data ?? 0) };
}

// ---------------------------------------------------------------- facts

export async function saveFact(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: optUuid, program_id: uuid, fact: z.string().trim().min(3).max(600).optional(), source_url: optText(500), status: z.enum(['proposed', 'verified', 'retired']).optional(), remove: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	const supabase = await createClient();
	if (d.remove && d.id) {
		if (!(await canManage())) {
			const { error } = await supabase.from('fw_facts').update({ status: 'retired' }).eq('id', d.id);
			if (error) return { ok: false, error: friendly(error.message) };
		} else {
			const { error } = await supabase.from('fw_facts').delete().eq('id', d.id);
			if (error) return { ok: false, error: friendly(error.message) };
		}
	} else if (d.id) {
		const patch: Record<string, unknown> = {};
		if (d.fact) patch.fact = d.fact;
		if (formData.has('source_url')) patch.source_url = d.source_url;
		if (d.status) {
			patch.status = d.status;
			if (d.status === 'verified') {
				patch.verified_by = profile.id;
				patch.verified_at = new Date().toISOString();
			}
		}
		const { error } = await supabase.from('fw_facts').update(patch).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
	} else {
		if (!d.fact) return { ok: false, error: 'Write the fact.' };
		const { error } = await supabase.from('fw_facts').insert({ program_id: d.program_id, fact: d.fact, source_url: d.source_url, status: d.status ?? 'proposed', created_by: profile.id });
		if (error) return { ok: false, error: friendly(error.message) };
	}
	revalidate(d.program_id);
	return { ok: true };
}

// ---------------------------------------------------------------- citations

const CitationInput = z.object({
	id: optUuid,
	program_id: uuid,
	cluster_id: optUuid,
	page_id: optUuid,
	channel_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
	status: z.enum(CITATION_STATUSES).optional(),
	title: optText(300),
	draft_md: optText(60000),
	url: optText(600),
	posted_on: optDate,
	keyword: optText(200),
	fact_id: optUuid,
	models_surfacing: lines(50),
	poster_kind: z.enum(POSTER_KINDS).optional(),
	poster_id: optUuid,
	poster_handle: optText(200),
	notes_md: optText(4000),
	remove: flag,
});

export async function saveCitation(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = CitationInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const back = d.page_id ? [`${FLYWHEEL_PATH}/${d.program_id}/pages/${d.page_id}`] : [];
	if (d.remove && d.id) {
		if (!(await canManage())) {
			const { error } = await supabase.from('fw_citations').update({ status: 'removed' }).eq('id', d.id);
			if (error) return { ok: false, error: friendly(error.message) };
		} else {
			const { error } = await supabase.from('fw_citations').delete().eq('id', d.id);
			if (error) return { ok: false, error: friendly(error.message) };
		}
		revalidate(d.program_id, back);
		return { ok: true, id: d.id };
	}
	const patch: Record<string, unknown> = {};
	for (const k of ['channel_key', 'status', 'title', 'draft_md', 'url', 'posted_on', 'keyword', 'fact_id', 'poster_kind', 'poster_id', 'poster_handle', 'notes_md', 'page_id', 'cluster_id'] as const) {
		if (formData.has(k)) patch[k] = d[k] ?? null;
	}
	if (formData.has('models_surfacing')) patch.models_surfacing = d.models_surfacing;
	if (d.status === 'live' || d.status === 'approved') {
		const { data: cur } = await supabase.from('fw_citations').select('status, verified_by').eq('id', d.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle();
		const c = cur as { status: string; verified_by: string | null } | null;
		if (c?.status === 'verification' && !c.verified_by) {
			patch.verified_by = profile.id;
			patch.verified_at = new Date().toISOString();
		}
	}
	if (d.id) {
		const { error } = await supabase.from('fw_citations').update(patch).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
		revalidate(d.program_id, back);
		return { ok: true, id: d.id };
	}
	if (!d.channel_key) return { ok: false, error: 'Pick a channel.' };
	const { data, error } = await supabase.from('fw_citations').insert({ ...patch, program_id: d.program_id, channel_key: d.channel_key, status: d.status ?? 'planned', created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(d.program_id, back);
	return { ok: true, id: (data as { id: string }).id };
}

// ---------------------------------------------------------------- videos

const VideoInput = z.object({
	id: optUuid,
	program_id: uuid,
	cluster_id: optUuid,
	month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
	title: optText(200),
	status: z.enum(VIDEO_STATUSES).optional(),
	script_md: optText(100000),
	script_status: z.enum(['draft', 'in_review', 'verification', 'approved']).optional(),
	chapters: optText(20000),
	shoot_at: optText(40),
	sme_name: optText(120),
	recording_url: optText(600),
	youtube_url: optText(600),
	transcript_md: optText(400000),
	notes_md: optText(8000),
	check_key: optText(60),
	check_done: flag,
});

export async function saveVideo(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = VideoInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	for (const k of ['cluster_id', 'title', 'status', 'script_md', 'script_status', 'sme_name', 'recording_url', 'youtube_url', 'transcript_md', 'notes_md'] as const) {
		if (formData.has(k)) patch[k] = d[k] ?? null;
	}
	if (formData.has('shoot_at')) patch.shoot_at = d.shoot_at ? new Date(d.shoot_at).toISOString() : null;
	if (formData.has('chapters')) {
		// One chapter per line: "0:00 Title" or just "Title".
		patch.chapters = (d.chapters ?? '')
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean)
			.slice(0, 20)
			.map((l, i) => {
				const m = l.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
				return m ? { index: i + 1, title: m[3].trim(), start_sec: Number(m[1]) * 60 + Number(m[2]) } : { index: i + 1, title: l, start_sec: null };
			});
	}
	if (d.status === 'published') patch.published_at = new Date().toISOString();
	if (d.id) {
		if (d.check_key) {
			const { data: cur } = await supabase.from('fw_videos').select('checklist').eq('id', d.id).maybeSingle();
			const list = ((cur as { checklist?: ChecklistItem[] } | null)?.checklist ?? []) as ChecklistItem[];
			patch.checklist = list.map((it) => (it.key === d.check_key ? { ...it, done: d.check_done, done_at: d.check_done ? new Date().toISOString() : null, by: d.check_done ? profile.id : null } : it));
		}
		const { error } = await supabase.from('fw_videos').update(patch).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
		revalidate(d.program_id, [`${FLYWHEEL_PATH}/${d.program_id}/videos/${d.id}`]);
		return { ok: true, id: d.id };
	}
	if (!d.month) return { ok: false, error: 'Pick the month.' };
	const month = d.month.length === 7 ? `${d.month}-01` : d.month.slice(0, 7) + '-01';
	const { data: setting } = await supabase.from('fw_settings').select('value').eq('key', 'video_checklist').maybeSingle();
	const checklist = (((setting as { value?: ChecklistItem[] } | null)?.value ?? []) as ChecklistItem[]).map((c) => ({ ...c, done: false }));
	const { data, error } = await supabase.from('fw_videos').insert({ ...patch, program_id: d.program_id, month, status: d.status ?? 'planned', checklist, created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(d.program_id);
	return { ok: true, id: (data as { id: string }).id };
}

// ---------------------------------------------------------------- deliverables (manual rows for non-Flywheel packages)

export async function saveDeliverable(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z
		.object({
			id: optUuid,
			client_id: uuid,
			program_id: optUuid,
			package_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
			kind: z.string().trim().min(2).max(40).default('custom'),
			title: z.string().trim().min(2).max(240).optional(),
			status: z.enum(['planned', 'in_progress', 'in_review', 'awaiting_client', 'approved', 'delivered', 'skipped']).optional(),
			due_on: optDate,
			period_month: optDate,
			visible_to_client: flag,
			notes_md: optText(4000),
		})
		.safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = { kind: d.kind, due_on: d.due_on, period_month: d.period_month, notes_md: d.notes_md };
	if (d.title) patch.title = d.title;
	if (d.status) {
		patch.status = d.status;
		if (d.status === 'delivered') patch.delivered_at = new Date().toISOString();
	}
	if (formData.has('visible_to_client')) patch.visible_to_client = d.visible_to_client;
	if (d.id) {
		const { error } = await supabase.from('client_deliverables').update(patch).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
	} else {
		if (!d.title) return { ok: false, error: 'Give it a title.' };
		const { error } = await supabase.from('client_deliverables').insert({ ...patch, client_id: d.client_id, program_id: d.program_id, package_key: d.package_key, status: d.status ?? 'planned', owner_id: profile.id });
		if (error) return { ok: false, error: friendly(error.message) };
	}
	revalidate(d.program_id, [`/clients/${d.client_id}/packages`]);
	return { ok: true };
}

// ---------------------------------------------------------------- settings (manage)

export async function savePackageTemplate(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Package templates need the manage_flywheel capability (admin/exec hold it).' };
	const p = z
		.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), label: z.string().trim().min(2).max(80), description: optText(1000), setup_fee_usd: optCents, monthly_fee_usd: optCents, scope_json: optText(20000), sla_json: optText(2000), is_active: flag })
		.safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	let scope: unknown = undefined;
	let sla: unknown = undefined;
	try {
		if (d.scope_json) scope = JSON.parse(d.scope_json);
		if (d.sla_json) sla = JSON.parse(d.sla_json);
	} catch {
		return { ok: false, error: 'Scope / SLA must be valid JSON.' };
	}
	const supabase = await createClient();
	const row: Record<string, unknown> = { key: d.key, label: d.label, description: d.description, setup_fee_cents: d.setup_fee_usd, monthly_fee_cents: d.monthly_fee_usd, is_active: d.is_active, updated_by: profile.id };
	if (scope !== undefined) row.scope = scope;
	if (sla !== undefined) row.sla = sla;
	const { error } = await supabase.from('fw_package_templates').upsert(row, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_package_templates:${d.key}`, action: 'flywheel.package.save' });
	revalidate();
	return { ok: true };
}

export async function saveChannel(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The channel template needs the manage_flywheel capability.' };
	const p = z
		.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), label: z.string().trim().min(2).max(80), per_page_min: z.coerce.number().int().min(0).max(50), per_page_max: z.coerce.number().int().min(0).max(50), per_cluster: z.coerce.number().int().min(0).max(20), why: optText(300), non_promotional: flag, poster_default: z.enum(POSTER_KINDS).default('person'), is_active: flag })
		.safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const d = p.data;
	if (d.per_page_max < d.per_page_min) return { ok: false, error: 'Max must be at least the min.' };
	const supabase = await createClient();
	const { error } = await supabase.from('fw_channels').upsert({ ...d }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true };
}

export async function saveSetting(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Flywheel settings need the manage_flywheel capability.' };
	const p = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), value_json: z.string().min(1).max(60000) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	let value: unknown;
	try {
		value = JSON.parse(p.data.value_json);
	} catch {
		return { ok: false, error: 'Value must be valid JSON.' };
	}
	const supabase = await createClient();
	const { error } = await supabase.from('fw_settings').upsert({ key: p.data.key, value, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_settings:${p.data.key}`, action: 'flywheel.setting.save' });
	revalidate();
	return { ok: true };
}

// ================================================================ F2: onboarding + intake (0137)

export async function startOnboarding(formData: FormData): Promise<Result<{ project_id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, kickoff_on: optDate }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('fw_start_onboarding', { p_program: p.data.program_id, p_kickoff: p.data.kickoff_on });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_programs:${p.data.program_id}`, action: 'flywheel.onboarding.start' });
	revalidate(p.data.program_id);
	return { ok: true, project_id: data as string };
}

export async function setOnboardingTask(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, task_id: uuid, status: z.enum(['todo', 'in_progress', 'review', 'done', 'blocked', 'cancelled']), assignee_id: optUuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: p.data.status, completed_at: p.data.status === 'done' ? new Date().toISOString() : null };
	if (formData.has('assignee_id')) patch.assignee_id = p.data.assignee_id;
	const { error } = await supabase.from('tasks').update(patch).eq('id', p.data.task_id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true };
}

/** Opens (or reuses) the conversational intake for a program. Internal: by the signed-in user; client: a token for the portal. */
export async function openIntakeSession(formData: FormData): Promise<Result<{ id: string; token?: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, kind: z.enum(['onboarding', 'monthly_angles', 'seed_video']).default('onboarding'), for_client: flag, contact_id: optUuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data: existing } = await supabase.from('fw_intake_sessions').select('id').eq('program_id', p.data.program_id).eq('kind', p.data.kind).eq('status', 'open').eq('opened_by', p.data.for_client ? 'client' : 'internal').order('created_at', { ascending: false }).limit(1).maybeSingle();
	if (existing && !p.data.for_client) {
		revalidate(p.data.program_id);
		return { ok: true, id: (existing as { id: string }).id };
	}
	const { createHash, randomBytes } = await import('node:crypto');
	const token = p.data.for_client ? randomBytes(24).toString('hex') : null;
	const { data, error } = await supabase
		.from('fw_intake_sessions')
		.insert({ program_id: p.data.program_id, kind: p.data.kind, opened_by: p.data.for_client ? 'client' : 'internal', opened_by_id: profile.id, contact_id: p.data.contact_id, token_hash: token ? createHash('sha256').update(token).digest('hex') : null })
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.rpc('fw_log', { p_program: p.data.program_id, p_kind: 'portal', p_summary: `Intake session opened (${p.data.for_client ? 'client link' : 'internal'})`, p_payload: {}, p_client_visible: false, p_actor_label: null });
	revalidate(p.data.program_id);
	return { ok: true, id: (data as { id: string }).id, token: token ?? undefined };
}

/** Internal answer step: validates against the script, appends to the transcript, advances. */
export async function answerIntake(formData: FormData): Promise<Result<{ done: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ session_id: uuid, program_id: uuid, key: z.string().regex(/^[a-z_]{2,40}$/), value: z.string().max(8000).default(''), skip: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const [{ data: s }, { data: setting }] = await Promise.all([supabase.from('fw_intake_sessions').select('answers, transcript, status').eq('id', p.data.session_id).maybeSingle(), supabase.from('fw_settings').select('value').eq('key', 'intake_script').maybeSingle()]);
	const sess = s as { answers: Record<string, unknown>; transcript: unknown[]; status: string } | null;
	if (!sess || sess.status !== 'open') return { ok: false, error: 'This intake is closed.' };
	const script = ((setting as { value?: IntakeQuestion[] } | null)?.value ?? []) as IntakeQuestion[];
	const q = script.find((x) => x.key === p.data.key);
	if (!q) return { ok: false, error: 'Unknown question.' };
	let value: unknown = null;
	if (!p.data.skip) {
		const multi = formData.getAll('value_multi').map(String);
		const n = normaliseAnswer(q, q.type === 'multi' ? multi : p.data.value);
		if (!n.ok) return { ok: false, error: n.error };
		value = n.value;
	} else if (q.required) return { ok: false, error: 'This one is required.' };
	const answers = { ...sess.answers, [p.data.key]: value };
	const transcript = [...(sess.transcript ?? []), { role: 'assistant', text: q.ask, at: new Date().toISOString() }, { role: 'user', text: Array.isArray(value) ? value.join(', ') : String(value ?? '(skipped)'), at: new Date().toISOString() }];
	const next = nextIntakeQuestion(script, answers);
	const { error } = await supabase.from('fw_intake_sessions').update({ answers, transcript, step: script.findIndex((x) => x.key === (next?.key ?? '')) }).eq('id', p.data.session_id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(p.data.program_id);
	return { ok: true, done: next === null };
}

/** Submit + apply an intake session onto the program (internal). */
export async function applyIntakeSession(formData: FormData): Promise<Result<{ facts_added: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ session_id: uuid, program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data: s } = await supabase.from('fw_intake_sessions').select('answers, status').eq('id', p.data.session_id).maybeSingle();
	const sess = s as { answers: Record<string, unknown>; status: string } | null;
	if (!sess) return { ok: false, error: 'Session not found.' };
	if (sess.status === 'applied') return { ok: false, error: 'Already applied.' };
	const { data, error } = await supabase.rpc('fw_apply_intake', { p_program: p.data.program_id, p_data: answersToIntake(sess.answers), p_source: 'session' });
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('fw_intake_sessions').update({ status: 'applied', submitted_at: new Date().toISOString(), applied_at: new Date().toISOString(), applied_by: profile.id }).eq('id', p.data.session_id);
	revalidate(p.data.program_id);
	return { ok: true, facts_added: Number((data as { facts_added?: number } | null)?.facts_added ?? 0) };
}

/** Discovery-call transcript (pasted, or from a Sessions call) → AI extract (draft). */
export async function extractFromTranscript(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ program_id: uuid, call_id: optUuid, transcript: z.string().max(400000).default('') }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	let text = p.data.transcript.trim();
	if (!text && p.data.call_id) {
		const { data: t } = await supabase.from('call_transcripts').select('content').eq('call_id', p.data.call_id).maybeSingle();
		text = ((t as { content?: string } | null)?.content ?? '').trim();
		if (!text) return { ok: false, error: 'That call has no transcript in Sessions yet.' };
	}
	if (text.length < 200) return { ok: false, error: 'Paste the transcript (or notes) — at least a couple of paragraphs.' };
	const { data: prog } = await supabase.from('fw_programs').select('brand_name, primary_url').eq('id', p.data.program_id).maybeSingle();
	const pr = prog as { brand_name: string | null; primary_url: string | null } | null;
	const r = await extractIntake({ transcript: text, brand_hint: pr?.brand_name, url_hint: pr?.primary_url });
	if (!r.ok) return r;
	const { data, error } = await supabase.from('fw_intake_extracts').insert({ program_id: p.data.program_id, source: 'transcript', call_id: p.data.call_id, input_md: text.slice(0, 100000), extract: r.extract, model: r.provider, created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: friendly(error.message) };
	if (p.data.call_id) await supabase.from('fw_programs').update({ discovery_call_id: p.data.call_id }).eq('id', p.data.program_id).is('discovery_call_id', null);
	revalidate(p.data.program_id);
	return { ok: true, id: (data as { id: string }).id };
}

/** Apply (or discard) an extract. The reviewer may edit the JSON first. */
export async function applyExtract(formData: FormData): Promise<Result<{ facts_added: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ extract_id: uuid, program_id: uuid, extract_json: z.string().max(100000).optional(), discard: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	if (p.data.discard) {
		const { error } = await supabase.from('fw_intake_extracts').update({ status: 'discarded' }).eq('id', p.data.extract_id);
		if (error) return { ok: false, error: friendly(error.message) };
		revalidate(p.data.program_id);
		return { ok: true, facts_added: 0 };
	}
	let extract: Record<string, unknown>;
	try {
		if (p.data.extract_json) extract = JSON.parse(p.data.extract_json) as Record<string, unknown>;
		else {
			const { data: e } = await supabase.from('fw_intake_extracts').select('extract').eq('id', p.data.extract_id).maybeSingle();
			extract = ((e as { extract?: Record<string, unknown> } | null)?.extract ?? {}) as Record<string, unknown>;
		}
	} catch {
		return { ok: false, error: 'The extract must be valid JSON.' };
	}
	const { data, error } = await supabase.rpc('fw_apply_intake', { p_program: p.data.program_id, p_data: extract, p_source: 'extract' });
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('fw_intake_extracts').update({ status: 'applied', extract, applied_at: new Date().toISOString(), applied_by: profile.id }).eq('id', p.data.extract_id);
	revalidate(p.data.program_id);
	return { ok: true, facts_added: Number((data as { facts_added?: number } | null)?.facts_added ?? 0) };
}
