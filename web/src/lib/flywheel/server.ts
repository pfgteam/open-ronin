// Flywheel server readers (0136+). Server-only: every function takes the
// caller's Supabase client so RLS (can_view_flywheel) decides what comes
// back. Pages render from these; actions.ts writes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelRow, CitationRow, ClusterRow, DeliverableRow, EventRow, FactRow, MemberRole, MemberRow, PackageTemplateRow, PageRow, ProgramAgentRow, ProgramRow, QueueRow, StudioItem, VideoRow } from './shared';
import type { DraftRow } from './production';
import type { PortalUserRow, StaffApprovalRow, StaffNoteRow } from '@/app/(app)/flywheel/PortalPanels';
import { DEFAULT_AUTO_APPROVE } from './shared';

type Db = SupabaseClient;

export function isNotApplied(e: { code?: string; message?: string } | null | undefined): boolean {
	if (!e) return false;
	return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
}

export interface FlywheelConfig {
	notApplied: boolean;
	packages: PackageTemplateRow[];
	channels: ChannelRow[];
	settings: Record<string, unknown>;
}

export async function loadFlywheelConfig(db: Db): Promise<FlywheelConfig> {
	const [packages, channels, settings] = await Promise.all([
		db.from('fw_package_templates').select('*').order('sort'),
		db.from('fw_channels').select('*').order('sort'),
		db.from('fw_settings').select('key, value'),
	]);
	if (isNotApplied(packages.error) || isNotApplied(channels.error)) return { notApplied: true, packages: [], channels: [], settings: {} };
	const map: Record<string, unknown> = {};
	for (const s of (settings.data ?? []) as { key: string; value: unknown }[]) map[s.key] = s.value;
	return { notApplied: false, packages: (packages.data ?? []) as PackageTemplateRow[], channels: (channels.data ?? []) as ChannelRow[], settings: map };
}

function normProgram(p: ProgramRow): ProgramRow {
	return { ...p, competitors: p.competitors ?? [], keywords: p.keywords ?? [], access: p.access ?? {}, auto_approve: { ...DEFAULT_AUTO_APPROVE, ...(p.auto_approve ?? {}) }, locked_prompts: p.locked_prompts ?? [], keyword_hypotheses: p.keyword_hypotheses ?? [] };
}

export interface ProgramListRow extends ProgramRow {
	client_name: string;
	clusters: number;
	open_cluster: ClusterRow | null;
	members: MemberRow[];
}

