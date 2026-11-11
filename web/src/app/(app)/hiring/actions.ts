'use server';

// Hiring module H1 actions (0128): positions (the builder), comp, the
// position request on the staff-request engine, 4R backfill (Drive import
// queue, paste importer, AI drafts, approvals), brand profiles, pay levels.
// RLS is the real guard; the readable refusal comes from can*() checks.

import { getOrgSettings } from '@/lib/tenant/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { pickFourRTemplate, type FourRTemplate } from '@/lib/people/fourR';
import { draftApplicationFromFourR, draftFourRForPerson, draftFourRForPosition, draftInterviewQuestions, formatPostForBoard, prefillScorecard, recentWorkTitles } from '@/lib/hiring/ai';
import { isEmptyConfig, mergeDraftIntoConfig, validateConfig, type ApplicationConfig } from '@/lib/hiring/application';
import { runEnrichment, scoreApplication } from '@/lib/hiring/scoring';
import { CHANNELS, INTERVIEW_KINDS, INTERVIEW_STATUSES, LOCATION_KINDS, evaluateScorecard, scorecardStats, toSmsText, validateStages, type InterviewConfig, type InterviewKind, type MessageVars, type ScorecardAnswers } from '@/lib/hiring/pipeline';
import { draftMessage, messageVars, sendMessage } from '@/lib/hiring/comms';
import { loadDocumentTemplates, loadScorecardQuestions, loadScorecardRules, loadStagesFor, type OfferRow } from '@/lib/hiring/server';
import { PROVISIONING_STATUSES, REGIONS, WORK_MODES, defaultTemplates, offerVars, renderDocument } from '@/lib/hiring/offers';
import { activeSignatureProvider, providerById } from '@/lib/revenue/esign';
import { markdownToHtml } from '@/lib/revenue/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { EMPLOYMENT_TYPES, HIRE_BRANDS, HIRING_ADMIN_PATH, HIRING_PATH, LOCATION_TYPES, POSITION_STATUSES, fourRComplete, parseFourRText, renderPosting, slugify, type BrandProfile, type FourRText } from '@/lib/hiring/shared';
import { POSTING_STATUSES, applyUrl, boardLinkCode, templatePostText, type BoardRow, type PublicPosition } from '@/lib/hiring/careers';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optUuid = z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	if (m.includes('hire_positions_slug_key')) return 'That slug is taken; pick another.';
	return m.replace(/^hiring:\s*/, '');
}

async function canManage(): Promise<boolean> {
	const profile = await getAuthProfile();
	if (!profile) return false;
	if (profile.role === 'admin' || profile.role === 'exec') return true;
	return hasCapability('manage_hiring');
}

async function isPeopleManagerOrAdmin(): Promise<boolean> {
	const profile = await getAuthProfile();
	if (!profile) return false;
	if (profile.role === 'admin' || profile.role === 'exec') return true;
	const supabase = await createClient();
	const { data } = await supabase.from('people_managers').select('user_id').eq('user_id', profile.id).maybeSingle();
	return !!data;
}

function revalidate(positionId?: string | null) {
	revalidatePath(HIRING_PATH);
	revalidatePath(`${HIRING_PATH}/positions`);
	revalidatePath(HIRING_ADMIN_PATH);
	if (positionId) revalidatePath(`${HIRING_PATH}/positions/${positionId}`);
}

// ---------------------------------------------------------------- positions

const PositionInput = z.object({
	id: optUuid,
	brand: z.enum(HIRE_BRANDS).default('main'),
	title: z.string().trim().min(2).max(160),
	slug: z
		.string()
		.trim()
		.max(80)
		.optional()
		.transform((v) => (v ? v : '')),
	department_tag_id: optUuid,
	department_label: optText(80),
	reports_to_label: optText(120),
	pap_position: optText(60),
	position_track: optText(60),
	pay_level: optText(40),
	employment_type: z.enum(EMPLOYMENT_TYPES).default('full_time'),
	location_type: z.enum(LOCATION_TYPES).default('remote'),
	location_text: optText(120),
	timezone_note: optText(160),
	headcount: z.coerce.number().int().min(1).max(50).default(1),
	hiring_manager_id: optUuid,
	recruiter_id: optUuid,
	target_start_on: z.string().optional().transform((v) => (v && DATE_RE.test(v) ? v : null)),
	four_r_template_slug: optText(80),
	role_md: z.string().max(20000).default(''),
	responsibilities_md: z.string().max(20000).default(''),
	results_md: z.string().max(20000).default(''),
	requirements_md: z.string().max(20000).default(''),
	about_us_override_md: optText(8000),
	compensation_statement: optText(600),
	show_pay_range: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	posting_budget_usd: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null)),
	notes_md: optText(8000),
});

/** Create or update a position (the builder). manage_hiring. */
export async function savePosition(formData: FormData): Promise<Result<{ id: string; slug: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The position builder needs the manage_hiring capability (admin/exec hold it).' };
	const parsed = PositionInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const slug = d.slug ? slugify(d.slug) : slugify(d.title);
	const row = {
		brand: d.brand,
		title: d.title,
		slug,
		department_tag_id: d.department_tag_id,
		department_label: d.department_label,
		reports_to_label: d.reports_to_label,
		pap_position: d.pap_position,
		position_track: d.position_track,
		pay_level: d.pay_level,
		employment_type: d.employment_type,
		location_type: d.location_type,
		location_text: d.location_text,
		timezone_note: d.timezone_note,
		headcount: d.headcount,
		hiring_manager_id: d.hiring_manager_id,
		recruiter_id: d.recruiter_id,
		target_start_on: d.target_start_on,
		four_r_template_slug: d.four_r_template_slug,
		role_md: d.role_md,
		responsibilities_md: d.responsibilities_md,
		results_md: d.results_md,
		requirements_md: d.requirements_md,
		about_us_override_md: d.about_us_override_md,
		compensation_statement: d.compensation_statement,
		show_pay_range: d.show_pay_range,
		posting_budget_cents: d.posting_budget_usd,
		notes_md: d.notes_md,
		updated_by: profile.id,
	};
	if (d.id) {
		const { error } = await supabase.from('hire_positions').update(row).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${d.id}`, action: 'hiring.position.update', diff: { title: d.title } });
		revalidate(d.id);
		return { ok: true, id: d.id, slug };
	}
	const { data, error } = await supabase
		.from('hire_positions')
		.insert({ ...row, created_by: profile.id })
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${data.id}`, action: 'hiring.position.create', diff: { title: d.title, brand: d.brand } });
	revalidate(data.id);
	return { ok: true, id: data.id, slug };
}

const CompInput = z.object({
	position_id: uuid,
	pay_multiplier: z.coerce.number().min(1).max(100),
	pay_level: z.string().trim().min(1).max(40),
	step: z.coerce.number().int().min(1).max(6).default(1),
	pay_range_min_usd: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null)),
	pay_range_max_usd: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null)),
	comp_notes_md: optText(4000),
});

/** Set multiplier x level x step; the trigger computes the figures. */
export async function savePositionComp(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Comp needs the manage_hiring capability.' };
	const parsed = CompInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { error } = await supabase.from('hire_position_comp').upsert(
		{ position_id: d.position_id, pay_multiplier: d.pay_multiplier, pay_level: d.pay_level, step: d.step, pay_range_min_cents: d.pay_range_min_usd, pay_range_max_cents: d.pay_range_max_usd, comp_notes_md: d.comp_notes_md, updated_by: profile.id },
		{ onConflict: 'position_id' },
	);
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('hire_positions').update({ pay_level: d.pay_level, updated_by: profile.id }).eq('id', d.position_id);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_position_comp/${d.position_id}`, action: 'hiring.comp.save', diff: { level: d.pay_level, multiplier: d.pay_multiplier, step: d.step } });
	revalidate(d.position_id);
	return { ok: true };
}

/** Manual status moves the guard allows (open / pause / close / fill / reopen). */
export async function setPositionStatus(input: { id: string; status: string; reason?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(POSITION_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: 'Unknown status.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: input.status, updated_by: profile.id };
	if (input.status === 'closed' || input.status === 'filled') patch.close_reason = input.reason?.trim().slice(0, 400) || null;
	const { error } = await supabase.from('hire_positions').update(patch).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.id}`, action: `hiring.position.${input.status}` });
	revalidate(input.id);
	return { ok: true };
}

