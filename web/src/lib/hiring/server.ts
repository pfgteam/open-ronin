// Hiring module server readers (0128). Server-only: every function takes
// the caller's Supabase client so RLS (can_view_hiring / can_view_position_comp)
// decides what comes back. Pages render from these; actions.ts writes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrandProfile, EmploymentType, HireBrand, LocationType, PayLevelRow, PayProgression, PositionStatus } from './shared';
import { DEFAULT_PROGRESSION } from './shared';
import type { BoardRow, LinkRow, PostingRow, PublicPosition } from './careers';
import type { InterviewConfig, InterviewKind, InterviewLocationKind, InterviewStatus, ScorecardAnswers, ScorecardQuestion, ScorecardRules, StageTemplateRow } from './pipeline';
import { stagesFromTemplates } from './pipeline';
import type { AttendanceSummaryRow } from './onboarding';
import type { QualityFunnelRow, QualityHireRow, QualityInterviewerRow, QualitySourceRow } from './quality';

type Db = SupabaseClient;

export function isNotApplied(e: { code?: string; message?: string } | null | undefined): boolean {
	if (!e) return false;
	return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
}

export interface PositionRow {
	id: string;
	brand: HireBrand;
	title: string;
	slug: string;
	status: PositionStatus;
	department_tag_id: string | null;
	department_label: string | null;
	reports_to_label: string | null;
	pap_position: string | null;
	position_track: string | null;
	pay_level: string | null;
	employment_type: EmploymentType;
	location_type: LocationType;
	location_text: string | null;
	timezone_note: string | null;
	headcount: number;
	hiring_manager_id: string | null;
	recruiter_id: string | null;
	requested_by: string | null;
	request_id: string | null;
	approved_by: string | null;
	approved_at: string | null;
	target_start_on: string | null;
	opened_at: string | null;
	closed_at: string | null;
	close_reason: string | null;
	four_r_template_slug: string | null;
	role_md: string;
	responsibilities_md: string;
	results_md: string;
	requirements_md: string;
	about_us_override_md: string | null;
	compensation_statement: string | null;
	show_pay_range: boolean;
	application_config: Record<string, unknown>;
	interview_config: Record<string, unknown>;
	consent_version: number;
	posting_budget_cents: number | null;
	notes_md: string | null;
	created_by: string | null;
	updated_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface PositionCompRow {
	position_id: string;
	pay_multiplier: number | null;
	pay_level: string | null;
	step: number;
	monthly_target_cents: number | null;
	monthly_base_cents: number | null;
	monthly_performance_cents: number | null;
	annual_target_cents: number | null;
	currency: string;
	pay_range_min_cents: number | null;
	pay_range_max_cents: number | null;
	comp_notes_md: string | null;
	updated_at: string;
}

export interface PositionEventRow {
	id: number;
	kind: string;
	from_status: string | null;
	to_status: string | null;
	note: string | null;
	actor_id: string | null;
	created_at: string;
}

export interface StaffOption {
	id: string;
	name: string;
	email: string;
}

export interface HiringConfig {
	notApplied: boolean;
	levels: PayLevelRow[];
	progression: PayProgression;
	brands: BrandProfile[];
	settings: Record<string, Record<string, unknown>>;
}

export async function loadHiringConfig(db: Db): Promise<HiringConfig> {
	const [levels, brands, settings] = await Promise.all([
		db.from('hire_pay_levels').select('*').order('sort'),
		db.from('hire_brand_profiles').select('*').order('brand'),
		db.from('hire_settings').select('key, value'),
	]);
	if (isNotApplied(levels.error) || isNotApplied(brands.error)) {
		return { notApplied: true, levels: [], progression: DEFAULT_PROGRESSION, brands: [], settings: {} };
	}
	const map: Record<string, Record<string, unknown>> = {};
	for (const s of (settings.data ?? []) as { key: string; value: Record<string, unknown> }[]) map[s.key] = s.value ?? {};
	const prog = { ...DEFAULT_PROGRESSION, ...((map.pay_progression ?? {}) as Partial<PayProgression>) };
	return {
		notApplied: false,
		levels: ((levels.data ?? []) as PayLevelRow[]).map((l) => ({ ...l, base_pct: Number(l.base_pct) })),
		progression: prog,
		brands: (brands.data ?? []) as BrandProfile[],
		settings: map,
	};
}

export interface PositionFilters {
	status?: PositionStatus | 'active' | 'all';
	brand?: HireBrand;
	manager?: string;
}

export async function loadPositions(db: Db, f: PositionFilters = {}): Promise<{ positions: PositionRow[]; error: string | null }> {
	let q = db.from('hire_positions').select('*').order('updated_at', { ascending: false }).limit(300);
	if (f.status && f.status !== 'all') {
		if (f.status === 'active') q = q.in('status', ['draft', 'pending_approval', 'approved', 'open', 'paused']);
		else q = q.eq('status', f.status);
	}
	if (f.brand) q = q.eq('brand', f.brand);
	if (f.manager) q = q.eq('hiring_manager_id', f.manager);
	const { data, error } = await q;
	if (error) return { positions: [], error: isNotApplied(error) ? 'not_applied' : error.message };
	return { positions: (data ?? []) as PositionRow[], error: null };
}

export async function loadPosition(db: Db, idOrSlug: string): Promise<PositionRow | null> {
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
	const { data } = await db.from('hire_positions').select('*').eq(isUuid ? 'id' : 'slug', idOrSlug).maybeSingle();
	return (data as PositionRow | null) ?? null;
}

export async function loadPositionContext(db: Db, position: PositionRow) {
	const [comp, events, request, templates, people] = await Promise.all([
		db.from('hire_position_comp').select('*').eq('position_id', position.id).maybeSingle(),
		db.from('hire_position_events').select('id, kind, from_status, to_status, note, actor_id, created_at').eq('position_id', position.id).order('created_at', { ascending: false }).limit(50),
		position.request_id ? db.from('staff_requests').select('id, status, title, decided_at, decision_note_md, created_at').eq('id', position.request_id).maybeSingle() : Promise.resolve({ data: null }),
		db.from('four_r_templates').select('slug, position_label, department, reports_to, role_md, responsibilities_md, results_md, requirements_md').eq('is_active', true).order('sort'),
		loadStaff(db),
	]);
	return {
		comp: (comp.data as PositionCompRow | null) ?? null,
		events: (events.data ?? []) as PositionEventRow[],
		request: (request.data as { id: string; status: string; title: string; decided_at: string | null; decision_note_md: string | null; created_at: string } | null) ?? null,
		templates: (templates.data ?? []) as { slug: string; position_label: string; department: string | null; reports_to: string | null; role_md: string; responsibilities_md: string; results_md: string; requirements_md: string }[],
		people,
	};
}

export async function loadStaff(db: Db): Promise<StaffOption[]> {
	const { data } = await db.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name');
	return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string }[]).map((p) => ({
		id: p.id,
		name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
		email: p.email,
	}));
}