export async function loadPrograms(db: Db, opts: { status?: 'open' | 'all'; clientId?: string } = {}): Promise<ProgramListRow[]> {
	let q = db.from('fw_programs').select('*, client:clients_v2!fw_programs_client_id_fkey(display_name)').order('created_at', { ascending: false });
	if (opts.status !== 'all') q = q.in('status', ['onboarding', 'active', 'paused']);
	if (opts.clientId) q = q.eq('client_id', opts.clientId);
	const { data } = await q;
	const rows = ((data ?? []) as unknown as (ProgramRow & { client: { display_name: string } | null })[]).map((r) => ({ ...normProgram(r), client_name: r.client?.display_name ?? 'Client' }));
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const [{ data: clusters }, { data: members }] = await Promise.all([
		db.from('fw_clusters').select('*').in('program_id', ids).order('number', { ascending: false }),
		db.from('fw_program_members').select('program_id, user_id, role, profile:profiles!fw_program_members_user_id_fkey(first_name, last_name, email)').in('program_id', ids),
	]);
	const cl = (clusters ?? []) as ClusterRow[];
	const mem = ((members ?? []) as unknown as { program_id: string; user_id: string; role: MemberRow['role']; profile: { first_name: string | null; last_name: string | null; email: string } | null }[]).map((m) => ({ program_id: m.program_id, user_id: m.user_id, role: m.role, name: [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(' ') || m.profile?.email, email: m.profile?.email }));
	return rows.map((r) => {
		const mine = cl.filter((c) => c.program_id === r.id);
		return { ...r, clusters: mine.length, open_cluster: mine.find((c) => c.status !== 'closed') ?? mine[0] ?? null, members: mem.filter((m) => m.program_id === r.id) };
	});
}

export interface ProgramBundle {
	program: ProgramRow;
	client_name: string;
	members: MemberRow[];
	clusters: ClusterRow[];
	pages: PageRow[];
	citations: CitationRow[];
	facts: FactRow[];
	videos: VideoRow[];
	deliverables: DeliverableRow[];
	events: EventRow[];
}

export async function loadProgram(db: Db, id: string): Promise<ProgramBundle | null> {
	const { data } = await db.from('fw_programs').select('*, client:clients_v2!fw_programs_client_id_fkey(display_name)').eq('id', id).maybeSingle();
	const p = data as unknown as (ProgramRow & { client: { display_name: string } | null }) | null;
	if (!p) return null;
	const [members, clusters, pages, citations, facts, videos, deliverables, events] = await Promise.all([
		db.from('fw_program_members').select('program_id, user_id, role, profile:profiles!fw_program_members_user_id_fkey(first_name, last_name, email)').eq('program_id', id),
		db.from('fw_clusters').select('*').eq('program_id', id).order('number'),
		db.from('fw_pages').select('*').eq('program_id', id).order('number'),
		db.from('fw_citations').select('*').eq('program_id', id).order('created_at'),
		db.from('fw_facts').select('*').eq('program_id', id).order('sort').order('created_at'),
		db.from('fw_videos').select('*').eq('program_id', id).order('month', { ascending: false }),
		db.from('client_deliverables').select('*').eq('program_id', id).order('period_month', { ascending: false }).order('created_at'),
		db.from('fw_events').select('*').eq('program_id', id).order('created_at', { ascending: false }).limit(200),
	]);
	return {
		program: normProgram(p),
		client_name: p.client?.display_name ?? 'Client',
		members: ((members.data ?? []) as unknown as { program_id: string; user_id: string; role: MemberRow['role']; profile: { first_name: string | null; last_name: string | null; email: string } | null }[]).map((m) => ({ program_id: m.program_id, user_id: m.user_id, role: m.role, name: [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(' ') || m.profile?.email, email: m.profile?.email })),
		clusters: (clusters.data ?? []) as ClusterRow[],
		pages: ((pages.data ?? []) as PageRow[]).map((r) => ({ ...r, internal_links: r.internal_links ?? [] })),
		citations: ((citations.data ?? []) as CitationRow[]).map((r) => ({ ...r, models_surfacing: r.models_surfacing ?? [], cross_links: r.cross_links ?? [] })),
		facts: (facts.data ?? []) as FactRow[],
		videos: ((videos.data ?? []) as VideoRow[]).map((v) => ({ ...v, chapters: v.chapters ?? [], checklist: v.checklist ?? [], shorts_cut_list: v.shorts_cut_list ?? [] })),
		deliverables: (deliverables.data ?? []) as DeliverableRow[],
		events: (events.data ?? []) as EventRow[],
	};
}

export async function loadPage(db: Db, pageId: string): Promise<{ page: PageRow; citations: CitationRow[]; facts: FactRow[] } | null> {
	const { data } = await db.from('fw_pages').select('*').eq('id', pageId).maybeSingle();
	const page = data as PageRow | null;
	if (!page) return null;
	const [{ data: citations }, { data: facts }] = await Promise.all([
		db.from('fw_citations').select('*').eq('page_id', pageId).order('channel_key').order('created_at'),
		db.from('fw_facts').select('*').eq('program_id', page.program_id).neq('status', 'retired').order('sort'),
	]);
	return { page: { ...page, internal_links: page.internal_links ?? [] }, citations: ((citations ?? []) as CitationRow[]).map((r) => ({ ...r, models_surfacing: r.models_surfacing ?? [], cross_links: r.cross_links ?? [] })), facts: (facts ?? []) as FactRow[] };
}

/** Every deliverable for one client, grouped by package tab (the client page + the portal read this). */
export async function loadClientDeliverables(db: Db, clientId: string): Promise<{ notApplied: boolean; programs: ProgramRow[]; deliverables: DeliverableRow[] }> {
	const [programs, deliverables] = await Promise.all([
		db.from('fw_programs').select('*').eq('client_id', clientId).order('created_at'),
		db.from('client_deliverables').select('*').eq('client_id', clientId).order('period_month', { ascending: false }).order('created_at'),
	]);
	if (isNotApplied(programs.error)) return { notApplied: true, programs: [], deliverables: [] };
	return { notApplied: false, programs: ((programs.data ?? []) as ProgramRow[]).map(normProgram), deliverables: (deliverables.data ?? []) as DeliverableRow[] };
}

/** Flywheel clients = active/hold contracts whose package names AEO Flywheel, for the "start a program" picker. */
export async function loadFlywheelContracts(db: Db): Promise<{ id: string; client_id: string; client_name: string; package: string; per_month_cents: number | null; starts_on: string | null; status: string; has_program: boolean }[]> {
	const [{ data: contracts }, { data: programs }] = await Promise.all([
		db.from('contracts').select('id, client_id, package, per_month_cents, starts_on, status, client:clients_v2!contracts_client_id_fkey(display_name)').in('status', ['active', 'hold', '60-day', '30-day']).order('starts_on', { ascending: false }),
		db.from('fw_programs').select('contract_id'),
	]);
	const have = new Set(((programs ?? []) as { contract_id: string | null }[]).map((p) => p.contract_id).filter(Boolean));
	return ((contracts ?? []) as unknown as { id: string; client_id: string; package: string | null; per_month_cents: number | null; starts_on: string | null; status: string; client: { display_name: string } | null }[]).map((c) => ({ id: c.id, client_id: c.client_id, client_name: c.client?.display_name ?? 'Client', package: c.package ?? '', per_month_cents: c.per_month_cents, starts_on: c.starts_on, status: c.status, has_program: have.has(c.id) }));
}

export async function loadTeamPickList(db: Db): Promise<{ id: string; name: string }[]> {
	const { data } = await db.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name');
	return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string }[]).map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email }));
}