export async function deleteDraftPosition(input: { id: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('hire_positions').delete({ count: 'exact' }).eq('id', input.id).eq('status', 'draft');
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Only draft positions can be deleted.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.id}`, action: 'hiring.position.delete' });
	revalidate();
	return { ok: true };
}

/** AI-draft the 4R for a position from title + brief (+ template). Returns text; nothing is saved. */
export async function draftPositionFourR(input: { title: string; brand: string; department: string | null; brief: string | null; template_slug: string | null }): Promise<Result<{ draft: FourRText }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The position builder needs manage_hiring.' };
	const supabase = await createClient();
	let template: FourRText | null = null;
	if (input.template_slug) {
		const { data } = await supabase.from('four_r_templates').select('position_label, department, reports_to, role_md, responsibilities_md, results_md, requirements_md').eq('slug', input.template_slug).maybeSingle();
		template = (data as FourRText | null) ?? null;
	}
	const r = await draftFourRForPosition({ title: input.title.slice(0, 160), brand: input.brand, department: input.department, brief: input.brief?.slice(0, 4000) ?? null, template });
	if (!r.ok) return r;
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'hire_positions/draft', action: 'hiring.position.ai_draft', diff: { title: input.title } });
	return { ok: true, draft: r.draft };
}

// ---------------------------------------------------------------- position request

const RequestInput = z.object({
	position_id: optUuid,
	role_title: z.string().trim().min(2).max(160),
	brand: z.enum(HIRE_BRANDS).default('main'),
	department: optText(80),
	employment_type: z.enum(EMPLOYMENT_TYPES).default('full_time'),
	headcount: z.coerce.number().int().min(1).max(50).default(1),
	hiring_manager_id: optUuid,
	target_start_on: z.string().optional().transform((v) => (v && DATE_RE.test(v) ? v : null)),
	pay_level: optText(40),
	pay_multiplier: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? String(Number(v)) : null)),
	posting_budget_usd: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? String(Math.round(Number(v))) : null)),
	body_md: optText(8000),
});

/** File a position request (people managers). Alex approves in the Innovation Desk pipeline; approval creates / approves the position. */
export async function filePositionRequest(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await isPeopleManagerOrAdmin())) return { ok: false, error: 'Only people managers file a position request.' };
	const parsed = RequestInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: group } = await supabase.from('reviewer_groups').select('id').eq('key', 'people_reviewers').maybeSingle();
	if (!group) return { ok: false, error: 'The people_reviewers group is missing (migration 0128 not applied).' };
	const payload = {
		role_title: d.role_title,
		brand: d.brand,
		department: d.department,
		employment_type: d.employment_type,
		headcount: d.headcount,
		hiring_manager_id: d.hiring_manager_id ?? profile.id,
		target_start_on: d.target_start_on,
		pay_level: d.pay_level,
		pay_multiplier: d.pay_multiplier,
		posting_budget_usd: d.posting_budget_usd,
		position_id: d.position_id,
	};
	const { data, error } = await supabase
		.from('staff_requests')
		.insert({ kind: 'position_request', title: `Position: ${d.role_title}`, body_md: d.body_md, payload, requester_id: profile.id, reviewer_group_id: group.id })
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `staff_requests/${data.id}`, action: 'staff_request.create', diff: { kind: 'position_request', title: d.role_title, position_id: d.position_id } });
	revalidate(d.position_id);
	revalidatePath('/the-work/innovation-desk');
	revalidatePath('/admin/innovation-desk');
	return { ok: true, id: data.id };
}

// ---------------------------------------------------------------- 4R backfill

const ImportTextInput = z.object({
	import_id: uuid,
	raw_text: z.string().min(20).max(200_000),
});

/** Paste a Drive 4R doc's text (Docs → File → Download → .txt) onto a queue row; parses into the four sections. */
export async function fetchImportFromText(formData: FormData): Promise<Result<{ parsed: FourRText; complete: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ImportTextInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Paste the document text.' };
	const text = parseFourRText(parsed.data.raw_text);
	const supabase = await createClient();
	const { error } = await supabase
		.from('hire_four_r_imports')
		.update({ raw_text: parsed.data.raw_text, parsed: text as unknown as Record<string, unknown>, status: 'fetched', note: fourRComplete(text) ? null : 'Parsed with empty sections; review before importing.' })
		.eq('id', parsed.data.import_id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true, parsed: text, complete: fourRComplete(text) };
}

const ImportApplyInput = z.object({
	import_id: uuid,
	position_label: z.string().trim().min(1).max(160),
	department: optText(80),
	reports_to: optText(120),
	role_md: z.string().min(1).max(20000),
	responsibilities_md: z.string().min(1).max(20000),
	results_md: z.string().min(1).max(20000),
	requirements_md: z.string().min(1).max(20000),
	target_slug: optText(80),
	match_keywords: optText(400),
});

/** Import a fetched row: a template upsert (four_r_templates) or a person's 4R (profile_four_r, only when they have none). */
export async function applyImport(formData: FormData): Promise<Result<{ target: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await isPeopleManagerOrAdmin())) return { ok: false, error: 'Importing 4Rs needs people-manager or admin.' };
	const parsed = ImportApplyInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'All four sections are required.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: imp } = await supabase.from('hire_four_r_imports').select('*').eq('id', d.import_id).maybeSingle();
	if (!imp) return { ok: false, error: 'Import row not found.' };
	const row = imp as { drive_file_id: string; drive_name: string; target_kind: 'template' | 'person'; target_user_id: string | null; target_slug: string | null; status: string };
	if (row.status === 'imported') return { ok: false, error: 'Already imported.' };
	const url = `https://docs.google.com/document/d/${row.drive_file_id}`;
	let target: string;
	if (row.target_kind === 'template') {
		const slug = slugify(d.target_slug || row.target_slug || d.position_label);
		if (!slug) return { ok: false, error: 'Template slug is required.' };
		const keywords = (d.match_keywords ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
		const { data: existing } = await supabase.from('four_r_templates').select('slug, match_keywords, sort').eq('slug', slug).maybeSingle();
		const ex = existing as { slug: string; match_keywords: string[]; sort: number } | null;
		const { error } = await supabase.from('four_r_templates').upsert(
			{
				slug,
				position_label: d.position_label,
				department: d.department,
				reports_to: d.reports_to,
				role_md: d.role_md,
				responsibilities_md: d.responsibilities_md,
				results_md: d.results_md,
				requirements_md: d.requirements_md,
				match_keywords: keywords.length ? keywords : ex?.match_keywords?.length ? ex.match_keywords : [d.position_label.toLowerCase()],
				source_url: url,
				source_modified_on: null,
				is_active: true,
				sort: ex?.sort ?? 500,
			},
			{ onConflict: 'slug' },
		);
		if (error) return { ok: false, error: friendly(error.message) };
		target = `four_r_templates/${slug}`;
	} else {
		if (!row.target_user_id) return { ok: false, error: 'This doc has no target person.' };
		const { data: has } = await supabase.from('profile_four_r').select('user_id').eq('user_id', row.target_user_id).maybeSingle();
		if (has) return { ok: false, error: 'This person already has a saved 4R; a saved edit wins over an import.' };
		const { error } = await supabase.from('profile_four_r').insert({
			user_id: row.target_user_id,
			position_label: d.position_label,
			department: d.department,
			reports_to: d.reports_to,
			role_md: d.role_md,
			responsibilities_md: d.responsibilities_md,
			results_md: d.results_md,
			requirements_md: d.requirements_md,
			source: 'drive',
			source_url: url,
			created_by: profile.id,
			updated_by: profile.id,
			pending_note: `Imported from Drive: ${row.drive_name}`,
		});
		if (error) return { ok: false, error: friendly(error.message) };
		target = `profile_four_r/${row.target_user_id}`;
	}
	await supabase.from('hire_four_r_imports').update({ status: 'imported', imported_by: profile.id, imported_at: new Date().toISOString(), note: `Imported to ${target}` }).eq('id', d.import_id);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: target, action: 'hiring.four_r.import', diff: { drive: row.drive_file_id } });
	revalidate();
	revalidatePath('/team');
	return { ok: true, target };
}

export async function skipImport(input: { import_id: string; note?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.import_id).success) return { ok: false, error: 'Invalid row.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_four_r_imports').update({ status: 'skipped', note: input.note?.slice(0, 400) ?? 'Skipped' }).eq('id', input.import_id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true };
}

/** AI-draft a 4R for a person with none, into hire_four_r_drafts (pending approval). */
export async function generateFourRDraft(input: { user_id: string }): Promise<Result<{ draft_id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await isPeopleManagerOrAdmin())) return { ok: false, error: 'Drafting 4Rs needs people-manager or admin.' };
	if (!uuid.safeParse(input.user_id).success) return { ok: false, error: 'Invalid person.' };
	const supabase = await createClient();
	const [{ data: person }, { data: templates }] = await Promise.all([
		supabase.from('profiles').select('id, first_name, last_name, job_role, title, pap_position, position_track, department, department_tag_id, manager_id').eq('id', input.user_id).maybeSingle(),
		supabase.from('four_r_templates').select('slug, position_label, department, reports_to, role_md, responsibilities_md, results_md, requirements_md, match_keywords, source_url, sort').eq('is_active', true),
	]);
	if (!person) return { ok: false, error: 'Person not found.' };
	const p = person as { id: string; first_name: string | null; last_name: string | null; job_role: string | null; title: string | null; pap_position: string | null; position_track: string | null; department: string | null; department_tag_id: string | null; manager_id: string | null };
	const [{ data: dept }, { data: mgr }, work] = await Promise.all([
		p.department_tag_id ? supabase.from('tags').select('label').eq('id', p.department_tag_id).maybeSingle() : Promise.resolve({ data: null }),
		p.manager_id ? supabase.from('profiles').select('first_name, last_name, job_role').eq('id', p.manager_id).maybeSingle() : Promise.resolve({ data: null }),
		recentWorkTitles(supabase, p.id),
	]);
	const tpl = pickFourRTemplate({ job_role: p.job_role, pap_position: p.pap_position, position_track: p.position_track, title: p.title, department: p.department }, (templates ?? []) as FourRTemplate[]);
	const mgrRow = mgr as { first_name: string | null; last_name: string | null; job_role: string | null } | null;
	const r = await draftFourRForPerson({
		name: [p.first_name, p.last_name].filter(Boolean).join(' '),
		job_role: p.job_role,
		title: p.title,
		pap_position: p.pap_position,
		position_track: p.position_track,
		department: (dept as { label: string } | null)?.label ?? p.department,
		manager_name: mgrRow ? [mgrRow.first_name, mgrRow.last_name].filter(Boolean).join(' ') + (mgrRow.job_role ? ` (${mgrRow.job_role})` : '') : null,
		template: tpl ? { position_label: tpl.position_label, department: tpl.department, reports_to: tpl.reports_to, role_md: tpl.role_md, responsibilities_md: tpl.responsibilities_md, results_md: tpl.results_md, requirements_md: tpl.requirements_md } : null,
		context: work,
	});
	if (!r.ok) return r;
	const { data, error } = await supabase
		.from('hire_four_r_drafts')
		.insert({ user_id: p.id, source: 'ai', template_slug: tpl?.slug ?? null, draft: r.draft as unknown as Record<string, unknown>, generated_by: profile.id })
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_four_r_drafts/${data.id}`, action: 'hiring.four_r.ai_draft', diff: { user_id: p.id, template: tpl?.slug ?? null } });
	revalidate();
	return { ok: true, draft_id: data.id };
}

const DraftEdit = z.object({
	draft_id: uuid,
	position_label: z.string().trim().min(1).max(160),
	department: optText(80),
	reports_to: optText(120),
	role_md: z.string().max(20000),
	responsibilities_md: z.string().max(20000),
	results_md: z.string().max(20000),
	requirements_md: z.string().max(20000),
	decision: z.enum(['save', 'approve', 'reject']),
	note: optText(400),
});

/** Edit / approve / reject an AI draft. Approve writes profile_four_r through hire_approve_four_r_draft(). */
export async function decideFourRDraft(formData: FormData): Promise<Result<{ written?: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = DraftEdit.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const draft: FourRText = { position_label: d.position_label, department: d.department, reports_to: d.reports_to, role_md: d.role_md, responsibilities_md: d.responsibilities_md, results_md: d.results_md, requirements_md: d.requirements_md };
	const { error: e1 } = await supabase.from('hire_four_r_drafts').update({ draft: draft as unknown as Record<string, unknown>, note: d.note }).eq('id', d.draft_id).eq('status', 'pending');
	if (e1) return { ok: false, error: friendly(e1.message) };
	if (d.decision === 'save') {
		revalidate();
		return { ok: true };
	}
	if (d.decision === 'reject') {
		const { error } = await supabase.from('hire_four_r_drafts').update({ status: 'rejected', decided_by: profile.id, decided_at: new Date().toISOString() }).eq('id', d.draft_id);
		if (error) return { ok: false, error: friendly(error.message) };
		revalidate();
		return { ok: true };
	}
	if (!fourRComplete(draft)) return { ok: false, error: 'All four sections need text before approving.' };
	const { data, error } = await supabase.rpc('hire_approve_four_r_draft', { p_draft_id: d.draft_id });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_four_r_drafts/${d.draft_id}`, action: 'hiring.four_r.approve', diff: data });
	revalidate();
	revalidatePath('/team');
	return { ok: true, written: (data as { written?: boolean } | null)?.written };
}

// ---------------------------------------------------------------- settings