export async function loadCatalogs(db: Db) {
	const [departments, pap, tracks] = await Promise.all([
		db.from('tags').select('id, label, slug').eq('category', 'department').order('position'),
		db.from('pap_positions').select('slug, label').eq('is_active', true).order('sort'),
		db.from('position_tracks').select('slug, label').eq('is_active', true).order('sort'),
	]);
	return {
		departments: (departments.data ?? []) as { id: string; label: string; slug: string }[],
		pap: (pap.data ?? []) as { slug: string; label: string }[],
		tracks: (tracks.data ?? []) as { slug: string; label: string }[],
	};
}

// ---------------------------------------------------------------- careers (0129)


const PUBLIC_COLUMNS = 'id, slug, title, brand, department_label, employment_type, location_type, location_text, timezone_note, compensation_statement, show_pay_range, about_us_override_md, opened_at, updated_at, reports_to_label, role_md, responsibilities_md, results_md, requirements_md';

function toPublic(row: Record<string, unknown>, comp?: { pay_range_min_cents: number | null; pay_range_max_cents: number | null } | null): PublicPosition {
	return {
		id: row.id as string,
		slug: row.slug as string,
		title: row.title as string,
		brand: row.brand as PublicPosition['brand'],
		department_label: (row.department_label as string | null) ?? null,
		employment_type: row.employment_type as PublicPosition['employment_type'],
		location_type: row.location_type as PublicPosition['location_type'],
		location_text: (row.location_text as string | null) ?? null,
		timezone_note: (row.timezone_note as string | null) ?? null,
		compensation_statement: (row.compensation_statement as string | null) ?? null,
		show_pay_range: !!row.show_pay_range,
		about_us_override_md: (row.about_us_override_md as string | null) ?? null,
		opened_at: (row.opened_at as string | null) ?? null,
		updated_at: row.updated_at as string,
		position_label: row.title as string,
		department: (row.department_label as string | null) ?? null,
		reports_to: (row.reports_to_label as string | null) ?? null,
		role_md: (row.role_md as string) ?? '',
		responsibilities_md: (row.responsibilities_md as string) ?? '',
		results_md: (row.results_md as string) ?? '',
		requirements_md: (row.requirements_md as string) ?? '',
		pay_range_min_cents: comp?.pay_range_min_cents ?? null,
		pay_range_max_cents: comp?.pay_range_max_cents ?? null,
	};
}

/** Open roles for the public careers page / feed. Service-role client (signed-out). */
export async function loadOpenPositions(svc: Db): Promise<PublicPosition[]> {
	const { data, error } = await svc.from('hire_positions').select(PUBLIC_COLUMNS).eq('status', 'open').order('opened_at', { ascending: false });
	if (error || !data) return [];
	const rows = data as Record<string, unknown>[];
	const withRange = rows.filter((r) => r.show_pay_range).map((r) => r.id as string);
	const comps = withRange.length ? ((await svc.from('hire_position_comp').select('position_id, pay_range_min_cents, pay_range_max_cents').in('position_id', withRange)).data ?? []) : [];
	const compBy = new Map((comps as { position_id: string; pay_range_min_cents: number | null; pay_range_max_cents: number | null }[]).map((c) => [c.position_id, c]));
	return rows.map((r) => toPublic(r, compBy.get(r.id as string)));
}

export async function loadOpenPosition(svc: Db, slug: string): Promise<PublicPosition | null> {
	const { data } = await svc.from('hire_positions').select(PUBLIC_COLUMNS).eq('slug', slug).eq('status', 'open').maybeSingle();
	if (!data) return null;
	const row = data as Record<string, unknown>;
	const comp = row.show_pay_range ? ((await svc.from('hire_position_comp').select('pay_range_min_cents, pay_range_max_cents').eq('position_id', row.id as string).maybeSingle()).data as { pay_range_min_cents: number | null; pay_range_max_cents: number | null } | null) : null;
	return toPublic(row, comp);
}

export async function loadBrandProfiles(db: Db): Promise<BrandProfile[]> {
	const { data } = await db.from('hire_brand_profiles').select('*').order('brand');
	return (data ?? []) as BrandProfile[];
}