// ---------------------------------------------------------------- F2: onboarding + intake

export interface OnboardingTask {
	id: string;
	title: string;
	status: string;
	priority: string | null;
	assignee_id: string | null;
	assignee_name: string | null;
	due_at: string | null;
	completed_at: string | null;
	is_lead_indicator: boolean;
	position: number;
	phase: string;
	intake_key: string | null;
}

export interface OnboardingBundle {
	project_id: string | null;
	tasks: OnboardingTask[];
	progress: { total: number; done: number; overdue: number; phases: { phase: string; total: number; done: number; overdue: number }[] } | null;
}

export async function loadOnboarding(db: Db, program: Pick<ProgramRow, 'id' | 'onboarding_project_id'>): Promise<OnboardingBundle> {
	if (!program.onboarding_project_id) return { project_id: null, tasks: [], progress: null };
	const [{ data: tasks }, { data: progress }] = await Promise.all([
		db.from('tasks').select('id, title, status, priority, assignee_id, due_at, completed_at, is_lead_indicator, position, tags, assignee:profiles!tasks_assignee_id_fkey(first_name, last_name)').eq('project_id', program.onboarding_project_id).order('position'),
		db.rpc('fw_onboarding_progress', { p_program: program.id }),
	]);
	type T = { id: string; title: string; status: string; priority: string | null; assignee_id: string | null; due_at: string | null; completed_at: string | null; is_lead_indicator: boolean; position: number; tags: string[]; assignee: { first_name: string | null; last_name: string | null } | null };
	return {
		project_id: program.onboarding_project_id,
		tasks: ((tasks ?? []) as unknown as T[]).map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			assignee_id: t.assignee_id,
			assignee_name: t.assignee ? [t.assignee.first_name, t.assignee.last_name].filter(Boolean).join(' ') : null,
			due_at: t.due_at,
			completed_at: t.completed_at,
			is_lead_indicator: t.is_lead_indicator,
			position: t.position,
			phase: (t.tags ?? []).find((x) => x.startsWith('phase:'))?.slice(6) ?? 'Other',
			intake_key: (t.tags ?? []).find((x) => x.startsWith('intake:'))?.slice(7) ?? null,
		})),
		progress: (progress as OnboardingBundle['progress']) ?? null,
	};
}