const BrandInput = z.object({
	brand: z.enum(HIRE_BRANDS),
	label: z.string().trim().min(1).max(80),
	website: optText(200),
	about_us_md: z.string().max(8000).default(''),
	remuneration_md: z.string().max(8000).default(''),
	careers_intro_md: z.string().max(4000).default(''),
});

export async function saveBrandProfile(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = BrandInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_brand_profiles').upsert({ ...parsed.data, updated_by: profile.id }, { onConflict: 'brand' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_brand_profiles/${parsed.data.brand}`, action: 'hiring.brand.save' });
	revalidate();
	return { ok: true };
}

const LevelInput = z.object({
	slug: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/),
	label: z.string().trim().min(1).max(60),
	sort: z.coerce.number().int().min(0).max(10000),
	steps: z.coerce.number().int().min(1).max(6),
	base_pct: z.coerce.number().min(0).max(100),
	review_weeks: z.coerce.number().int().min(1).max(104),
	position_track: optText(60),
	is_active: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	notes: optText(400),
});

export async function savePayLevel(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = LevelInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_pay_levels').upsert(parsed.data, { onConflict: 'slug' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_pay_levels/${parsed.data.slug}`, action: 'hiring.pay_level.save' });
	revalidate();
	return { ok: true };
}

const ProgressionInput = z.object({
	start_per_multiplier: z.coerce.number().min(1).max(10000),
	first_step_factor: z.coerce.number().min(1).max(2),
	step_factor: z.coerce.number().min(1).max(2),
	target_over_base: z.coerce.number().min(1).max(3),
	multiplier_min: z.coerce.number().min(1).max(100),
	multiplier_max: z.coerce.number().min(1).max(100),
});

export async function saveProgression(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ProgressionInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_settings').upsert({ key: 'pay_progression', value: { ...parsed.data, source: 'edited in Admin → Hiring' }, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'hire_settings/pay_progression', action: 'hiring.progression.save', diff: parsed.data });
	revalidate();
	return { ok: true };
}

const ConsentInput = z.object({ title: z.string().trim().min(1).max(160), body_md: z.string().trim().min(20).max(20000) });

export async function saveConsent(formData: FormData): Promise<Result<{ version: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ConsentInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { data: cur } = await supabase.from('hire_settings').select('value').eq('key', 'consent').maybeSingle();
	const version = Number((cur as { value?: { version?: number } } | null)?.value?.version ?? 0) + 1;
	const { error } = await supabase.from('hire_settings').upsert({ key: 'consent', value: { version, ...parsed.data }, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'hire_settings/consent', action: 'hiring.consent.save', diff: { version } });
	revalidate();
	return { ok: true, version };
}


// ---------------------------------------------------------------- post kit (0129)

async function canEditPostKit(positionId: string): Promise<boolean> {
	if (await canManage()) return true;
	const profile = await getAuthProfile();
	if (!profile) return false;
	const supabase = await createClient();
	const { data } = await supabase.from('hire_positions').select('hiring_manager_id, recruiter_id').eq('id', positionId).maybeSingle();
	const p = data as { hiring_manager_id: string | null; recruiter_id: string | null } | null;
	return !!p && (p.hiring_manager_id === profile.id || p.recruiter_id === profile.id);
}

/** Tracked apply link for a board (deterministic code; idempotent). */
async function ensureBoardLink(positionId: string, slug: string, boardKey: string, userId: string): Promise<string> {
	const supabase = await createClient();
	const { data: existing } = await supabase.from('hire_links').select('code').eq('position_id', positionId).eq('board_key', boardKey).is('referrer_user_id', null).maybeSingle();
	if (existing) return (existing as { code: string }).code;
	const code = boardLinkCode(slug, boardKey);
	const { error } = await supabase.from('hire_links').insert({ code, position_id: positionId, source: boardKey, board_key: boardKey, label: `Apply link · ${boardKey}`, created_by: userId });
	if (error && !error.message.includes('duplicate')) throw new Error(friendly(error.message));
	return code;
}

/** Build (or rebuild) the post kit for the boards picked: a tracked link + formatted text per board. */
export async function buildPostKit(input: { position_id: string; boards: string[]; use_ai: boolean }): Promise<Result<{ built: number; by: string[] }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	if (!(await canEditPostKit(input.position_id))) return { ok: false, error: 'Only the hiring manager, the recruiter or manage_hiring holders build the post kit.' };
	const supabase = await createClient();
	const [{ data: pos }, { data: boards }, { data: brands }, { data: comp }] = await Promise.all([
		supabase.from('hire_positions').select('*').eq('id', input.position_id).maybeSingle(),
		supabase.from('hire_boards').select('*').in('key', input.boards.slice(0, 20)).eq('enabled', true),
		supabase.from('hire_brand_profiles').select('*'),
		supabase.from('hire_position_comp').select('pay_range_min_cents, pay_range_max_cents').eq('position_id', input.position_id).maybeSingle(),
	]);
	if (!pos) return { ok: false, error: 'Position not found.' };
	const p = pos as Record<string, unknown>;
	if (!['approved', 'open', 'paused'].includes(String(p.status))) return { ok: false, error: 'Build the post kit once the position is approved (Alex) — posting is the first budget step.' };
	const pub: PublicPosition = {
		id: p.id as string,
		slug: p.slug as string,
		title: p.title as string,
		brand: p.brand as PublicPosition['brand'],
		department_label: (p.department_label as string | null) ?? null,
		employment_type: p.employment_type as PublicPosition['employment_type'],
		location_type: p.location_type as PublicPosition['location_type'],
		location_text: (p.location_text as string | null) ?? null,
		timezone_note: (p.timezone_note as string | null) ?? null,
		compensation_statement: (p.compensation_statement as string | null) ?? null,
		show_pay_range: !!p.show_pay_range,
		about_us_override_md: (p.about_us_override_md as string | null) ?? null,
		opened_at: (p.opened_at as string | null) ?? null,
		updated_at: p.updated_at as string,
		position_label: p.title as string,
		department: (p.department_label as string | null) ?? null,
		reports_to: (p.reports_to_label as string | null) ?? null,
		role_md: (p.role_md as string) ?? '',
		responsibilities_md: (p.responsibilities_md as string) ?? '',
		results_md: (p.results_md as string) ?? '',
		requirements_md: (p.requirements_md as string) ?? '',
		pay_range_min_cents: (comp as { pay_range_min_cents: number | null } | null)?.pay_range_min_cents ?? null,
		pay_range_max_cents: (comp as { pay_range_max_cents: number | null } | null)?.pay_range_max_cents ?? null,
	};
	const brand = ((brands ?? []) as BrandProfile[]).find((b) => b.brand === pub.brand) ?? null;
	const postingMd = renderPosting({ title: pub.title, compensation_statement: pub.compensation_statement, about_us_override_md: pub.about_us_override_md, role_md: pub.role_md, responsibilities_md: pub.responsibilities_md, results_md: pub.results_md, requirements_md: pub.requirements_md }, brand);
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const by: string[] = [];
	let built = 0;
	for (const board of (boards ?? []) as BoardRow[]) {
		const code = await ensureBoardLink(pub.id, pub.slug, board.key, profile.id);
		const link = applyUrl(appUrl, pub.slug, code);
		let text: string | null = null;
		let formattedBy: string | null = null;
		if (board.kind === 'manual') {
			const template = templatePostText(pub, brand, board, link);
			const r = input.use_ai ? await formatPostForBoard({ posting_md: postingMd, board_label: board.label, format_hint: board.format_hint, max_chars: board.max_chars, apply_link: link, template_text: template }) : { text: template, by: 'template' };
			text = r.text;
			formattedBy = r.by;
			by.push(`${board.key}: ${r.by}`);
		}
		const { data: existing } = await supabase.from('hire_postings').select('id, status').eq('position_id', pub.id).eq('board_key', board.key).maybeSingle();
		const ex = existing as { id: string; status: string } | null;
		if (ex) {
			await supabase.from('hire_postings').update({ formatted_text: text, formatted_by: formattedBy, updated_by: profile.id }).eq('id', ex.id);
		} else {
			// Auto boards are live the moment the role is open; manual ones are planned.
			const status = board.kind === 'auto' && String(p.status) === 'open' ? 'live' : 'planned';
			await supabase.from('hire_postings').insert({ position_id: pub.id, board_key: board.key, status, formatted_text: text, formatted_by: formattedBy, live_url: board.key === 'careers' ? `${appUrl}/careers/${pub.slug}` : board.key === 'xml_feed' ? `${appUrl}/careers/feed.xml` : null, created_by: profile.id });
		}
		built++;
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${pub.id}`, action: 'hiring.postkit.build', diff: { boards: input.boards, ai: input.use_ai } });
	revalidate(pub.id);
	return { ok: true, built, by };
}

const PostingUpdate = z.object({
	id: uuid,
	position_id: uuid,
	status: z.enum(POSTING_STATUSES).optional(),
	live_url: optText(1000),
	external_id: optText(120),
	cost_usd: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null)),
	notes: optText(2000),
	formatted_text: z.string().max(20000).optional(),
});

/** Post-kit checklist: mark posted / live / closed, record the live URL and cost, edit the text. */
export async function updatePosting(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = PostingUpdate.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (!(await canEditPostKit(d.position_id))) return { ok: false, error: 'Only the hiring manager, the recruiter or manage_hiring holders edit the post kit.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { updated_by: profile.id };
	if (d.status) patch.status = d.status;
	if (formData.has('live_url')) patch.live_url = d.live_url;
	if (formData.has('external_id')) patch.external_id = d.external_id;
	if (formData.has('cost_usd')) patch.cost_cents = d.cost_usd;
	if (formData.has('notes')) patch.notes = d.notes;
	if (d.formatted_text !== undefined) {
		patch.formatted_text = d.formatted_text;
		patch.formatted_by = 'manual';
	}
	const { error } = await supabase.from('hire_postings').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_postings/${d.id}`, action: 'hiring.posting.update', diff: { status: d.status ?? null } });
	revalidate(d.position_id);
	return { ok: true };
}

/** My referral link for a role (any staff member). */
export async function myReferralLink(input: { position_id: string }): Promise<Result<{ code: string; url: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('hire_referral_link', { p_position_id: input.position_id });
	if (error) return { ok: false, error: friendly(error.message) };
	const code = String(data);
	return { ok: true, code, url: applyUrl(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com', '', code) };
}

const CustomLink = z.object({ position_id: uuid, code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{3,40}$/, 'Code: 4-41 chars, a-z 0-9 and dashes'), source: z.string().trim().min(1).max(40), label: optText(120) });

export async function addCustomLink(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = CustomLink.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (!(await canEditPostKit(d.position_id))) return { ok: false, error: 'Only the hiring manager, the recruiter or manage_hiring holders add links.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_links').insert({ code: d.code, position_id: d.position_id, source: d.source, label: d.label, created_by: profile.id });
	if (error) return { ok: false, error: error.message.includes('duplicate') ? 'That code is taken.' : friendly(error.message) };
	revalidate(d.position_id);
	return { ok: true };
}

const BoardInput = z.object({
	key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/),
	label: z.string().trim().min(1).max(80),
	kind: z.enum(['auto', 'manual', 'adapter']),
	enabled: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	sort: z.coerce.number().int().min(0).max(10000),
	post_url: optText(500),
	format_hint: optText(1000),
	max_chars: z.string().optional().transform((v) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null)),
	cost_note: optText(200),
	default_days: z.coerce.number().int().min(1).max(365).default(30),
	regions: optText(200),
});