export async function loadCareersSettings(db: Db): Promise<{ public_url: string; target_url: string; headline: string; intro_md: string; embed_note: string; show_closed_roles: boolean }> {
	const { data } = await db.from('hire_settings').select('value').eq('key', 'careers').maybeSingle();
	const v = ((data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
	return {
		public_url: String(v.public_url ?? 'https://app.example.com/careers'),
		target_url: String(v.target_url ?? 'https://example.com/careers'),
		headline: String(v.headline ?? 'Work with brands that give back.'),
		intro_md: String(v.intro_md ?? ''),
		embed_note: String(v.embed_note ?? ''),
		show_closed_roles: !!v.show_closed_roles,
	};
}

export async function loadBoards(db: Db): Promise<BoardRow[]> {
	const { data } = await db.from('hire_boards').select('*').order('sort');
	return (data ?? []) as BoardRow[];
}

export async function loadPostKit(db: Db, positionId: string): Promise<{ postings: PostingRow[]; links: LinkRow[] }> {
	const [postings, links] = await Promise.all([
		db.from('hire_postings').select('*').eq('position_id', positionId).order('created_at'),
		db.from('hire_links').select('*').eq('position_id', positionId).order('created_at'),
	]);
	return { postings: (postings.data ?? []) as PostingRow[], links: (links.data ?? []) as LinkRow[] };
}

export async function loadPostingsOverview(db: Db) {
	const { data } = await db.from('hire_postings').select('id, position_id, board_key, status, live_url, posted_at, expires_at, cost_cents').in('status', ['planned', 'posted', 'live']).order('expires_at', { ascending: true, nullsFirst: false }).limit(300);
	return (data ?? []) as Pick<PostingRow, 'id' | 'position_id' | 'board_key' | 'status' | 'live_url' | 'posted_at' | 'expires_at' | 'cost_cents'>[];
}

export async function loadJobAlerts(db: Db) {
	const { data } = await db.from('hire_job_alerts').select('id, email, name, tags, source, confirmed_at, unsubscribed_at, created_at').order('created_at', { ascending: false }).limit(500);
	return (data ?? []) as { id: string; email: string; name: string | null; tags: string[]; source: string | null; confirmed_at: string | null; unsubscribed_at: string | null; created_at: string }[];
}

export interface FourRImportRow {
	id: string;
	drive_file_id: string;
	drive_name: string;
	folder: 'positions_general' | 'new_for_review' | 'team_members';
	target_kind: 'template' | 'person';
	target_user_id: string | null;
	target_slug: string | null;
	status: 'pending' | 'fetched' | 'imported' | 'skipped';
	raw_text: string | null;
	parsed: Record<string, unknown> | null;
	note: string | null;
	imported_at: string | null;
	updated_at: string;
}

export interface FourRDraftRow {
	id: string;
	user_id: string;
	source: 'ai' | 'template' | 'drive';
	template_slug: string | null;
	draft: Record<string, string | null>;
	status: 'pending' | 'approved' | 'rejected';
	generated_by: string | null;
	decided_by: string | null;
	decided_at: string | null;
	note: string | null;
	created_at: string;
}

export async function loadFourRBackfill(db: Db) {
	const [imports, drafts, missing] = await Promise.all([
		db.from('hire_four_r_imports').select('*').order('folder').order('drive_name'),
		db.from('hire_four_r_drafts').select('*').order('created_at', { ascending: false }),
		db.from('profiles').select('id, first_name, last_name, email, job_role, pap_position, position_track, title, department_tag_id, department').eq('is_active', true).order('first_name'),
	]);
	const withFourR = await db.from('profile_four_r').select('user_id');
	const has = new Set(((withFourR.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
	const deptTags = await db.from('tags').select('id, label').eq('category', 'department');
	const deptLabel = new Map(((deptTags.data ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));
	type P = { id: string; first_name: string | null; last_name: string | null; email: string; job_role: string | null; pap_position: string | null; position_track: string | null; title: string | null; department_tag_id: string | null; department: string | null };
	const people = ((missing.data ?? []) as P[]).map((p) => ({
		...p,
		name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
		department_label: (p.department_tag_id ? deptLabel.get(p.department_tag_id) : null) ?? p.department ?? null,
		has_four_r: has.has(p.id),
	}));
	return {
		imports: (imports.data ?? []) as FourRImportRow[],
		drafts: (drafts.data ?? []) as FourRDraftRow[],
		people,
		notApplied: isNotApplied(imports.error),
	};
}

// ---------------------------------------------------------------- applications (0130)

export interface CandidateRow {
	id: string;
	full_name: string;
	email: string;
	phone: string | null;
	phone_e164: string | null;
	linkedin_url: string | null;
	location_text: string | null;
	country: string | null;
	timezone: string | null;
	current_title: string | null;
	portfolio_urls: string[];
	resume_path: string | null;
	video_url: string | null;
	video_path: string | null;
	video_transcript: string | null;
	consent_version: number | null;
	consented_at: string | null;
	disc: Record<string, unknown> | null;
	talent_pool: boolean;
	pool_tags: string[];
	do_not_contact: boolean;
	notes_md: string | null;
	enrichment: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export interface ApplicationRow {
	id: string;
	position_id: string;
	candidate_id: string;
	status: string;
	stage_key: string | null;
	source: string | null;
	link_code: string | null;
	referrer_user_id: string | null;
	utm: Record<string, unknown>;
	config_snapshot: Record<string, unknown>;
	consent_version: number;
	restarts: number;
	sessions_count: number;
	paste_events: number;
	pasted_chars: number;
	typed_chars: number;
	blocked_paste_attempts: number;
	total_time_s: number | null;
	honeypot_hits: number;
	honeypot_followup: string | null;
	ai_text_flags: number;
	integrity_notes: string[];
	merit_score: number | null;
	integrity_score: number | null;
	overall_score: number | null;
	previous_overall: number | null;
	top_strength: string | null;
	biggest_concern: string | null;
	summary_line: string | null;
	score_breakdown: Record<string, unknown> | null;
	scored_at: string | null;
	score_version: number;
	shortlist_rank: number | null;
	reviewer_notes_md: string | null;
	starred: boolean;
	hidden: boolean;
	rejected_reason: string | null;
	decided_by: string | null;
	decided_at: string | null;
	submitted_at: string;
	last_activity_at: string;
	updated_at: string;
	candidate?: CandidateRow | null;
}

export interface AnswerRow {
	id: number;
	section_key: string;
	question_key: string;
	question_type: string;
	label: string | null;
	value: unknown;
	typed_chars: number;
	pasted_chars: number;
	paste_events: number;
	blocked_paste_attempts: number;
	time_used_s: number | null;
	started_at: string | null;
	finished_at: string | null;
	is_honeypot: boolean;
	ai_text_score: number | null;
	ai_text_note: string | null;
}

export interface ApplicationFileRow {
	id: string;
	kind: string;
	bucket: string;
	path: string;
	mime: string | null;
	size_bytes: number | null;
	original_name: string | null;
	transcript: string | null;
	created_at: string;
}

export interface ApplicationFilters {
	status?: string;
	source?: string;
	flagged?: boolean;
	starred?: boolean;
	hidden?: boolean;
	q?: string;
	sort?: 'newest' | 'score' | 'integrity' | 'name';
}

export async function loadApplications(db: Db, positionId: string, f: ApplicationFilters = {}): Promise<ApplicationRow[]> {
	let q = db.from('hire_applications').select('*, candidate:hire_candidates!hire_applications_candidate_id_fkey(*)').eq('position_id', positionId).limit(500);
	if (f.status && f.status !== 'all') q = q.eq('status', f.status);
	if (f.source) q = q.eq('source', f.source);
	if (f.starred) q = q.eq('starred', true);
	if (!f.hidden) q = q.eq('hidden', false);
	if (f.sort === 'score') q = q.order('overall_score', { ascending: false, nullsFirst: false }).order('submitted_at', { ascending: false });
	else if (f.sort === 'integrity') q = q.order('integrity_score', { ascending: true, nullsFirst: false }).order('honeypot_hits', { ascending: false });
	else q = q.order('submitted_at', { ascending: false });
	const { data } = await q;
	let rows = (data ?? []) as unknown as ApplicationRow[];
	if (f.flagged) rows = rows.filter((r) => r.honeypot_hits > 0 || r.restarts > 0 || r.blocked_paste_attempts > 0 || r.ai_text_flags > 0);
	if (f.q) {
		const needle = f.q.toLowerCase();
		rows = rows.filter((r) => (r.candidate?.full_name ?? '').toLowerCase().includes(needle) || (r.candidate?.email ?? '').toLowerCase().includes(needle) || (r.candidate?.location_text ?? '').toLowerCase().includes(needle));
	}
	if (f.sort === 'name') rows.sort((a, b) => (a.candidate?.full_name ?? '').localeCompare(b.candidate?.full_name ?? ''));
	return rows;
}

export async function loadApplication(db: Db, id: string): Promise<{ app: ApplicationRow; answers: AnswerRow[]; files: ApplicationFileRow[]; others: { id: string; position_id: string; status: string; submitted_at: string; position_title: string }[] } | null> {
	const { data } = await db.from('hire_applications').select('*, candidate:hire_candidates!hire_applications_candidate_id_fkey(*)').eq('id', id).maybeSingle();
	if (!data) return null;
	const app = data as unknown as ApplicationRow;
	const [answers, files, others] = await Promise.all([
		db.from('hire_application_answers').select('*').eq('application_id', id).order('id'),
		db.from('hire_application_files').select('id, kind, bucket, path, mime, size_bytes, original_name, transcript, created_at').eq('application_id', id).order('created_at'),
		db.from('hire_applications').select('id, position_id, status, submitted_at, position:hire_positions!hire_applications_position_id_fkey(title)').eq('candidate_id', app.candidate_id).neq('id', id).order('submitted_at', { ascending: false }),
	]);
	return {
		app,
		answers: (answers.data ?? []) as AnswerRow[],
		files: (files.data ?? []) as ApplicationFileRow[],
		others: ((others.data ?? []) as unknown as { id: string; position_id: string; status: string; submitted_at: string; position: { title: string } | null }[]).map((o) => ({ id: o.id, position_id: o.position_id, status: o.status, submitted_at: o.submitted_at, position_title: o.position?.title ?? '—' })),
	};
}

export async function applicationCounts(db: Db, positionIds: string[]): Promise<Map<string, { total: number; new: number; flagged: number }>> {
	const out = new Map<string, { total: number; new: number; flagged: number }>();
	if (!positionIds.length) return out;
	const { data } = await db.from('hire_applications').select('position_id, status, honeypot_hits, restarts, blocked_paste_attempts, ai_text_flags, hidden').in('position_id', positionIds);
	for (const r of (data ?? []) as { position_id: string; status: string; honeypot_hits: number; restarts: number; blocked_paste_attempts: number; ai_text_flags: number; hidden: boolean }[]) {
		if (r.hidden) continue;
		const c = out.get(r.position_id) ?? { total: 0, new: 0, flagged: 0 };
		c.total++;
		if (r.status === 'new') c.new++;
		if (r.honeypot_hits > 0 || r.restarts > 0 || r.blocked_paste_attempts > 0 || r.ai_text_flags > 0) c.flagged++;
		out.set(r.position_id, c);
	}
	return out;
}

export async function loadSessionFunnel(db: Db, positionId: string): Promise<{ started: number; consented: number; submitted: number; max_sections: number[] }> {
	const { data } = await db.from('hire_application_sessions').select('max_section, consented_at, submitted_at').eq('position_id', positionId).limit(2000);
	const rows = (data ?? []) as { max_section: number; consented_at: string | null; submitted_at: string | null }[];
	return { started: rows.length, consented: rows.filter((r) => r.consented_at).length, submitted: rows.filter((r) => r.submitted_at).length, max_sections: rows.map((r) => r.max_section) };
}

// ---------------------------------------------------------------- scoring + enrichment (0131)

export interface EnrichmentJobRow {
	id: string;
	kind: 'link' | 'resume' | 'video' | 'linkedin';
	target: string;
	status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
	attempts: number;
	result: Record<string, unknown> | null;
	error: string | null;
	finished_at: string | null;
}

export interface ScoringRunRow {
	id: string;
	version: number;
	model: string | null;
	merit_score: number | null;
	integrity_score: number | null;
	overall_score: number | null;
	summary_line: string | null;
	inputs_used: string[];
	duration_ms: number | null;
	created_at: string;
}

export async function loadApplicationIntel(db: Db, applicationId: string): Promise<{ jobs: EnrichmentJobRow[]; runs: ScoringRunRow[] }> {
	const [jobs, runs] = await Promise.all([
		db.from('hire_enrichment_jobs').select('id, kind, target, status, attempts, result, error, finished_at').eq('application_id', applicationId).order('created_at'),
		db.from('hire_scoring_runs').select('id, version, model, merit_score, integrity_score, overall_score, summary_line, inputs_used, duration_ms, created_at').eq('application_id', applicationId).order('created_at', { ascending: false }).limit(10),
	]);
	return { jobs: (jobs.data ?? []) as EnrichmentJobRow[], runs: (runs.data ?? []) as ScoringRunRow[] };
}

export interface InterviewRow {
	id: string;
	application_id: string;
	position_id: string;
	stage_key: string;
	kind: InterviewKind;
	status: InterviewStatus;
	scheduled_at: string | null;
	duration_min: number;
	timezone: string | null;
	location_kind: InterviewLocationKind;
	location_text: string | null;
	booking_provider: string | null;
	booking_ref: string | null;
	booking_url: string | null;
	interviewer_ids: string[];
	owner_id: string | null;
	recording_url: string | null;
	transcript_md: string | null;
	session_call_id: string | null;
	ai_questions_md: string | null;
	ai_summary_md: string | null;
	ai_prefill: Record<string, { score: number; note: string }> | null;
	reminder_24h_at: string | null;
	reminder_1h_at: string | null;
	no_show_marked_at: string | null;
	notes_md: string | null;
	created_at: string;
}

export interface ScorecardRow {
	id: string;
	interview_id: string;
	application_id: string;
	scorer_id: string | null;
	is_ai: boolean;
	kind: string;
	answers: ScorecardAnswers;
	avg_score: number | null;
	min_score: number | null;
	ones: number;
	twos: number;
	fours: number;
	recommendation: string | null;
	overall_note: string | null;
	submitted_at: string | null;
	updated_at: string;
}

export interface MessageRow {
	id: string;
	application_id: string | null;
	candidate_id: string;
	interview_id: string | null;
	channel: 'email' | 'sms' | 'whatsapp';
	direction: 'outbound' | 'inbound';
	template_key: string | null;
	to_address: string;
	from_address: string | null;
	subject: string | null;
	body_md: string;
	status: 'draft' | 'approved' | 'sent' | 'failed' | 'cancelled' | 'received';
	provider: string | null;
	error: string | null;
	drafted_by: string | null;
	approved_by: string | null;
	approved_at: string | null;
	sent_at: string | null;
	scheduled_for: string | null;
	created_at: string;
}

export interface MessageTemplateRow {
	key: string;
	label: string;
	channel: 'email' | 'sms' | 'whatsapp';
	subject: string | null;
	body_md: string;
	stage_key: string | null;
	is_active: boolean;
}

export interface ApplicationEventRow {
	id: number;
	kind: string;
	summary: string;
	payload: Record<string, unknown>;
	actor_id: string | null;
	created_at: string;
}

export async function loadStageTemplates(db: Db): Promise<StageTemplateRow[]> {
	const { data } = await db.from('hire_stage_templates').select('*').order('sort');
	return (data ?? []) as StageTemplateRow[];
}

export async function loadScorecardQuestions(db: Db, kind?: InterviewKind): Promise<ScorecardQuestion[]> {
	let q = db.from('hire_scorecard_templates').select('*').eq('is_active', true).order('interview_kind').order('position');
	if (kind) q = q.eq('interview_kind', kind);
	const { data } = await q;
	return ((data ?? []) as ScorecardQuestion[]).map((r) => ({ ...r, weight: Number(r.weight) }));
}

export async function loadScorecardRules(db: Db): Promise<ScorecardRules> {
	const { data } = await db.from('hire_settings').select('value').eq('key', 'scorecard_rules').maybeSingle();
	return (((data as { value?: ScorecardRules } | null)?.value ?? {}) as ScorecardRules);
}

export async function loadPipeline(db: Db, applicationId: string): Promise<{ interviews: InterviewRow[]; scorecards: ScorecardRow[]; messages: MessageRow[]; events: ApplicationEventRow[] }> {
	const [i, s, m, e] = await Promise.all([
		db.from('hire_interviews').select('*').eq('application_id', applicationId).order('created_at'),
		db.from('hire_scorecards').select('*').eq('application_id', applicationId).order('created_at'),
		db.from('hire_messages').select('*').eq('application_id', applicationId).order('created_at', { ascending: false }).limit(50),
		db.from('hire_application_events').select('id, kind, summary, payload, actor_id, created_at').eq('application_id', applicationId).order('created_at', { ascending: false }).limit(100),
	]);
	return {
		interviews: (i.data ?? []) as InterviewRow[],
		scorecards: ((s.data ?? []) as ScorecardRow[]).map((r) => ({ ...r, avg_score: r.avg_score == null ? null : Number(r.avg_score) })),
		messages: (m.data ?? []) as MessageRow[],
		events: (e.data ?? []) as ApplicationEventRow[],
	};
}

export async function loadMessageTemplates(db: Db): Promise<MessageTemplateRow[]> {
	const { data } = await db.from('hire_message_templates').select('key, label, channel, subject, body_md, stage_key, is_active').order('key');
	return (data ?? []) as MessageTemplateRow[];
}

export async function loadStagesFor(db: Db, position: { interview_config: Record<string, unknown> }): Promise<InterviewConfig> {
	const cfg = position.interview_config as unknown as InterviewConfig;
	if (cfg && Array.isArray(cfg.stages) && cfg.stages.length) return cfg;
	return stagesFromTemplates(await loadStageTemplates(db));
}

/** Upcoming + recent interviews across roles (the hiring calendar). */
export async function loadInterviewCalendar(db: Db, opts: { from?: string; to?: string; mine?: string | null } = {}): Promise<(InterviewRow & { candidate_name: string; position_title: string })[]> {
	let q = db.from('hire_interviews').select('*, application:hire_applications!hire_interviews_application_id_fkey(candidate:hire_candidates!hire_applications_candidate_id_fkey(full_name)), position:hire_positions!hire_interviews_position_id_fkey(title)').in('status', ['proposed', 'scheduled', 'completed', 'no_show', 'rescheduled']).order('scheduled_at', { ascending: true, nullsFirst: false }).limit(300);
	if (opts.from) q = q.gte('scheduled_at', opts.from);
	if (opts.to) q = q.lte('scheduled_at', opts.to);
	if (opts.mine) q = q.contains('interviewer_ids', [opts.mine]);
	const { data } = await q;
	return ((data ?? []) as unknown as (InterviewRow & { application: { candidate: { full_name: string } | null } | null; position: { title: string } | null })[]).map((r) => ({ ...r, candidate_name: r.application?.candidate?.full_name ?? '—', position_title: r.position?.title ?? '—' }));
}

/** Pending reviews across roles: drafted messages awaiting approval. */
export async function loadMessageQueue(db: Db): Promise<(MessageRow & { candidate_name: string; position_title: string | null; position_id: string | null })[]> {
	const { data } = await db.from('hire_messages').select('*, candidate:hire_candidates!hire_messages_candidate_id_fkey(full_name), application:hire_applications!hire_messages_application_id_fkey(position_id, position:hire_positions!hire_applications_position_id_fkey(title))').in('status', ['draft', 'approved', 'failed']).order('created_at', { ascending: false }).limit(200);
	return ((data ?? []) as unknown as (MessageRow & { candidate: { full_name: string } | null; application: { position_id: string; position: { title: string } | null } | null })[]).map((r) => ({ ...r, candidate_name: r.candidate?.full_name ?? '—', position_title: r.application?.position?.title ?? null, position_id: r.application?.position_id ?? null }));
}

// ---------------------------------------------------------------- offers + hire (0133)

export interface OfferRow {
	id: string;
	application_id: string;
	candidate_id: string;
	position_id: string;
	status: 'draft' | 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn';
	employment_type: EmploymentType;
	region: 'us' | 'os';
	work_mode: 'remote' | 'in_person' | 'hybrid';
	hours_per_week: number;
	start_on: string | null;
	manager_id: string | null;
	pay_multiplier: number | null;
	pay_level: string | null;
	step: number;
	monthly_target_cents: number | null;
	monthly_base_cents: number | null;
	annual_target_cents: number | null;
	annual_base_cents: number | null;
	currency: string;
	offer_template_key: string | null;
	nda_template_key: string | null;
	notes_md: string | null;
	approved_by: string | null;
	approved_at: string | null;
	sent_at: string | null;
	decided_at: string | null;
	decline_reason: string | null;
	hired_profile_id: string | null;
	invite_email: string | null;
	invited_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface HireDocumentRow {
	id: string;
	offer_id: string | null;
	kind: 'offer' | 'nda' | 'other';
	title: string;
	body_md: string;
	status: 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'void';
	provider: string | null;
	provider_ref: string | null;
	signer_url: string | null;
	signer_name: string;
	signer_email: string;
	sent_at: string | null;
	signed_at: string | null;
	signed_pdf_path: string | null;
	template_key: string | null;
	created_at: string;
}

export interface DocumentTemplateRow {
	key: string;
	label: string;
	kind: 'offer' | 'nda' | 'other';
	region: 'us' | 'os' | 'any';
	employment: string[];
	body_md: string;
	version: number;
	is_active: boolean;
}

export interface ProvisioningRow {
	id: string;
	offer_id: string;
	template_key: string | null;
	label: string;
	owner_role: string;
	owner_id: string | null;
	automation_key: string | null;
	due_on: string | null;
	status: 'todo' | 'in_progress' | 'done' | 'skipped' | 'failed';
	note: string | null;
	done_by: string | null;
	done_at: string | null;
}

export async function loadOffer(db: Db, applicationId: string): Promise<{ offer: OfferRow | null; documents: HireDocumentRow[]; provisioning: ProvisioningRow[] }> {
	const { data: offer } = await db.from('hire_offers').select('*').eq('application_id', applicationId).in('status', ['draft', 'approved', 'sent', 'accepted']).order('created_at', { ascending: false }).limit(1).maybeSingle();
	const o = (offer as OfferRow | null) ?? null;
	if (!o) return { offer: null, documents: [], provisioning: [] };
	const [docs, prov] = await Promise.all([db.from('hire_documents').select('*').eq('offer_id', o.id).order('created_at'), db.from('hire_provisioning').select('*').eq('offer_id', o.id).order('due_on', { ascending: true, nullsFirst: false })]);
	return { offer: { ...o, pay_multiplier: o.pay_multiplier == null ? null : Number(o.pay_multiplier) }, documents: (docs.data ?? []) as HireDocumentRow[], provisioning: (prov.data ?? []) as ProvisioningRow[] };
}

export async function loadDocumentTemplates(db: Db): Promise<DocumentTemplateRow[]> {
	const { data } = await db.from('hire_document_templates').select('key, label, kind, region, employment, body_md, version, is_active').order('kind').order('key');
	return (data ?? []) as DocumentTemplateRow[];
}

/** Open provisioning across all hires (the ops checklist view). */
export async function loadProvisioningQueue(db: Db): Promise<(ProvisioningRow & { candidate_name: string; position_title: string; start_on: string | null; application_id: string; position_id: string })[]> {
	const { data } = await db.from('hire_provisioning').select('*, offer:hire_offers!hire_provisioning_offer_id_fkey(start_on, application_id, position_id, candidate:hire_candidates!hire_offers_candidate_id_fkey(full_name), position:hire_positions!hire_offers_position_id_fkey(title))').in('status', ['todo', 'in_progress', 'failed']).order('due_on', { ascending: true, nullsFirst: false }).limit(500);
	return ((data ?? []) as unknown as (ProvisioningRow & { offer: { start_on: string | null; application_id: string; position_id: string; candidate: { full_name: string } | null; position: { title: string } | null } | null })[]).map((r) => ({ ...r, candidate_name: r.offer?.candidate?.full_name ?? '—', position_title: r.offer?.position?.title ?? '—', start_on: r.offer?.start_on ?? null, application_id: r.offer?.application_id ?? '', position_id: r.offer?.position_id ?? '' }));
}

// ---------------------------------------------------------------- onboarding + DISC + attendance (0134)

export interface OnboardingPlanRow {
	id: string;
	profile_id: string;
	offer_id: string | null;
	manager_id: string | null;
	start_on: string;
	employment_type: EmploymentType;
	status: 'active' | 'paused' | 'complete' | 'exited';
	phase1_done_at: string | null;
	phase2_done_at: string | null;
	phase3_done_at: string | null;
	completed_at: string | null;
	calibration_hold: boolean;
	calibration_enrolled_cycle_id: string | null;
	calibration_enrolled_at: string | null;
	notes_md: string | null;
	created_at: string;
}

export interface OnboardingItemRow {
	id: string;
	plan_id: string;
	template_key: string | null;
	label: string;
	description: string | null;
	phase: 1 | 2 | 3;
	kind: 'task' | 'module' | 'milestone' | 'meeting';
	owner_role: 'manager' | 'hire' | 'hr' | 'alex';
	owner_id: string | null;
	due_on: string;
	window_from: string | null;
	status: 'todo' | 'in_progress' | 'done' | 'skipped' | 'blocked';
	note_md: string | null;
	payload: Record<string, unknown>;
	done_by: string | null;
	done_at: string | null;
	sort: number;
}

export interface OnboardingCheckinRow {
	id: string;
	plan_id: string;
	day_no: number;
	on_date: string;
	win_md: string | null;
	unclear_md: string | null;
	intention_md: string | null;
	top3_md: string | null;
	supervisor_note_md: string | null;
	employee_signed_at: string | null;
	supervisor_id: string | null;
	supervisor_signed_at: string | null;
	created_by: string | null;
	created_at: string;
}

export interface OnboardingTemplateRow {
	key: string;
	label: string;
	description: string | null;
	phase: 1 | 2 | 3;
	kind: string;
	owner_role: string;
	due_day: number;
	window_from_day: number | null;
	employment: string[];
	sort: number;
	is_active: boolean;
}

export interface DiscResponseRow {
	id: string;
	candidate_id: string | null;
	profile_id: string | null;
	source: 'in_app' | 'manual' | 'provider';
	provider: string | null;
	scores: Record<string, number>;
	style: string;
	summary_md: string | null;
	completed_at: string;
	entered_by: string | null;
}

export type OnboardingPlanWithPerson = OnboardingPlanRow & { person_name: string; person_email: string; manager_name: string | null; job_role: string | null; open_items: number; overdue_items: number; done_items: number; total_items: number };

/** Every plan the viewer may see (RLS), with progress counts. */
export async function loadOnboardingPlans(db: Db, f: { status?: 'active' | 'all' } = {}): Promise<{ plans: OnboardingPlanWithPerson[]; notApplied: boolean }> {
	let q = db.from('hire_onboarding_plans').select('*, person:profiles!hire_onboarding_plans_profile_id_fkey(first_name, last_name, email, job_role), manager:profiles!hire_onboarding_plans_manager_id_fkey(first_name, last_name, email)').order('start_on', { ascending: false }).limit(300);
	if (f.status !== 'all') q = q.in('status', ['active', 'paused']);
	const { data, error } = await q;
	if (error) return { plans: [], notApplied: isNotApplied(error) };
	type P = { first_name: string | null; last_name: string | null; email: string; job_role?: string | null } | null;
	const rows = (data ?? []) as unknown as (OnboardingPlanRow & { person: P; manager: P })[];
	const ids = rows.map((r) => r.id);
	const items = ids.length ? ((await db.from('hire_onboarding_items').select('plan_id, status, due_on').in('plan_id', ids)).data ?? []) : [];
	const today = new Date().toISOString().slice(0, 10);
	const counts = new Map<string, { open: number; overdue: number; done: number; total: number }>();
	for (const it of items as { plan_id: string; status: string; due_on: string }[]) {
		const c = counts.get(it.plan_id) ?? { open: 0, overdue: 0, done: 0, total: 0 };
		c.total++;
		if (it.status === 'done' || it.status === 'skipped') c.done++;
		else {
			c.open++;
			if (it.due_on < today) c.overdue++;
		}
		counts.set(it.plan_id, c);
	}
	const nm = (p: P) => (p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email : null);
	return {
		notApplied: false,
		plans: rows.map((r) => {
			const c = counts.get(r.id) ?? { open: 0, overdue: 0, done: 0, total: 0 };
			return { ...r, person_name: nm(r.person) ?? '—', person_email: r.person?.email ?? '', manager_name: nm(r.manager), job_role: r.person?.job_role ?? null, open_items: c.open, overdue_items: c.overdue, done_items: c.done, total_items: c.total };
		}),
	};
}

export async function loadOnboardingPlan(db: Db, profileId: string): Promise<{ plan: OnboardingPlanRow | null; items: OnboardingItemRow[]; checkins: OnboardingCheckinRow[]; disc: DiscResponseRow | null; notApplied: boolean }> {
	const { data, error } = await db.from('hire_onboarding_plans').select('*').eq('profile_id', profileId).maybeSingle();
	if (error) return { plan: null, items: [], checkins: [], disc: null, notApplied: isNotApplied(error) };
	const plan = (data as OnboardingPlanRow | null) ?? null;
	const [items, checkins, disc] = await Promise.all([
		plan ? db.from('hire_onboarding_items').select('*').eq('plan_id', plan.id).order('phase').order('sort') : Promise.resolve({ data: [] }),
		plan ? db.from('hire_onboarding_checkins').select('*').eq('plan_id', plan.id).order('day_no', { ascending: false }) : Promise.resolve({ data: [] }),
		db.from('hire_disc_responses').select('id, candidate_id, profile_id, source, provider, scores, style, summary_md, completed_at, entered_by').eq('profile_id', profileId).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
	]);
	return { plan, items: (items.data ?? []) as OnboardingItemRow[], checkins: (checkins.data ?? []) as OnboardingCheckinRow[], disc: (disc.data as DiscResponseRow | null) ?? null, notApplied: false };
}

export async function loadOnboardingTemplates(db: Db): Promise<OnboardingTemplateRow[]> {
	const { data } = await db.from('hire_onboarding_templates').select('*').order('phase').order('sort');
	return (data ?? []) as OnboardingTemplateRow[];
}

export async function loadDiscQuestions(db: Db): Promise<{ id: number; d_word: string; i_word: string; s_word: string; c_word: string }[]> {
	const { data } = await db.from('hire_disc_questions').select('id, d_word, i_word, s_word, c_word').eq('is_active', true).order('id');
	return (data ?? []) as { id: number; d_word: string; i_word: string; s_word: string; c_word: string }[];
}

export interface AttendancePolicyRow {
	id: string;
	key: string;
	label: string;
	region: 'us' | 'os' | 'any';
	employment: string[];
	accrual_days_per_year: number;
	accrual_method: 'daily' | 'monthly' | 'upfront' | 'none';
	waiting_period_days: number;
	carryover_max_days: number;
	sick_days_per_year: number;
	holidays: { date: string; label?: string }[];
	work_days: number[];
	is_default: boolean;
	is_active: boolean;
	notes_md: string | null;
}

export interface AttendanceEventRow {
	id: string;
	profile_id: string;
	on_date: string;
	kind: string;
	hours: number | null;
	note: string | null;
	recorded_by: string | null;
	created_at: string;
}

export interface TimeOffRow {
	id: string;
	user_id: string;
	starts_on: string;
	ends_on: string;
	kind: string;
	status: string;
	notes: string | null;
	source: string | null;
	counts_as_pto: boolean;
}

export async function loadAttendancePolicies(db: Db): Promise<{ policies: AttendancePolicyRow[]; notApplied: boolean }> {
	const { data, error } = await db.from('attendance_policies').select('*').order('is_default', { ascending: false }).order('label');
	if (error) return { policies: [], notApplied: isNotApplied(error) };
	return { policies: ((data ?? []) as AttendancePolicyRow[]).map((p) => ({ ...p, accrual_days_per_year: Number(p.accrual_days_per_year), carryover_max_days: Number(p.carryover_max_days), sick_days_per_year: Number(p.sick_days_per_year) })), notApplied: false };
}

export async function loadAttendanceSummary(db: Db, year: number, asOf?: string): Promise<{ rows: AttendanceSummaryRow[]; notApplied: boolean; error: string | null }> {
	const { data, error } = await db.rpc('attendance_summary', { p_year: year, p_as_of: asOf ?? new Date().toISOString().slice(0, 10) });
	if (error) return { rows: [], notApplied: isNotApplied(error) || /function .* does not exist/i.test(error.message), error: error.message };
	const num = (v: unknown) => (v == null ? 0 : Number(v));
	return {
		notApplied: false,
		error: null,
		rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
			...(r as unknown as AttendanceSummaryRow),
			accrual_days_per_year: r.accrual_days_per_year == null ? null : Number(r.accrual_days_per_year),
			accrued_days: num(r.accrued_days),
			opening_days: num(r.opening_days),
			adjustment_days: num(r.adjustment_days),
			used_pto_days: num(r.used_pto_days),
			pending_pto_days: num(r.pending_pto_days),
			sick_days: num(r.sick_days),
			unpaid_days: num(r.unpaid_days),
			late_count: num(r.late_count),
			balance_days: num(r.balance_days),
		})),
	};
}

/** Time off + attendance events in a year, for the grid / a person's tab. */
export async function loadAttendanceYear(db: Db, year: number, profileId?: string): Promise<{ timeOff: TimeOffRow[]; events: AttendanceEventRow[] }> {
	let t = db.from('time_off').select('id, user_id, starts_on, ends_on, kind, status, notes, source, counts_as_pto').lte('starts_on', `${year}-12-31`).gte('ends_on', `${year}-01-01`).order('starts_on').limit(3000);
	let e = db.from('attendance_events').select('*').gte('on_date', `${year}-01-01`).lte('on_date', `${year}-12-31`).order('on_date').limit(3000);
	if (profileId) {
		t = t.eq('user_id', profileId);
		e = e.eq('profile_id', profileId);
	}
	const [to, ev] = await Promise.all([t, e]);
	return { timeOff: ((to.data ?? []) as TimeOffRow[]).map((r) => ({ ...r, counts_as_pto: r.counts_as_pto ?? true })), events: ((ev.data ?? []) as AttendanceEventRow[]).map((r) => ({ ...r, hours: r.hours == null ? null : Number(r.hours) })) };
}

// ---------------------------------------------------------------- quality of hire (0135)

const numify = <T extends object>(r: T, keys: (keyof T)[]): T => {
	const out: Record<string, unknown> = { ...(r as Record<string, unknown>) };
	for (const k of keys) if (out[k as string] != null) out[k as string] = Number(out[k as string]);
	return out as T;
};

export async function loadQuality(db: Db, f: { from?: string | null; to?: string | null } = {}): Promise<{ hires: QualityHireRow[]; funnel: QualityFunnelRow[]; sources: QualitySourceRow[]; interviewers: QualityInterviewerRow[]; notApplied: boolean; error: string | null }> {
	const [h, fu, s, i] = await Promise.all([
		db.rpc('hire_quality_hires', { p_from: f.from ?? null, p_to: f.to ?? null }),
		db.rpc('hire_quality_funnel'),
		db.rpc('hire_quality_sources'),
		db.rpc('hire_quality_interviewers'),
	]);
	const err = h.error ?? fu.error ?? s.error ?? i.error;
	if (err) return { hires: [], funnel: [], sources: [], interviewers: [], notApplied: isNotApplied(err) || /function .* does not exist/i.test(err.message), error: err.message };
	return {
		notApplied: false,
		error: null,
		hires: ((h.data ?? []) as QualityHireRow[]).map((r) => numify(r, ['calibration_latest', 'calibration_avg', 'scorecard_avg', 'overall_score', 'days_employed', 'advancements', 'contributions', 'contributions_open', 'time_to_hire_days'])),
		funnel: ((fu.data ?? []) as QualityFunnelRow[]).map((r) => numify(r, ['median_time_to_hire_days', 'avg_time_to_hire_days', 'posting_cost_cents', 'cost_per_hire_cents', 'avg_overall_score', 'avg_overall_hired'])),
		sources: ((s.data ?? []) as QualitySourceRow[]).map((r) => numify(r, ['avg_overall', 'avg_integrity', 'posting_cost_cents', 'cost_per_hire_cents'])),
		interviewers: ((i.data ?? []) as QualityInterviewerRow[]).map((r) => numify(r, ['avg_score', 'accuracy_pct', 'avg_score_hired', 'avg_score_rejected'])),
	};
}

export async function loadLevelHistory(db: Db, profileId: string): Promise<{ id: number; field: string; from_value: string | null; to_value: string | null; is_advancement: boolean; actor_id: string | null; changed_at: string }[]> {
	const { data } = await db.from('hire_level_history').select('id, field, from_value, to_value, is_advancement, actor_id, changed_at').eq('profile_id', profileId).order('changed_at', { ascending: false }).limit(100);
	return (data ?? []) as { id: number; field: string; from_value: string | null; to_value: string | null; is_advancement: boolean; actor_id: string | null; changed_at: string }[];
}