export interface IntakeSessionRow {
	id: string;
	program_id: string;
	kind: string;
	opened_by: 'internal' | 'client';
	status: string;
	step: number;
	answers: Record<string, unknown>;
	transcript: { role: string; text: string; at: string }[];
	submitted_at: string | null;
	applied_at: string | null;
	expires_at: string;
	created_at: string;
	has_token: boolean;
}

export interface IntakeExtractRow {
	id: string;
	program_id: string;
	source: string;
	call_id: string | null;
	input_md: string | null;
	extract: Record<string, unknown>;
	model: string | null;
	status: string;
	applied_at: string | null;
	created_at: string;
}

export async function loadIntake(db: Db, programId: string): Promise<{ sessions: IntakeSessionRow[]; extracts: IntakeExtractRow[]; calls: { id: string; occurred_at: string; call_type: string; has_transcript: boolean }[] }> {
	const [{ data: sessions }, { data: extracts }] = await Promise.all([
		db.from('fw_intake_sessions').select('id, program_id, kind, opened_by, status, step, answers, transcript, submitted_at, applied_at, expires_at, created_at, token_hash').eq('program_id', programId).order('created_at', { ascending: false }),
		db.from('fw_intake_extracts').select('*').eq('program_id', programId).order('created_at', { ascending: false }),
	]);
	const { data: prog } = await db.from('fw_programs').select('client_id').eq('id', programId).maybeSingle();
	const clientId = (prog as { client_id: string } | null)?.client_id;
	const { data: calls } = clientId ? await db.from('calls').select('id, occurred_at, call_type, transcript:call_transcripts(call_id)').eq('client_id', clientId).order('occurred_at', { ascending: false }).limit(20) : { data: [] };
	type C = { id: string; occurred_at: string; call_type: string; transcript: { call_id: string }[] | { call_id: string } | null };
	return {
		sessions: ((sessions ?? []) as unknown as (Omit<IntakeSessionRow, 'has_token'> & { token_hash: string | null })[]).map(({ token_hash, ...s }) => ({ ...s, answers: s.answers ?? {}, transcript: s.transcript ?? [], has_token: !!token_hash })),
		extracts: (extracts ?? []) as IntakeExtractRow[],
		calls: ((calls ?? []) as unknown as C[]).map((c) => ({ id: c.id, occurred_at: c.occurred_at, call_type: c.call_type, has_transcript: Array.isArray(c.transcript) ? c.transcript.length > 0 : !!c.transcript })),
	};
}

// ---------------------------------------------------------------- F3: audit

export interface PromptRow {
	id: string;
	program_id: string;
	position: number;
	prompt: string;
	stage: string | null;
	keyword: string | null;
	is_locked: boolean;
	locked_at: string | null;
	retired_at: string | null;
}

export interface AuditRunRow {
	id: string;
	program_id: string;
	cluster_id: string | null;
	kind: 'baseline' | 'monthly' | 'reaudit' | 'adhoc';
	status: 'queued' | 'running' | 'done' | 'failed' | 'capped' | 'cancelled';
	period_month: string;
	model_ids: string[];
	prompt_ids: string[];
	competitors: string[];
	estimate_usd: number | null;
	actual_usd: number;
	answers_total: number;
	answers_done: number;
	answers_failed: number;
	presence_rate: number | null;
	core_presence_rate: number | null;
	avg_position: number | null;
	sentiment_score: number | null;
	accuracy_rate: number | null;
	sov: number | null;
	misinfo_count: number;
	per_competitor: Record<string, number>;
	started_at: string | null;
	finished_at: string | null;
	error: string | null;
	created_at: string;
}