export async function saveBoard(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Boards need manage_hiring.' };
	const parsed = BoardInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (/zip\s*recruiter/i.test(d.label) || d.key.includes('zip')) return { ok: false, error: 'ZipRecruiter is out of scope (Alex, round 3).' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_boards').upsert({ ...d, regions: (d.regions ?? '').split(',').map((s) => s.trim()).filter(Boolean), updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_boards/${d.key}`, action: 'hiring.board.save', diff: { enabled: d.enabled, kind: d.kind } });
	revalidate();
	return { ok: true };
}

const CareersInput = z.object({ headline: z.string().trim().min(1).max(160), intro_md: z.string().trim().max(4000).default(''), target_url: optText(300), show_closed_roles: z.string().optional().transform((v) => v === 'on' || v === 'true') });

export async function saveCareersSettings(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Careers settings need manage_hiring.' };
	const parsed = CareersInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { data: cur } = await supabase.from('hire_settings').select('value').eq('key', 'careers').maybeSingle();
	const value = { ...(((cur as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>), ...parsed.data };
	const { error } = await supabase.from('hire_settings').upsert({ key: 'careers', value, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	revalidatePath('/careers');
	return { ok: true };
}

const ReferralBonusInput = z.object({ enabled: z.string().optional().transform((v) => v === 'on' || v === 'true'), amount_usd: z.coerce.number().min(0).max(100000).default(0), paid_after_days: z.coerce.number().int().min(0).max(365).default(90), note: optText(400) });

export async function saveReferralBonus(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Referral bonus needs manage_hiring.' };
	const parsed = ReferralBonusInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { error } = await supabase.from('hire_settings').upsert({ key: 'referral_bonus', value: { enabled: d.enabled, amount_cents: Math.round(d.amount_usd * 100), paid_after_days: d.paid_after_days, note: d.note }, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'hire_settings/referral_bonus', action: 'hiring.referral_bonus.save', diff: { enabled: d.enabled, amount_usd: d.amount_usd } });
	revalidate();
	return { ok: true };
}


// ---------------------------------------------------------------- application builder + review (0130)

const ConfigInput = z.object({ position_id: uuid, config_json: z.string().min(2).max(200_000) });

/** Save a role's application config (validated client-side mirror + SQL CHECK). */
export async function saveApplicationConfig(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The application builder needs manage_hiring.' };
	const parsed = ConfigInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	let cfg: unknown;
	try {
		cfg = JSON.parse(parsed.data.config_json);
	} catch {
		return { ok: false, error: 'Config is not valid JSON.' };
	}
	const problem = validateConfig(cfg);
	if (problem) return { ok: false, error: problem };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_positions').update({ application_config: cfg as Record<string, unknown>, updated_by: profile.id }).eq('id', parsed.data.position_id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${parsed.data.position_id}`, action: 'hiring.application_config.save', diff: { sections: (cfg as ApplicationConfig).sections.length } });
	revalidate(parsed.data.position_id);
	return { ok: true };
}

/** Start a role's application from the default config (no AI). */
export async function resetApplicationToDefault(input: { position_id: string }): Promise<Result<{ config: ApplicationConfig }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The application builder needs manage_hiring.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const { data } = await supabase.from('hire_settings').select('value').eq('key', 'application_default').maybeSingle();
	const cfg = (data as { value: ApplicationConfig } | null)?.value;
	if (!cfg) return { ok: false, error: 'Default application missing (migration 0130).' };
	return { ok: true, config: cfg };
}

/** AI-draft role-specific screening, skills + honeypots, challenges and scoring from the 4R, merged onto the default. Returns the config; nothing saved. */
export async function draftApplicationConfig(input: { position_id: string }): Promise<Result<{ config: ApplicationConfig; summary: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'The application builder needs manage_hiring.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const [{ data: pos }, { data: def }] = await Promise.all([
		supabase.from('hire_positions').select('title, brand, department_label, reports_to_label, role_md, responsibilities_md, results_md, requirements_md, application_config').eq('id', input.position_id).maybeSingle(),
		supabase.from('hire_settings').select('value').eq('key', 'application_default').maybeSingle(),
	]);
	if (!pos) return { ok: false, error: 'Position not found.' };
	const p = pos as { title: string; brand: string; department_label: string | null; reports_to_label: string | null; role_md: string; responsibilities_md: string; results_md: string; requirements_md: string; application_config: ApplicationConfig };
	if (!fourRComplete(p)) return { ok: false, error: 'Finish the 4R first; the application is drafted from it.' };
	const base = !isEmptyConfig(p.application_config) ? p.application_config : ((def as { value: ApplicationConfig } | null)?.value ?? { version: 2, sections: [] });
	const r = await draftApplicationFromFourR({ title: p.title, brand: p.brand, position_label: p.title, department: p.department_label, reports_to: p.reports_to_label, role_md: p.role_md, responsibilities_md: p.responsibilities_md, results_md: p.results_md, requirements_md: p.requirements_md });
	if (!r.ok) return r;
	const merged = mergeDraftIntoConfig(base, r.draft);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.position_id}`, action: 'hiring.application_config.ai_draft', diff: { skills: r.draft.skills.length, honeypots: r.draft.honeypots.length, challenges: r.draft.challenges.length } });
	return { ok: true, config: merged, summary: `${r.draft.screening.length} screening · ${r.draft.skills.length} skills + ${r.draft.honeypots.length} honeypots · ${r.draft.challenges.length} challenges · ${r.draft.scoring.length} scoring categories` };
}

const APP_STATUSES = ['new', 'screening', 'culture_fit', 'job_fit', 'final', 'offer', 'hired', 'rejected', 'withdrawn', 'pool'] as const;
const ReviewInput = z.object({
	id: uuid,
	position_id: uuid,
	status: z.enum(APP_STATUSES).optional(),
	starred: z.enum(['true', 'false']).optional(),
	hidden: z.enum(['true', 'false']).optional(),
	reviewer_notes_md: z.string().max(8000).optional(),
	rejected_reason: optText(400),
});

/** Review actions on one application: status, star, hide, notes, reject reason. */
export async function reviewApplication(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ReviewInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
	if (d.status) {
		patch.status = d.status;
		if (['rejected', 'hired', 'withdrawn', 'pool'].includes(d.status)) {
			patch.decided_by = profile.id;
			patch.decided_at = new Date().toISOString();
		}
		if (d.status === 'rejected' && formData.has('rejected_reason')) patch.rejected_reason = d.rejected_reason;
	}
	if (d.starred) patch.starred = d.starred === 'true';
	if (d.hidden) patch.hidden = d.hidden === 'true';
	if (d.reviewer_notes_md !== undefined) patch.reviewer_notes_md = d.reviewer_notes_md;
	const { error } = await supabase.from('hire_applications').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (d.status === 'pool') {
		const { data: app } = await supabase.from('hire_applications').select('candidate_id, position:hire_positions!hire_applications_position_id_fkey(department_label, title)').eq('id', d.id).maybeSingle();
		const a = app as unknown as { candidate_id: string; position: { department_label: string | null; title: string } | null } | null;
		if (a) {
			const { data: cand } = await supabase.from('hire_candidates').select('pool_tags').eq('id', a.candidate_id).maybeSingle();
			const tags = new Set<string>(((cand as { pool_tags: string[] } | null)?.pool_tags ?? []).concat([a.position?.department_label ?? '', a.position?.title ?? ''].filter(Boolean)));
			await supabase.from('hire_candidates').update({ talent_pool: true, pool_tags: [...tags] }).eq('id', a.candidate_id);
		}
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_applications/${d.id}`, action: 'hiring.application.review', diff: { status: d.status ?? null, starred: d.starred ?? null, hidden: d.hidden ?? null } });
	revalidate(d.position_id);
	revalidatePath(`/hiring/positions/${d.position_id}/applications`);
	revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.id}`);
	return { ok: true };
}

/** Bulk status move. */
export async function bulkReview(input: { position_id: string; ids: string[]; status: (typeof APP_STATUSES)[number] }): Promise<Result<{ updated: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success || !input.ids.every((i) => uuid.safeParse(i).success)) return { ok: false, error: 'Invalid input.' };
	if (!APP_STATUSES.includes(input.status)) return { ok: false, error: 'Unknown status.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: input.status, last_activity_at: new Date().toISOString() };
	if (['rejected', 'hired', 'withdrawn', 'pool'].includes(input.status)) {
		patch.decided_by = profile.id;
		patch.decided_at = new Date().toISOString();
	}
	const { data, error } = await supabase.from('hire_applications').update(patch).in('id', input.ids.slice(0, 200)).eq('position_id', input.position_id).select('id');
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.position_id}`, action: 'hiring.application.bulk', diff: { status: input.status, n: (data ?? []).length } });
	revalidatePath(`/hiring/positions/${input.position_id}/applications`);
	return { ok: true, updated: (data ?? []).length };
}

/** Signed URL (10 min) for a candidate file in the private bucket. Hiring circle only (RLS on the files table proves access). */
export async function signedFileUrl(input: { path: string }): Promise<Result<{ url: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!/^(sessions|applications)\/[A-Za-z0-9_\-/.]+$/.test(input.path)) return { ok: false, error: 'Invalid path.' };
	const supabase = await createClient();
	const { data: visible } = await supabase.from('hire_application_files').select('id').eq('path', input.path).maybeSingle();
	if (!visible) return { ok: false, error: 'Not allowed.' };
	const svc = createServiceRoleClient();
	const { data, error } = await svc.storage.from('hiring-uploads').createSignedUrl(input.path, 600);
	if (error || !data) return { ok: false, error: error?.message ?? 'Could not sign.' };
	return { ok: true, url: data.signedUrl };
}