export interface AuditScoreRow {
	run_id: string;
	prompt_id: string;
	models: number;
	present: number;
	core_models: number;
	core_present: number;
	avg_position: number | null;
	sentiment_score: number | null;
	accuracy_rate: number | null;
	sov: number | null;
	misinfo_count: number;
}

export interface AuditAnswerRow {
	id: string;
	prompt_id: string;
	model_id: string;
	status: string;
	answer_md: string | null;
	cost_usd: number;
	presence: boolean | null;
	presence_how: string | null;
	sentiment: string | null;
	accuracy: string | null;
	position: number | null;
	competitors_named: string[];
	misinformation: string[];
	judge_notes: string | null;
	error: string | null;
}

export interface AuditBundle {
	prompts: PromptRow[];
	runs: AuditRunRow[];
	latest: AuditRunRow | null;
	latestScores: AuditScoreRow[];
	panel: { total: number; in_panel: number; core: number; coreIds: string[] };
	connection: { enabled: boolean; has_key: boolean; cap: number; used: number; last_sync: string | null } | null;
}

export async function loadAudit(db: Db, programId: string): Promise<AuditBundle> {
	const [{ data: prompts }, { data: runs }, { data: models }] = await Promise.all([
		db.from('fw_audit_prompts').select('*').eq('program_id', programId).order('position'),
		db.from('fw_audit_runs').select('*').eq('program_id', programId).order('created_at', { ascending: false }).limit(24),
		db.from('fw_ai_models').select('id, is_core, in_panel').eq('is_active', true),
	]);
	const rs = ((runs ?? []) as AuditRunRow[]).map((r) => ({ ...r, model_ids: r.model_ids ?? [], prompt_ids: r.prompt_ids ?? [], competitors: r.competitors ?? [], per_competitor: r.per_competitor ?? {}, estimate_usd: r.estimate_usd == null ? null : Number(r.estimate_usd), actual_usd: Number(r.actual_usd ?? 0), presence_rate: num(r.presence_rate), core_presence_rate: num(r.core_presence_rate), avg_position: num(r.avg_position), sentiment_score: num(r.sentiment_score), accuracy_rate: num(r.accuracy_rate), sov: num(r.sov) }));
	const latest = rs.find((r) => r.status === 'done') ?? null;
	const { data: scores } = latest ? await db.from('fw_audit_scores').select('*').eq('run_id', latest.id) : { data: [] };
	const ms = (models ?? []) as { id: string; is_core: boolean; in_panel: boolean }[];
	// connection presence only (never the key); contributors cannot read the row, so this reads null for them.
	const { data: conn } = await db.from('fw_ai_connections').select('is_enabled, encrypted_api_key, monthly_cap_usd, spend_month_usd, last_models_sync_at').eq('provider', 'nous').maybeSingle();
	const c = conn as { is_enabled: boolean; encrypted_api_key: string | null; monthly_cap_usd: number; spend_month_usd: number; last_models_sync_at: string | null } | null;
	return {
		prompts: (prompts ?? []) as PromptRow[],
		runs: rs,
		latest,
		latestScores: ((scores ?? []) as AuditScoreRow[]).map((s) => ({ ...s, avg_position: num(s.avg_position), sentiment_score: num(s.sentiment_score), accuracy_rate: num(s.accuracy_rate), sov: num(s.sov) })),
		panel: { total: ms.length, in_panel: ms.filter((m) => m.in_panel).length, core: ms.filter((m) => m.is_core).length, coreIds: ms.filter((m) => m.is_core).map((m) => m.id) },
		connection: c ? { enabled: c.is_enabled, has_key: !!c.encrypted_api_key, cap: Number(c.monthly_cap_usd), used: Number(c.spend_month_usd), last_sync: c.last_models_sync_at } : null,
	};
}