/** CSV export of a role's applications (visible rows only). */
export async function exportApplicationsCsv(input: { position_id: string }): Promise<Result<{ csv: string; filename: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const { data: pos } = await supabase.from('hire_positions').select('slug').eq('id', input.position_id).maybeSingle();
	const { data } = await supabase.from('hire_applications').select('submitted_at, status, source, overall_score, merit_score, integrity_score, honeypot_hits, restarts, paste_events, blocked_paste_attempts, ai_text_flags, total_time_s, top_strength, biggest_concern, summary_line, candidate:hire_candidates!hire_applications_candidate_id_fkey(full_name, email, phone, location_text, linkedin_url)').eq('position_id', input.position_id).eq('hidden', false).order('submitted_at', { ascending: false });
	const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
	const head = ['submitted_at', 'status', 'name', 'email', 'phone', 'location', 'linkedin', 'source', 'overall', 'merit', 'integrity', 'honeypot_hits', 'restarts', 'paste_events', 'blocked_pastes', 'ai_text_flags', 'time_s', 'top_strength', 'biggest_concern', 'summary'];
	const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
		const c = (r.candidate ?? {}) as Record<string, unknown>;
		return [r.submitted_at, r.status, c.full_name, c.email, c.phone, c.location_text, c.linkedin_url, r.source, r.overall_score, r.merit_score, r.integrity_score, r.honeypot_hits, r.restarts, r.paste_events, r.blocked_paste_attempts, r.ai_text_flags, r.total_time_s, r.top_strength, r.biggest_concern, r.summary_line].map(esc).join(',');
	});
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.position_id}`, action: 'hiring.application.export', diff: { rows: rows.length } });
	return { ok: true, csv: [head.join(','), ...rows].join('\n'), filename: `applications-${(pos as { slug: string } | null)?.slug ?? input.position_id}.csv` };
}


// ---------------------------------------------------------------- scoring + enrichment (0131)

/** Score (or rescore) one application now. */
export async function scoreNow(input: { id: string; position_id: string }): Promise<Result<{ overall: number; merit: number; integrity: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid application.' };
	const supabase = await createClient();
	const { data: visible } = await supabase.from('hire_applications').select('id').eq('id', input.id).maybeSingle();
	if (!visible) return { ok: false, error: 'Not allowed.' };
	const r = await scoreApplication(createServiceRoleClient(), input.id, profile.id);
	if (!r.ok) return r;
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_applications/${input.id}`, action: 'hiring.application.score', diff: { overall: r.result.overall, merit: r.result.merit, integrity: r.result.integrity } });
	await createServiceRoleClient().rpc('hire_shortlist', { p_position_id: input.position_id });
	revalidatePath(`/hiring/positions/${input.position_id}/applications`);
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.id}`);
	return { ok: true, overall: r.result.overall, merit: r.result.merit, integrity: r.result.integrity };
}

/** Score every unscored (or all, with rescore) visible application of a role. */
export async function scoreRole(input: { position_id: string; rescore?: boolean }): Promise<Result<{ scored: number; errors: string[] }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	let q = supabase.from('hire_applications').select('id').eq('position_id', input.position_id).eq('hidden', false).not('status', 'in', '(rejected,withdrawn)').order('submitted_at').limit(40);
	if (!input.rescore) q = q.is('scored_at', null);
	const { data } = await q;
	const svc = createServiceRoleClient();
	const errors: string[] = [];
	let scored = 0;
	for (const a of (data ?? []) as { id: string }[]) {
		const r = await scoreApplication(svc, a.id, profile.id);
		if (r.ok) scored++;
		else errors.push(r.error);
		if (errors.length >= 3 && scored === 0) break;
	}
	await svc.rpc('hire_shortlist', { p_position_id: input.position_id });
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.position_id}`, action: 'hiring.application.score_role', diff: { scored, rescore: !!input.rescore } });
	revalidatePath(`/hiring/positions/${input.position_id}/applications`);
	return { ok: true, scored, errors: [...new Set(errors)].slice(0, 3) };
}

/** Run the enrichment queue for one application right now (links, resume, video, LinkedIn if on). */
export async function enrichNow(input: { id: string; position_id: string }): Promise<Result<{ done: number; skipped: number; failed: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid application.' };
	const supabase = await createClient();
	const { data: visible } = await supabase.from('hire_applications').select('id').eq('id', input.id).maybeSingle();
	if (!visible) return { ok: false, error: 'Not allowed.' };
	const svc = createServiceRoleClient();
	await svc.rpc('hire_enqueue_enrichment', { p_application_id: input.id });
	await svc.from('hire_enrichment_jobs').update({ status: 'pending', attempts: 0, error: null }).eq('application_id', input.id).in('status', ['failed', 'skipped']);
	// only this application's jobs: temporarily the queue is small; run a generous batch and count ours
	const before = await svc.from('hire_enrichment_jobs').select('id', { count: 'exact', head: true }).eq('application_id', input.id).in('status', ['pending', 'running']);
	const r = await runEnrichment(svc, Math.max(8, before.count ?? 0));
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.id}`);
	return { ok: true, done: r.done, skipped: r.skipped, failed: r.failed };
}

export async function refreshShortlist(input: { position_id: string }): Promise<Result<{ ranked: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('hire_shortlist', { p_position_id: input.position_id });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(`/hiring/positions/${input.position_id}/applications`);
	return { ok: true, ranked: Number(data ?? 0) };
}

const ScoringSettingsInput = z.object({
	auto_score_on_submit: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	merit_weight: z.coerce.number().int().min(0).max(100),
	integrity_weight: z.coerce.number().int().min(0).max(100),
	honeypot_hit: z.coerce.number().min(0).max(100),
	restart: z.coerce.number().min(0).max(100),
	blocked_paste: z.coerce.number().min(0).max(100),
	pasted_chars_per_500: z.coerce.number().min(0).max(100),
	ai_text_flag: z.coerce.number().min(0).max(100),
	claim_mismatch: z.coerce.number().min(0).max(100),
	shortlist_size: z.coerce.number().int().min(1).max(100),
	links: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	resume: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	video: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	linkedin: z.string().optional().transform((v) => v === 'on' || v === 'true'),
	linkedin_actor: z.string().trim().max(120).default('apimaestro/linkedin-profile-detail'),
});

export async function saveScoringSettings(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Scoring settings need manage_hiring.' };
	const parsed = ScoringSettingsInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (d.merit_weight + d.integrity_weight === 0) return { ok: false, error: 'Weights cannot both be 0.' };
	if (d.linkedin && !process.env.APIFY_TOKEN) return { ok: false, error: 'LinkedIn enrichment needs APIFY_TOKEN in Vercel first.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_settings').upsert(
		[
			{ key: 'scoring', value: { auto_score_on_submit: d.auto_score_on_submit, merit_weight: d.merit_weight, integrity_weight: d.integrity_weight, integrity_penalties: { honeypot_hit: d.honeypot_hit, restart: d.restart, blocked_paste: d.blocked_paste, pasted_chars_per_500: d.pasted_chars_per_500, ai_text_flag: d.ai_text_flag, claim_mismatch: d.claim_mismatch }, shortlist_size: d.shortlist_size }, updated_by: profile.id },
			{ key: 'enrichment', value: { links: d.links, resume: d.resume, video: d.video, linkedin: d.linkedin, linkedin_actor: d.linkedin_actor, max_fetch_bytes: 1_500_000, fetch_timeout_ms: 12_000 }, updated_by: profile.id },
		],
		{ onConflict: 'key' },
	);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: 'hire_settings/scoring', action: 'hiring.scoring_settings.save', diff: { linkedin: d.linkedin, merit: d.merit_weight, integrity: d.integrity_weight } });
	revalidate();
	return { ok: true };
}


// ---------------------------------------------------------------- pipeline + interviews (0132)

const StagesInput = z.object({ position_id: uuid, stages_json: z.string().min(2).max(100_000) });

export async function saveStages(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = StagesInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	if (!(await canEditPostKit(parsed.data.position_id))) return { ok: false, error: 'Only the hiring manager, the recruiter or manage_hiring holders edit the stages.' };
	let cfg: unknown;
	try {
		cfg = JSON.parse(parsed.data.stages_json);
	} catch {
		return { ok: false, error: 'Stages are not valid JSON.' };
	}
	const problem = validateStages(cfg);
	if (problem) return { ok: false, error: problem };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_positions').update({ interview_config: cfg as Record<string, unknown>, updated_by: profile.id }).eq('id', parsed.data.position_id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${parsed.data.position_id}`, action: 'hiring.stages.save', diff: { stages: (cfg as InterviewConfig).stages.length } });
	revalidate(parsed.data.position_id);
	return { ok: true };
}

/** Move an application to a stage (sets stage_key + the stage's status). */
export async function moveStage(input: { id: string; position_id: string; stage_key: string }): Promise<Result<{ status: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success || !uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data: pos } = await supabase.from('hire_positions').select('interview_config').eq('id', input.position_id).maybeSingle();
	if (!pos) return { ok: false, error: 'Position not found.' };
	const cfg = await loadStagesFor(supabase, pos as { interview_config: Record<string, unknown> });
	const stage = cfg.stages.find((s) => s.key === input.stage_key);
	if (!stage) return { ok: false, error: 'Unknown stage.' };
	const { error } = await supabase.from('hire_applications').update({ stage_key: stage.key, status: stage.status_key, last_activity_at: new Date().toISOString() }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_applications/${input.id}`, action: 'hiring.application.stage', diff: { stage: stage.key } });
	revalidatePath(`/hiring/positions/${input.position_id}/applications`);
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.id}`);
	return { ok: true, status: stage.status_key };
}

const InterviewInput = z.object({
	id: optUuid,
	application_id: uuid,
	position_id: uuid,
	stage_key: z.string().trim().min(1).max(40),
	kind: z.enum(INTERVIEW_KINDS),
	status: z.enum(INTERVIEW_STATUSES).optional(),
	scheduled_at: optText(40),
	duration_min: z.coerce.number().int().min(5).max(480).default(30),
	timezone: optText(60),
	location_kind: z.enum(LOCATION_KINDS).default('zoom'),
	location_text: optText(500),
	booking_url: optText(500),
	interviewer_ids: z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter((s) => uuid.safeParse(s).success) : [])),
	owner_id: optUuid,
	notes_md: optText(4000),
	recording_url: optText(500),
	transcript_md: z.string().max(400_000).optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
});