export async function loadAuditAnswers(db: Db, runId: string): Promise<AuditAnswerRow[]> {
	const { data } = await db.from('fw_audit_answers').select('id, prompt_id, model_id, status, answer_md, cost_usd, presence, presence_how, sentiment, accuracy, position, competitors_named, misinformation, judge_notes, error').eq('run_id', runId).order('model_id');
	return ((data ?? []) as AuditAnswerRow[]).map((a) => ({ ...a, cost_usd: Number(a.cost_usd ?? 0), competitors_named: a.competitors_named ?? [], misinformation: a.misinformation ?? [] }));
}

function num(v: unknown): number | null {
	return v == null ? null : Number(v);
}

// ---------------------------------------------------------------- F4: drafts, queue, agents

export async function loadDrafts(db: Db, programId: string, opts: { targetId?: string; limit?: number } = {}): Promise<DraftRow[]> {
	let q = db.from('fw_drafts').select('*').eq('program_id', programId).order('created_at', { ascending: false }).limit(opts.limit ?? 60);
	if (opts.targetId) q = q.eq('target_id', opts.targetId);
	const { data } = await q;
	return ((data ?? []) as DraftRow[]).map((d) => ({ ...d, input: d.input ?? {}, cost_usd: d.cost_usd == null ? null : Number(d.cost_usd) }));
}

export async function loadReviewInbox(db: Db): Promise<{ draft_id: string; program_id: string; client_name: string; kind: string; title: string | null; status: string; lane: string; created_at: string; my_role: string | null }[]> {
	const { data } = await db.rpc('fw_review_inbox');
	return (data ?? []) as { draft_id: string; program_id: string; client_name: string; kind: string; title: string | null; status: string; lane: string; created_at: string; my_role: string | null }[];
}

export async function loadDraftsByIds(db: Db, ids: string[]): Promise<DraftRow[]> {
	if (ids.length === 0) return [];
	const { data } = await db.from('fw_drafts').select('*').in('id', ids);
	return ((data ?? []) as DraftRow[]).map((d) => ({ ...d, input: d.input ?? {}, cost_usd: d.cost_usd == null ? null : Number(d.cost_usd) }));
}

export async function loadMyRoles(db: Db, userId: string): Promise<Map<string, MemberRole[]>> {
	const { data } = await db.from('fw_program_members').select('program_id, role').eq('user_id', userId);
	const m = new Map<string, MemberRole[]>();
	for (const r of (data ?? []) as { program_id: string; role: MemberRole }[]) m.set(r.program_id, [...(m.get(r.program_id) ?? []), r.role]);
	return m;
}

export async function loadPostingQueue(db: Db, opts: { programId?: string; status?: string[]; limit?: number } = {}): Promise<QueueRow[]> {
	let q = db.from('fw_posting_queue').select('*, citation:fw_citations!fw_posting_queue_citation_id_fkey(title, draft_md, page:fw_pages!fw_citations_page_id_fkey(number, keyword)), program:fw_programs!fw_posting_queue_program_id_fkey(client:clients_v2!fw_programs_client_id_fkey(display_name))').order('due_at', { ascending: true, nullsFirst: false }).limit(opts.limit ?? 200);
	if (opts.programId) q = q.eq('program_id', opts.programId);
	if (opts.status) q = q.in('status', opts.status);
	const { data } = await q;
	type R = QueueRow & { citation: { title: string | null; draft_md: string | null; page: { number: number; keyword: string } | null } | null; program: { client: { display_name: string } | null } | null };
	return ((data ?? []) as unknown as R[]).map(({ citation, program, ...r }) => ({ ...r, title: citation?.title ?? null, draft_md: citation?.draft_md ?? null, page_number: citation?.page?.number ?? null, page_keyword: citation?.page?.keyword ?? null, client_name: program?.client?.display_name ?? '' }));
}

// ---------------------------------------------------------------- F4b: studio + roster

export async function loadStudioItems(db: Db, opts: { programId?: string | null; from?: string; to?: string } = {}): Promise<StudioItem[]> {
	const { data } = await db.rpc('fw_studio_items', { p_program: opts.programId ?? null, p_from: opts.from ?? null, p_to: opts.to ?? null });
	return ((data ?? []) as StudioItem[]).sort((a, b) => (a.scheduled_for ?? a.due_at ?? a.updated_at).localeCompare(b.scheduled_for ?? b.due_at ?? b.updated_at));
}

export async function loadProgramAgents(db: Db, programId: string): Promise<ProgramAgentRow[]> {
	const { data } = await db.from('fw_program_agents').select('*').eq('program_id', programId);
	return (data ?? []) as ProgramAgentRow[];
}

// ---------------------------------------------------------------- F5: portal (staff side)

export async function loadPortalStaff(db: Db, clientId: string, programId: string | null): Promise<{ users: PortalUserRow[]; approvals: StaffApprovalRow[]; notes: StaffNoteRow[]; conn: { status: string; google_email: string | null; ga4_property_name: string | null; sc_site_url: string | null; last_pull_at: string | null; last_error: string | null } | null; contacts: { id: string; display_name: string; email: string | null }[] }> {
	const [{ data: users }, { data: approvals }, { data: notes }, { data: conn }, { data: cc }] = await Promise.all([
		db.from('fw_portal_users').select('user_id, client_id, email, display_name, is_primary, is_active, invited_at, first_seen_at, last_seen_at').eq('client_id', clientId).order('invited_at'),
		programId ? db.from('fw_approvals').select('id, kind, title, status, requested_at, due_at, decided_at, decided_by_label, client_comment, reminder_1_at, escalated_at').eq('program_id', programId).order('requested_at', { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
		db.from('fw_portal_notes').select('id, client_id, program_id, kind, title, body_md, meta, status, reply_md, internal_note, created_at, created_by_label').eq('client_id', clientId).order('created_at', { ascending: false }).limit(60),
		db.from('fw_google_connections').select('status, google_email, ga4_property_name, sc_site_url, last_pull_at, last_error').eq('client_id', clientId).maybeSingle(),
		db.from('client_contacts').select('contact:contacts!client_contacts_contact_id_fkey(id, display_name, email)').or(`client_id.eq.${clientId}`),
	]);
	type C = { contact: { id: string; display_name: string; email: string | null } | null };
	return {
		users: (users ?? []) as PortalUserRow[],
		approvals: (approvals ?? []) as StaffApprovalRow[],
		notes: ((notes ?? []) as StaffNoteRow[]).map((n) => ({ ...n, meta: n.meta ?? {} })),
		conn: (conn as { status: string; google_email: string | null; ga4_property_name: string | null; sc_site_url: string | null; last_pull_at: string | null; last_error: string | null } | null) ?? null,
		contacts: ((cc ?? []) as unknown as C[]).map((c) => c.contact).filter((c): c is { id: string; display_name: string; email: string | null } => !!c),
	};
}

export async function loadAllPortalNotes(db: Db, status: string[] = ['open', 'acknowledged', 'in_progress']): Promise<StaffNoteRow[]> {
	const { data } = await db.from('fw_portal_notes').select('id, client_id, program_id, kind, title, body_md, meta, status, reply_md, internal_note, created_at, created_by_label, client:clients_v2!fw_portal_notes_client_id_fkey(display_name)').in('status', status).order('created_at', { ascending: false }).limit(200);
	return ((data ?? []) as unknown as (StaffNoteRow & { client: { display_name: string } | null })[]).map(({ client, ...n }) => ({ ...n, meta: n.meta ?? {}, client_name: client?.display_name ?? '' }));
}