/** Create or update an interview (schedule, reschedule, change interviewers, attach recording / transcript). */
export async function saveInterview(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = InterviewInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const sched = d.scheduled_at ? new Date(d.scheduled_at) : null;
	if (sched && Number.isNaN(sched.getTime())) return { ok: false, error: 'Invalid date.' };
	const row: Record<string, unknown> = {
		stage_key: d.stage_key,
		kind: d.kind,
		scheduled_at: sched ? sched.toISOString() : null,
		duration_min: d.duration_min,
		timezone: d.timezone,
		location_kind: d.location_kind,
		location_text: d.location_text,
		booking_url: d.booking_url,
		booking_provider: d.location_kind === 'calendly' ? 'calendly' : d.location_kind === 'ghl' ? 'ghl' : 'manual',
		interviewer_ids: d.interviewer_ids,
		owner_id: d.owner_id ?? profile.id,
		notes_md: d.notes_md,
		recording_url: d.recording_url,
	};
	if (d.transcript_md !== undefined) row.transcript_md = d.transcript_md;
	if (d.status) row.status = d.status;
	else if (!d.id) row.status = sched ? 'scheduled' : 'proposed';
	if (d.id) {
		if (sched) {
			const { data: cur } = await supabase.from('hire_interviews').select('scheduled_at, status').eq('id', d.id).maybeSingle();
			const c = cur as { scheduled_at: string | null; status: string } | null;
			if (c?.scheduled_at && new Date(c.scheduled_at).getTime() !== sched.getTime() && !d.status) row.status = 'scheduled';
			if (c?.scheduled_at && new Date(c.scheduled_at).getTime() !== sched.getTime()) {
				row.reminder_24h_at = null;
				row.reminder_1h_at = null;
			}
		}
		const { error } = await supabase.from('hire_interviews').update(row).eq('id', d.id);
		if (error) return { ok: false, error: friendly(error.message) };
		revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.application_id}`);
		return { ok: true, id: d.id };
	}
	const { data, error } = await supabase
		.from('hire_interviews')
		.insert({ ...row, application_id: d.application_id, position_id: d.position_id, created_by: profile.id })
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	// bell the interviewers
	const svc = createServiceRoleClient();
	for (const uid of new Set(d.interviewer_ids)) {
		await svc.from('notifications').upsert({ user_id: uid, kind: 'hiring', title: `Interview: ${d.kind.replace('_', ' ')}${sched ? ` · ${sched.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`, body: 'You are on the panel. Open the application for the brief and your scorecard.', href: `/hiring/positions/${d.position_id}/applications/${d.application_id}`, dedupe_key: `hire:interview:${(data as { id: string }).id}:${uid}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_interviews/${(data as { id: string }).id}`, action: 'hiring.interview.create', diff: { kind: d.kind, interviewers: d.interviewer_ids.length } });
	revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.application_id}`);
	return { ok: true, id: (data as { id: string }).id };
}

export async function setInterviewStatus(input: { id: string; application_id: string; position_id: string; status: (typeof INTERVIEW_STATUSES)[number] }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid interview.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: input.status };
	if (input.status === 'no_show') patch.no_show_marked_at = new Date().toISOString();
	const { error } = await supabase.from('hire_interviews').update(patch).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true };
}

/** AI: per-candidate interview questions for an interview (saved on the row). */
export async function draftQuestions(input: { interview_id: string; application_id: string; position_id: string }): Promise<Result<{ md: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.interview_id).success) return { ok: false, error: 'Invalid interview.' };
	const supabase = await createClient();
	const [{ data: iv }, { data: app }, { data: pos }, qs, { data: cards }] = await Promise.all([
		supabase.from('hire_interviews').select('kind').eq('id', input.interview_id).maybeSingle(),
		supabase.from('hire_applications').select('summary_line, top_strength, biggest_concern, integrity_notes, score_breakdown, honeypot_followup, candidate:hire_candidates!hire_applications_candidate_id_fkey(full_name, current_title, location_text)').eq('id', input.application_id).maybeSingle(),
		supabase.from('hire_positions').select('title, role_md, responsibilities_md, results_md, requirements_md, reports_to_label, department_label').eq('id', input.position_id).maybeSingle(),
		loadScorecardQuestions(supabase),
		supabase.from('hire_scorecards').select('kind, answers, avg_score, recommendation, overall_note').eq('application_id', input.application_id).not('submitted_at', 'is', null),
	]);
	if (!iv || !app || !pos) return { ok: false, error: 'Not found.' };
	const kind = (iv as { kind: InterviewKind }).kind;
	const { data: answers } = await supabase.from('hire_application_answers').select('label, value, question_type').eq('application_id', input.application_id).in('question_type', ['long_text', 'timed_text', 'short_text']).limit(20);
	const p = pos as { title: string; role_md: string; responsibilities_md: string; results_md: string; requirements_md: string; reports_to_label: string | null; department_label: string | null };
	const r = await draftInterviewQuestions({
		kind,
		title: p.title,
		standard: qs.filter((q) => q.interview_kind === kind).map((q) => ({ label: q.label, prompt: q.prompt })),
		fourR: { position_label: p.title, department: p.department_label, reports_to: p.reports_to_label, role_md: p.role_md, responsibilities_md: p.responsibilities_md, results_md: p.results_md, requirements_md: p.requirements_md },
		highlights: { ...(app as Record<string, unknown>), answers: ((answers ?? []) as { label: string | null; value: unknown }[]).map((a) => ({ q: a.label, a: typeof a.value === 'string' ? a.value.slice(0, 600) : a.value })) },
		priorCards: (cards ?? []) as Record<string, unknown>[],
	});
	if (!r.ok) return r;
	await supabase.from('hire_interviews').update({ ai_questions_md: r.md }).eq('id', input.interview_id);
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true, md: r.md };
}

/** AI: summarize the transcript + prefill a scorecard (is_ai) for humans to confirm. */
export async function prefillFromTranscript(input: { interview_id: string; application_id: string; position_id: string }): Promise<Result<{ scored: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.interview_id).success) return { ok: false, error: 'Invalid interview.' };
	const supabase = await createClient();
	const { data: iv } = await supabase.from('hire_interviews').select('kind, transcript_md, session_call_id').eq('id', input.interview_id).maybeSingle();
	const i = iv as { kind: InterviewKind; transcript_md: string | null; session_call_id: string | null } | null;
	if (!i) return { ok: false, error: 'Interview not found.' };
	let transcript = i.transcript_md;
	if (!transcript && i.session_call_id) {
		const { data: t } = await supabase.from('call_transcripts').select('content').eq('call_id', i.session_call_id).maybeSingle();
		transcript = (t as { content: string } | null)?.content ?? null;
	}
	if (!transcript) return { ok: false, error: 'No transcript yet: paste one on the interview or link a Sessions call.' };
	const qs = await loadScorecardQuestions(supabase, i.kind);
	const r = await prefillScorecard({ kind: i.kind, questions: qs.map((q) => ({ key: q.key, label: q.label, prompt: q.prompt, anchors: q.anchors })), transcript });
	if (!r.ok) return r;
	const svc = createServiceRoleClient();
	await svc.from('hire_interviews').update({ ai_summary_md: r.summary_md, ai_prefill: r.answers }).eq('id', input.interview_id);
	await svc.from('hire_scorecards').upsert({ interview_id: input.interview_id, application_id: input.application_id, scorer_id: null, is_ai: true, kind: i.kind, answers: r.answers, overall_note: [r.summary_md, r.flags.length ? `Flags: ${r.flags.join('; ')}` : ''].filter(Boolean).join('\n\n'), submitted_at: new Date().toISOString() }, { onConflict: 'interview_id', ignoreDuplicates: false });
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_interviews/${input.interview_id}`, action: 'hiring.interview.prefill', diff: { answers: Object.keys(r.answers).length } });
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true, scored: Object.keys(r.answers).length };
}

const ScorecardInput = z.object({
	interview_id: uuid,
	application_id: uuid,
	position_id: uuid,
	kind: z.enum(INTERVIEW_KINDS),
	answers_json: z.string().min(2).max(50_000),
	recommendation: z.enum(['strong_hire', 'advance', 'conditional', 'no_hire']).optional(),
	overall_note: optText(4000),
	submit: z.string().optional().transform((v) => v === 'true' || v === 'on'),
});

/** Save / submit my scorecard for an interview (one per scorer). */
export async function saveScorecard(formData: FormData): Promise<Result<{ avg: number | null; verdict: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ScorecardInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	let answers: ScorecardAnswers;
	try {
		answers = JSON.parse(d.answers_json) as ScorecardAnswers;
	} catch {
		return { ok: false, error: 'Answers are not valid JSON.' };
	}
	for (const v of Object.values(answers)) if (v?.score != null && (v.score < 1 || v.score > 4)) return { ok: false, error: 'Scores are 1-4.' };
	const supabase = await createClient();
	const rules = await loadScorecardRules(supabase);
	const ev = evaluateScorecard(d.kind, answers, rules);
	const { data: existing } = await supabase.from('hire_scorecards').select('id').eq('interview_id', d.interview_id).eq('scorer_id', profile.id).maybeSingle();
	const row = { interview_id: d.interview_id, application_id: d.application_id, scorer_id: profile.id, is_ai: false, kind: d.kind, answers, recommendation: d.recommendation ?? (ev.verdict === 'incomplete' ? null : ev.verdict), overall_note: d.overall_note, submitted_at: d.submit ? new Date().toISOString() : null };
	const { error } = existing ? await supabase.from('hire_scorecards').update(row).eq('id', (existing as { id: string }).id) : await supabase.from('hire_scorecards').insert(row);
	if (error) return { ok: false, error: friendly(error.message) };
	if (d.submit) {
		await supabase.from('hire_interviews').update({ status: 'completed' }).eq('id', d.interview_id).in('status', ['scheduled', 'proposed']);
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_interviews/${d.interview_id}`, action: 'hiring.scorecard.submit', diff: { verdict: ev.verdict } });
	}
	revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.application_id}`);
	const stats = scorecardStats(answers);
	return { ok: true, avg: stats.avg, verdict: ev.verdict };
}

// ---------------------------------------------------------------- messages

const DraftMsgInput = z.object({
	application_id: uuid,
	position_id: uuid,
	interview_id: optUuid,
	template_key: optText(60),
	channel: z.enum(CHANNELS).default('email'),
	subject: optText(200),
	body_md: z.string().max(20_000).optional().transform((v) => (v && v.trim() ? v : null)),
	booking_url: optText(500),
	next_step: optText(500),
	when: optText(120),
	location: optText(500),
	scheduled_for: optText(40),
});

/** Draft a candidate message (template or free text). Lands as 'draft' for review. */
export async function draftCandidateMessage(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = DraftMsgInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const ctx = await messageVars(supabase, d.application_id, profile.id);
	if (!ctx) return { ok: false, error: 'Application not found.' };
	const interviewers = d.interview_id ? await (async () => {
		const { data: iv } = await supabase.from('hire_interviews').select('interviewer_ids, kind, scheduled_at, location_text, booking_url').eq('id', d.interview_id!).maybeSingle();
		const i = iv as { interviewer_ids: string[]; kind: string; scheduled_at: string | null; location_text: string | null; booking_url: string | null } | null;
		if (!i) return null;
		const { data: ppl } = await supabase.from('profiles').select('first_name, last_name').in('id', i.interviewer_ids.length ? i.interviewer_ids : ['00000000-0000-0000-0000-000000000000']);
		return { names: ((ppl ?? []) as { first_name: string | null; last_name: string | null }[]).map((p) => [p.first_name, p.last_name].filter(Boolean).join(' ')).join(', '), kind: i.kind.replace('_', ' '), when: i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '', location: i.location_text ?? '', booking_url: i.booking_url ?? '' };
	})() : null;
	const to = d.channel === 'email' ? ctx.candidate.email : ctx.candidate.phone_e164;
	if (!to) return { ok: false, error: d.channel === 'email' ? 'Candidate has no email.' : 'Candidate has no phone in E.164; add it on the candidate first.' };
	const vars: MessageVars = { ...ctx.vars, booking_url: d.booking_url ?? interviewers?.booking_url ?? '', interviewers: interviewers?.names ?? '', interview_kind: interviewers?.kind ?? '', when: d.when ?? interviewers?.when ?? '', location: d.location ?? interviewers?.location ?? '', next_step: d.next_step ?? '', timezone: 'CST', alert_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'}/careers`, similar_roles: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'}/careers` };
	const r = await draftMessage(supabase, { application_id: d.application_id, candidate_id: ctx.candidate.id, interview_id: d.interview_id, template_key: d.template_key, channel: d.channel, vars, to, subject: d.subject, body_md: d.body_md, drafted_by: profile.id, scheduled_for: d.scheduled_for ? new Date(d.scheduled_for).toISOString() : null });
	if (!r.ok) return r;
	revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.application_id}`);
	revalidatePath('/hiring/inbox');
	return { ok: true, id: r.id };
}

const EditMsgInput = z.object({ id: uuid, subject: optText(200), body_md: z.string().min(1).max(20_000), decision: z.enum(['save', 'approve', 'approve_send', 'cancel']) });

/** Review a drafted message: edit, approve (queue), approve + send now, or cancel. */
export async function reviewMessage(formData: FormData): Promise<Result<{ status: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = EditMsgInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: cur } = await supabase.from('hire_messages').select('application_id, status, channel').eq('id', d.id).maybeSingle();
	const m = cur as { application_id: string | null; status: string; channel: string } | null;
	if (!m) return { ok: false, error: 'Message not found.' };
	if (m.status === 'sent') return { ok: false, error: 'Already sent.' };
	const patch: Record<string, unknown> = { subject: m.channel === 'email' ? d.subject : null, body_md: m.channel === 'email' ? d.body_md : toSmsText(d.body_md) };
	if (d.decision === 'approve' || d.decision === 'approve_send') patch.status = 'approved';
	if (d.decision === 'cancel') patch.status = 'cancelled';
	const { error } = await supabase.from('hire_messages').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	let status = String(patch.status ?? m.status);
	if (d.decision === 'approve_send') {
		const r = await sendMessage(createServiceRoleClient(), d.id);
		status = r.ok ? 'sent' : 'approved';
		if (!r.ok) {
			if (m.application_id) revalidatePath(`/hiring/positions/*/applications/${m.application_id}`);
			revalidatePath('/hiring/inbox');
			return { ok: false, error: `Approved but not sent: ${r.error}` };
		}
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_messages/${d.id}`, action: `hiring.message.${d.decision}` });
	revalidatePath('/hiring/inbox');
	return { ok: true, status };
}

/** Issue a 14-day magic link for the candidate portal (returns the URL once). */
export async function issuePortalLink(input: { candidate_id: string; application_id: string; position_id: string; purpose?: 'portal' | 'book' | 'sign' | 'upload' }): Promise<Result<{ url: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.candidate_id).success) return { ok: false, error: 'Invalid candidate.' };
	const supabase = await createClient();
	const raw = randomBytes(24).toString('hex');
	const hash = createHash('sha256').update(raw).digest('hex');
	const { error } = await supabase.from('hire_portal_tokens').insert({ candidate_id: input.candidate_id, token_hash: hash, purpose: input.purpose ?? 'portal', created_by: profile.id });
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('hire_application_events').insert({ application_id: input.application_id, kind: 'portal', summary: `Portal link issued (${input.purpose ?? 'portal'})`, actor_id: profile.id });
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true, url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'}/portal/candidate/${raw}` };
}

const TemplateInput = z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,60}$/), label: z.string().trim().min(1).max(80), channel: z.enum(CHANNELS), subject: optText(200), body_md: z.string().trim().min(1).max(20_000), stage_key: optText(40), is_active: z.string().optional().transform((v) => v === 'on' || v === 'true') });

export async function saveMessageTemplate(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Templates need manage_hiring.' };
	const parsed = TemplateInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('hire_message_templates').upsert({ ...parsed.data, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true };
}

const QuestionInput = z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,60}$/), interview_kind: z.enum(INTERVIEW_KINDS), position: z.coerce.number().int().min(0).max(1000), label: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(1000), pillars: optText(200), a1: optText(300), a2: optText(300), a3: optText(300), a4: optText(300), is_active: z.string().optional().transform((v) => v === 'on' || v === 'true') });

export async function saveScorecardQuestion(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Scorecard questions need manage_hiring.' };
	const parsed = QuestionInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { error } = await supabase.from('hire_scorecard_templates').upsert({ key: d.key, interview_kind: d.interview_kind, position: d.position, label: d.label, prompt: d.prompt, pillars: (d.pillars ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean), anchors: { '1': d.a1 ?? '', '2': d.a2 ?? '', '3': d.a3 ?? '', '4': d.a4 ?? '' }, is_active: d.is_active }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true };
}


// ---------------------------------------------------------------- offers + hire (0133)

const OfferInput = z.object({
	id: optUuid,
	application_id: uuid,
	position_id: uuid,
	candidate_id: uuid,
	employment_type: z.enum(EMPLOYMENT_TYPES).default('full_time'),
	region: z.enum(REGIONS).default('us'),
	work_mode: z.enum(WORK_MODES).default('remote'),
	hours_per_week: z.coerce.number().int().min(1).max(80).default(40),
	start_on: z.string().optional().transform((v) => (v && DATE_RE.test(v) ? v : null)),
	manager_id: optUuid,
	pay_multiplier: z.coerce.number().min(1).max(100),
	pay_level: z.string().trim().min(1).max(40),
	step: z.coerce.number().int().min(1).max(6).default(1),
	offer_template_key: optText(40),
	nda_template_key: optText(40),
	notes_md: optText(4000),
});

/** Create or update the offer (draft). Comp is computed by the trigger from the ladder. */
export async function saveOffer(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = OfferInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (!(await canEditPostKit(d.position_id))) return { ok: false, error: 'Only the hiring manager, the recruiter or manage_hiring holders build offers.' };
	const supabase = await createClient();
	const defaults = defaultTemplates(d.employment_type, d.region);
	const row = { application_id: d.application_id, position_id: d.position_id, candidate_id: d.candidate_id, employment_type: d.employment_type, region: d.region, work_mode: d.work_mode, hours_per_week: d.hours_per_week, start_on: d.start_on, manager_id: d.manager_id, pay_multiplier: d.pay_multiplier, pay_level: d.pay_level, step: d.step, offer_template_key: d.offer_template_key ?? defaults.offer, nda_template_key: d.nda_template_key ?? defaults.nda, notes_md: d.notes_md };
	if (d.id) {
		const { error } = await supabase.from('hire_offers').update(row).eq('id', d.id).in('status', ['draft', 'approved']);
		if (error) return { ok: false, error: friendly(error.message) };
		// comp changes invalidate approval
		await supabase.from('hire_offers').update({ status: 'draft', approved_by: null, approved_at: null }).eq('id', d.id).eq('status', 'approved');
		revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.application_id}`);
		return { ok: true, id: d.id };
	}
	const { data, error } = await supabase.from('hire_offers').insert({ ...row, created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: error.message.includes('hire_offers_one_open_per_app') ? 'An open offer already exists for this application.' : friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_offers/${(data as { id: string }).id}`, action: 'hiring.offer.create', diff: { level: d.pay_level, multiplier: d.pay_multiplier, employment: d.employment_type, region: d.region } });
	// Alex bell: an offer waits for approval
	const svc = createServiceRoleClient();
	const { data: alex } = await svc.from('profiles').select('id').eq('email', (await getOrgSettings()).owner_email ?? '').maybeSingle();
	if (alex) await svc.from('notifications').upsert({ user_id: (alex as { id: string }).id, kind: 'hiring', title: 'Offer awaiting your approval', body: `${d.pay_level} × ${d.pay_multiplier}, step ${d.step} · start ${d.start_on ?? 'TBD'}`, href: `/hiring/positions/${d.position_id}/applications/${d.application_id}`, dedupe_key: `hire:offer-approve:${(data as { id: string }).id}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	revalidatePath(`/hiring/positions/${d.position_id}/applications/${d.application_id}`);
	return { ok: true, id: (data as { id: string }).id };
}

/** Status moves on the offer: approve (Alex — trigger enforces), withdraw, mark declined. */
export async function setOfferStatus(input: { id: string; application_id: string; position_id: string; status: 'approved' | 'withdrawn' | 'declined'; reason?: string | null }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid offer.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: input.status };
	if (input.status === 'declined') patch.decline_reason = input.reason?.slice(0, 400) ?? null;
	const { error } = await supabase.from('hire_offers').update(patch).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (input.status === 'withdrawn' || input.status === 'declined') {
		await supabase.from('hire_documents').update({ status: 'void' }).eq('offer_id', input.id).in('status', ['draft', 'sent', 'viewed']);
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_offers/${input.id}`, action: `hiring.offer.${input.status}` });
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true };
}

/** Generate the offer letter + NDA documents from the templates and send them through the signature provider (DocuSeal, or manual). Marks the offer sent. */
export async function sendOffer(input: { id: string; application_id: string; position_id: string }): Promise<Result<{ provider: string; documents: { kind: string; signer_url: string | null }[] }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid offer.' };
	const supabase = await createClient();
	const { data: offerRow } = await supabase.from('hire_offers').select('*, candidate:hire_candidates!hire_offers_candidate_id_fkey(full_name, email, location_text, country), position:hire_positions!hire_offers_position_id_fkey(title, brand), manager:profiles!hire_offers_manager_id_fkey(first_name, last_name, job_role, title)').eq('id', input.id).maybeSingle();
	if (!offerRow) return { ok: false, error: 'Offer not found.' };
	const o = offerRow as unknown as OfferRow & { candidate: { full_name: string; email: string; location_text: string | null; country: string | null }; position: { title: string; brand: string }; manager: { first_name: string | null; last_name: string | null; job_role: string | null; title: string | null } | null };
	if (o.status !== 'approved' && o.status !== 'sent') return { ok: false, error: 'Alex approves the offer before it is sent.' };
	const templates = await loadDocumentTemplates(supabase);
	const keys = [o.offer_template_key, o.nda_template_key].filter((k): k is string => !!k);
	if (keys.length < 2) return { ok: false, error: 'Pick an offer template and an NDA template.' };
	const brand = ({ main: 'Open Ronin', premium: 'Premium', beacon: 'Beacon' } as Record<string, string>)[o.position.brand] ?? 'Open Ronin';
	const vars = offerVars({ position: o.position.title, candidate_name: o.candidate.full_name, candidate_location: [o.candidate.location_text, o.candidate.country].filter(Boolean).join(', '), manager_name: o.manager ? [o.manager.first_name, o.manager.last_name].filter(Boolean).join(' ') : null, manager_title: o.manager?.job_role ?? o.manager?.title ?? null, annual_target_cents: o.annual_target_cents, annual_base_cents: o.annual_base_cents, monthly_target_cents: o.monthly_target_cents, monthly_base_cents: o.monthly_base_cents, start_on: o.start_on, work_mode: o.work_mode, hours_per_week: o.hours_per_week, brand });
	const provider = activeSignatureProvider();
	const out: { kind: string; signer_url: string | null }[] = [];
	const svc = createServiceRoleClient();
	for (const key of keys) {
		const t = templates.find((x) => x.key === key);
		if (!t) return { ok: false, error: `Template ${key} missing.` };
		const body = renderDocument(t.body_md, vars);
		// reuse an existing unsigned doc of this kind, else create
		const { data: existing } = await supabase.from('hire_documents').select('id, status').eq('offer_id', o.id).eq('kind', t.kind).in('status', ['draft', 'sent', 'viewed']).maybeSingle();
		let docId = (existing as { id: string } | null)?.id ?? null;
		if (!docId) {
			const { data: ins, error } = await supabase.from('hire_documents').insert({ offer_id: o.id, candidate_id: o.candidate_id, application_id: o.application_id, template_key: t.key, template_version: t.version, kind: t.kind, title: `${t.kind === 'offer' ? 'Offer letter' : 'NDA'} — ${o.position.title}`, body_md: body, signer_name: o.candidate.full_name, signer_email: o.candidate.email, countersigner_id: (await svc.from('profiles').select('id').eq('email', (await getOrgSettings()).owner_email ?? '').maybeSingle()).data?.id ?? null, created_by: profile.id }).select('id').single();
			if (error) return { ok: false, error: friendly(error.message) };
			docId = (ins as { id: string }).id;
		} else {
			await supabase.from('hire_documents').update({ body_md: body, template_version: t.version }).eq('id', docId);
		}
		try {
			const r = await provider.send({ contractId: docId, title: `${t.kind === 'offer' ? 'Offer letter' : 'NDA'} — ${o.position.title}`, bodyHtml: markdownToHtml(body), signer: { name: o.candidate.full_name, email: o.candidate.email } });
			await svc.from('hire_documents').update({ status: 'sent', provider: provider.id, provider_ref: r.providerRef, signer_url: r.signerUrl, sent_at: new Date().toISOString() }).eq('id', docId);
			out.push({ kind: t.kind, signer_url: r.signerUrl });
		} catch (e) {
			return { ok: false, error: `${provider.label}: ${e instanceof Error ? e.message : 'send failed'}` };
		}
	}
	if (o.status !== 'sent') await supabase.from('hire_offers').update({ status: 'sent' }).eq('id', o.id);
	await supabase.from('hire_applications').update({ status: 'offer', stage_key: 'offer', last_activity_at: new Date().toISOString() }).eq('id', o.application_id).not('status', 'in', '(hired)');
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_offers/${o.id}`, action: 'hiring.offer.send', diff: { provider: provider.id, documents: out.length } });
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true, provider: provider.label, documents: out };
}

/** Manual signature fallback / poll: mark a document signed, declined or void; or refresh from the provider. */
export async function markDocument(input: { id: string; application_id: string; position_id: string; status: 'signed' | 'declined' | 'void' | 'refresh' }): Promise<Result<{ status: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid document.' };
	const supabase = await createClient();
	if (input.status === 'refresh') {
		const { data } = await supabase.from('hire_documents').select('provider, provider_ref, status').eq('id', input.id).maybeSingle();
		const d = data as { provider: string | null; provider_ref: string | null; status: string } | null;
		if (!d?.provider || !d.provider_ref) return { ok: false, error: 'No provider reference on this document.' };
		const p = providerById(d.provider);
		if (!p) return { ok: false, error: 'Unknown provider.' };
		try {
			const s = await p.status(d.provider_ref);
			const patch: Record<string, unknown> = { status: s.status };
			if (s.status === 'signed') patch.signed_at = s.signedAt ?? new Date().toISOString();
			if (s.status === 'viewed') patch.viewed_at = new Date().toISOString();
			await supabase.from('hire_documents').update(patch).eq('id', input.id);
			revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
			return { ok: true, status: s.status };
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : 'refresh failed' };
		}
	}
	const patch: Record<string, unknown> = { status: input.status };
	if (input.status === 'signed') patch.signed_at = new Date().toISOString();
	if (input.status === 'declined') patch.declined_at = new Date().toISOString();
	if (!(await supabase.from('hire_documents').select('provider').eq('id', input.id).maybeSingle()).data) return { ok: false, error: 'Document not found.' };
	const { error } = await supabase.from('hire_documents').update({ ...patch, provider: input.status === 'signed' ? 'manual' : undefined }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_documents/${input.id}`, action: `hiring.document.${input.status}` });
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	return { ok: true, status: input.status };
}

/** Convert an accepted offer into a hire: invite the user (auth.admin), link / create the profile, PAP comp, provisioning checklist. */
export async function convertToHire(input: { id: string; application_id: string; position_id: string; invite?: boolean }): Promise<Result<{ profile_id: string | null; provisioning_items: number; invited: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid offer.' };
	const supabase = await createClient();
	const { data: o } = await supabase.from('hire_offers').select('status, candidate_id, invited_at, candidate:hire_candidates!hire_offers_candidate_id_fkey(full_name, email)').eq('id', input.id).maybeSingle();
	const offer = o as unknown as { status: string; candidate_id: string; invited_at: string | null; candidate: { full_name: string; email: string } } | null;
	if (!offer) return { ok: false, error: 'Offer not found.' };
	if (offer.status !== 'accepted') return { ok: false, error: 'The offer must be accepted (offer letter + NDA signed) first.' };
	const svc = createServiceRoleClient();
	let invited = false;
	if (input.invite !== false) {
		const { data: existing } = await svc.from('profiles').select('id').eq('email', offer.candidate.email.toLowerCase()).maybeSingle();
		if (!existing && !offer.invited_at) {
			const [first, ...rest] = offer.candidate.full_name.trim().split(/\s+/);
			const { error } = await svc.auth.admin.inviteUserByEmail(offer.candidate.email, { data: { first_name: first, last_name: rest.join(' ') }, redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'}/auth/callback` });
			if (error && !/already/i.test(error.message)) return { ok: false, error: `Invite failed: ${error.message}` };
			invited = !error;
			await svc.from('hire_offers').update({ invite_email: offer.candidate.email, invited_at: new Date().toISOString() }).eq('id', input.id);
			// handle_new_user creates the profile only on first sign-in for invite flows in some configs; create it now if auth created the user
			const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
			const u = users?.users.find((x) => x.email?.toLowerCase() === offer.candidate.email.toLowerCase());
			if (u) await svc.from('profiles').upsert({ id: u.id, email: offer.candidate.email, first_name: first, last_name: rest.join(' ') || '', role: 'contributor', is_active: true }, { onConflict: 'id', ignoreDuplicates: true });
		}
	}
	const { data, error } = await svc.rpc('hire_convert_to_hire', { p_offer_id: input.id });
	if (error) return { ok: false, error: friendly(error.message) };
	const r = data as { profile_id: string | null; provisioning_items: number; position_filled: boolean };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_offers/${input.id}`, action: 'hiring.offer.convert', diff: { profile_id: r.profile_id, provisioning_items: r.provisioning_items, invited } });
	revalidatePath(`/hiring/positions/${input.position_id}/applications/${input.application_id}`);
	revalidatePath('/hiring/provisioning');
	revalidatePath('/team');
	return { ok: true, profile_id: r.profile_id, provisioning_items: r.provisioning_items, invited };
}

const ProvisionInput = z.object({ id: uuid, status: z.enum(PROVISIONING_STATUSES), note: optText(400), owner_id: optUuid });

export async function updateProvisioning(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ProvisionInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: d.status, note: d.note };
	if (formData.has('owner_id')) patch.owner_id = d.owner_id;
	if (d.status === 'done' || d.status === 'skipped') {
		patch.done_by = profile.id;
		patch.done_at = new Date().toISOString();
	} else {
		patch.done_by = null;
		patch.done_at = null;
	}
	const { error } = await supabase.from('hire_provisioning').update(patch).eq('id', d.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath('/hiring/provisioning');
	return { ok: true };
}

/** Close a role and pool the remaining applicants (round 3). Drafts the closed-role message per applicant for review. */
export async function closeRoleToPool(input: { position_id: string; reason?: string | null }): Promise<Result<{ pooled: number; drafted: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.position_id).success) return { ok: false, error: 'Invalid position.' };
	if (!(await canEditPostKit(input.position_id))) return { ok: false, error: 'Only the hiring manager, the recruiter or manage_hiring holders close a role.' };
	const supabase = await createClient();
	const { data: before } = await supabase.from('hire_applications').select('id').eq('position_id', input.position_id).not('status', 'in', '(hired,rejected,withdrawn,pool)');
	const ids = ((before ?? []) as { id: string }[]).map((a) => a.id);
	const { data: n, error } = await supabase.rpc('hire_pool_closed_role', { p_position_id: input.position_id });
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('hire_positions').update({ status: 'closed', close_reason: input.reason?.slice(0, 400) ?? null, updated_by: profile.id }).eq('id', input.position_id).in('status', ['open', 'paused', 'approved']);
	let drafted = 0;
	for (const id of ids) {
		const ctx = await messageVars(supabase, id, profile.id);
		if (!ctx) continue;
		const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
		const r = await draftMessage(supabase, { application_id: id, candidate_id: ctx.candidate.id, template_key: 'closed_role', channel: 'email', vars: { ...ctx.vars, similar_roles: `${appUrl}/careers`, alert_url: `${appUrl}/careers` }, to: ctx.candidate.email, drafted_by: profile.id });
		if (r.ok) drafted++;
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `hire_positions/${input.position_id}`, action: 'hiring.position.close_to_pool', diff: { pooled: Number(n ?? 0), drafted } });
	revalidate(input.position_id);
	revalidatePath(`/hiring/positions/${input.position_id}/applications`);
	revalidatePath('/hiring/inbox');
	return { ok: true, pooled: Number(n ?? 0), drafted };
}

const DocTemplateInput = z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/), label: z.string().trim().min(1).max(120), kind: z.enum(['offer', 'nda', 'other']), region: z.enum(['us', 'os', 'any']), employment: z.string().trim().max(200).default(''), body_md: z.string().trim().min(20).max(60_000), is_active: z.string().optional().transform((v) => v === 'on' || v === 'true') });

export async function saveDocumentTemplate(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await canManage())) return { ok: false, error: 'Document templates need manage_hiring.' };
	const parsed = DocTemplateInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: cur } = await supabase.from('hire_document_templates').select('version').eq('key', d.key).maybeSingle();
	const { error } = await supabase.from('hire_document_templates').upsert({ key: d.key, label: d.label, kind: d.kind, region: d.region, employment: d.employment.split(',').map((s) => s.trim()).filter(Boolean), body_md: d.body_md, is_active: d.is_active, version: ((cur as { version: number } | null)?.version ?? 0) + 1, updated_by: profile.id }, { onConflict: 'key' });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate();
	return { ok: true };
}
