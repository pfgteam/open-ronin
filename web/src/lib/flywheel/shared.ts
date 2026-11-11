// Flywheel Delivery System (0136+) vocabulary. No server imports: client
// forms, server readers and actions all read from here so labels and
// allowlists never drift from the SQL CHECKs.

export const FLYWHEEL_PATH = '/flywheel';
export const FLYWHEEL_ADMIN_PATH = '/admin/flywheel';

export const PROGRAM_STATUSES = ['onboarding', 'active', 'paused', 'closed'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];
export const PROGRAM_STATUS_LABELS: Record<ProgramStatus, string> = { onboarding: 'Onboarding', active: 'Active', paused: 'Paused', closed: 'Closed' };
export const PROGRAM_STATUS_COLORS: Record<ProgramStatus, BadgeColor> = { onboarding: 'primary', active: 'success', paused: 'warning', closed: 'default' };

export type BadgeColor = 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';

/** fw_agents.output_kind — must match the CHECK in 0143 (0142 list + humanize / site_keywords). One source for the admin editor and the save action. */
export const OUTPUT_KINDS = ['plan', 'keyword_research', 'visibility_report', 'page', 'citation', 'script', 'shorts', 'recap', 'report', 'humanize', 'site_keywords', 'other'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const MEMBER_ROLES = ['strategist', 'seo_tech', 'content', 'video', 'distribution', 'verifier', 'lane_flywheel', 'lane_writers', 'lane_pubs', 'lane_smm'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
	strategist: 'Strategist',
	seo_tech: 'SEO / Technical Lead',
	content: 'Content Lead',
	video: 'Video Producer / Editor',
	distribution: 'Distribution Specialist',
	verifier: 'Verifier (QA gate)',
	lane_flywheel: 'Approval lane: Flywheel',
	lane_writers: 'Approval lane: Writers',
	lane_pubs: 'Approval lane: Pubs (PR)',
	lane_smm: 'Approval lane: SMM',
};
/** What each role owns (SOP §8), shown next to the picker. */
export const MEMBER_ROLE_OWNS: Record<MemberRole, string> = {
	strategist: 'AI Search Audit, Keyword Cluster Strategy Plan, verifiable-facts list, topic approvals, monthly report, client communication',
	seo_tech: 'Technical foundation, schema, llms.txt, robots.txt, directory listings, quarterly technical refresh',
	content: 'Seed video script, all on-site pages, long-form off-site writing (Medium, LinkedIn, Quora, Reddit, FAQ syndication, podcast)',
	video: 'Seed video filming and edit, Shorts cutting, thumbnails, captions, YouTube upload',
	distribution: 'Publishing Reels / TikTok / Shorts, Quora and Reddit posting, FAQ-schema syndication, podcast distribution, Citation Ledger updates',
	verifier: 'Accountability and verification: the QA gate every asset passes before it goes to the client or live (Gabi)',
	lane_flywheel: 'Approves Flywheel drafts (plans, pages, citations, scripts) before verification (Riley)',
	lane_writers: 'Approves long-form writing drafts',
	lane_pubs: 'Approves PR placements / pitches',
	lane_smm: 'Approves social posts',
};
export const TEAM_ROLES: readonly MemberRole[] = ['strategist', 'seo_tech', 'content', 'video', 'distribution', 'verifier'];
export const LANE_ROLES: readonly MemberRole[] = ['lane_flywheel', 'lane_writers', 'lane_pubs', 'lane_smm'];

export const CLUSTER_STATUSES = ['planning', 'in_production', 'live', 'closed'] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];
export const CLUSTER_STATUS_LABELS: Record<ClusterStatus, string> = { planning: 'Planning', in_production: 'In production', live: 'Live', closed: 'Closed' };

export const PLAN_STATUSES = ['draft', 'in_review', 'verification', 'awaiting_client', 'approved', 'changes_requested'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
	draft: 'Draft',
	in_review: 'In review (lane)',
	verification: 'Verification (Gabi)',
	awaiting_client: 'Awaiting client',
	approved: 'Approved',
	changes_requested: 'Changes requested',
};
export const PLAN_STATUS_COLORS: Record<PlanStatus, BadgeColor> = {
	draft: 'default',
	in_review: 'primary',
	verification: 'accent',
	awaiting_client: 'warning',
	approved: 'success',
	changes_requested: 'danger',
};

export const PAGE_KINDS = ['pillar', 'question'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export const PAGE_KIND_LABELS: Record<PageKind, string> = { pillar: 'Pillar page', question: 'AEO question page' };

export const PAGE_STATUSES = ['planned', 'drafting', 'in_review', 'verification', 'awaiting_client', 'approved', 'changes_requested', 'handed_off', 'live'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];
export const PAGE_STATUS_LABELS: Record<PageStatus, string> = {
	planned: 'Planned',
	drafting: 'Drafting',
	in_review: 'In review (lane)',
	verification: 'Verification (Gabi)',
	awaiting_client: 'Awaiting client',
	approved: 'Approved',
	changes_requested: 'Changes requested',
	handed_off: 'Handed off to publish',
	live: 'Live',
};
export const PAGE_STATUS_COLORS: Record<PageStatus, BadgeColor> = {
	planned: 'default',
	drafting: 'default',
	in_review: 'primary',
	verification: 'accent',
	awaiting_client: 'warning',
	approved: 'success',
	changes_requested: 'danger',
	handed_off: 'primary',
	live: 'success',
};
/** Manual transitions the UI offers from each page status. */
export const PAGE_NEXT: Record<PageStatus, PageStatus[]> = {
	planned: ['drafting'],
	drafting: ['in_review'],
	in_review: ['verification', 'changes_requested'],
	verification: ['awaiting_client', 'approved', 'changes_requested'],
	awaiting_client: ['approved', 'changes_requested'],
	approved: ['handed_off', 'live'],
	changes_requested: ['drafting'],
	handed_off: ['live'],
	live: [],
};

export const CITATION_STATUSES = ['planned', 'drafting', 'in_review', 'verification', 'approved', 'queued', 'posted', 'live', 'rejected', 'removed'] as const;
export type CitationStatus = (typeof CITATION_STATUSES)[number];
export const CITATION_STATUS_LABELS: Record<CitationStatus, string> = {
	planned: 'Planned',
	drafting: 'Drafting',
	in_review: 'In review',
	verification: 'Verification',
	approved: 'Approved',
	queued: 'Queued to post',
	posted: 'Posted',
	live: 'Live (verified)',
	rejected: 'Rejected',
	removed: 'Removed',
};
export const CITATION_STATUS_COLORS: Record<CitationStatus, BadgeColor> = {
	planned: 'default',
	drafting: 'default',
	in_review: 'primary',
	verification: 'accent',
	approved: 'success',
	queued: 'primary',
	posted: 'success',
	live: 'success',
	rejected: 'danger',
	removed: 'danger',
};
export const SHIPPED_CITATION: readonly CitationStatus[] = ['posted', 'live'];

export const POSTER_KINDS = ['person', 'network', 'fourth_pillar'] as const;
export type PosterKind = (typeof POSTER_KINDS)[number];
export const POSTER_KIND_LABELS: Record<PosterKind, string> = { person: 'Posted by a person', network: 'Open Ronin owned network', fourth_pillar: 'Fourth Pillar media boost' };

export const VIDEO_STATUSES = ['planned', 'script_ready', 'scheduled', 'recorded', 'edited', 'published'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
	planned: 'Planned',
	script_ready: 'Script ready',
	scheduled: 'Shoot scheduled',
	recorded: 'Recorded',
	edited: 'Edited',
	published: 'Published',
};

export const FACT_STATUSES = ['proposed', 'verified', 'retired'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const DELIVERABLE_STATUSES = ['planned', 'in_progress', 'in_review', 'awaiting_client', 'approved', 'delivered', 'skipped'] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
	planned: 'Planned',
	in_progress: 'In progress',
	in_review: 'In review',
	awaiting_client: 'Awaiting you',
	approved: 'Approved',
	delivered: 'Delivered',
	skipped: 'Skipped',
};
export const DELIVERABLE_STATUS_COLORS: Record<DeliverableStatus, BadgeColor> = {
	planned: 'default',
	in_progress: 'primary',
	in_review: 'accent',
	awaiting_client: 'warning',
	approved: 'success',
	delivered: 'success',
	skipped: 'default',
};

// ---------------------------------------------------------------- rows

export interface PackageTemplateRow {
	key: string;
	label: string;
	description: string | null;
	sort: number;
	is_active: boolean;
	scope: PackageScope;
	sla: Record<string, number>;
	setup_fee_cents: number | null;
	monthly_fee_cents: number | null;
	deliverable_kinds: string[];
	uses_media_opps: boolean;
}

export interface PackageScope {
	per_month?: { pages_min?: number; pages_max?: number; citations_min?: number; citations_max?: number; ai_rescan?: number; report?: number; report_call_minutes?: number };
	per_cluster?: { days?: number; seed_videos?: number; pages?: number; pillar_pages_min?: number; pillar_pages_max?: number; question_pages?: number; citations_min?: number; citations_max?: number; citations_per_page_min?: number; citations_per_page_max?: number; reaudit?: number; podcast_episodes?: number };
	per_year?: { seed_videos?: number; pages?: number; citations_min?: number; citations_max?: number };
	pillar_words?: { min: number; max: number };
	question_words?: { min: number; max: number };
	seed_video?: { runtime_min?: number; runtime_max?: number; chapters?: number; session_minutes?: number; cadence?: string };
	audit?: { prompts?: number; core_models?: number; competitors?: number; scores?: string[]; monthly_rescan?: boolean; full_reaudit_days?: number };
	facts_min?: number;
	facts_max?: number;
	note?: string;
}

export interface ChannelRow {
	key: string;
	label: string;
	sort: number;
	per_page_min: number;
	per_page_max: number;
	per_cluster: number;
	why: string | null;
	non_promotional: boolean;
	poster_default: PosterKind;
	is_active: boolean;
}

export interface AutoApprove {
	plans: { enabled: boolean; business_days: number };
	content: { enabled: boolean; business_days: number };
}
export const DEFAULT_AUTO_APPROVE: AutoApprove = { plans: { enabled: false, business_days: 3 }, content: { enabled: false, business_days: 2 } };

export interface ProgramAccess {
	gbp?: boolean;
	search_console?: boolean;
	analytics?: boolean;
	site_backend?: boolean;
	notes?: string;
}

export interface ProgramRow {
	id: string;
	client_id: string;
	contract_id: string | null;
	rev_contract_id: string | null;
	package_key: string;
	label: string | null;
	status: ProgramStatus;
	is_internal_pilot: boolean;
	setup_fee_cents: number | null;
	monthly_fee_cents: number | null;
	setup_paid_on: string | null;
	kickoff_on: string | null;
	first_set_live_on: string | null;
	paused_on: string | null;
	closed_on: string | null;
	brand_name: string | null;
	primary_url: string | null;
	competitors: string[];
	keywords: string[];
	icp_md: string | null;
	sme_name: string | null;
	sme_email: string | null;
	sme_phone: string | null;
	dev_contact: string | null;
	access: ProgramAccess;
	drive_hub_url: string | null;
	tracker_sheet_url: string | null;
	auto_approve: AutoApprove;
	notes_md: string | null;
	// F2 (0137)
	onboarding_project_id: string | null;
	locked_prompts: string[];
	keyword_hypotheses: { keyword: string; why?: string; source?: string }[];
	angles_md: string | null;
	discovery_call_id: string | null;
	intake_completed_at: string | null;
	// prompt library (0145)
	voice_md: string | null;
	brand_facts_md: string | null;
	cta_md: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface MemberRow {
	program_id: string;
	user_id: string;
	role: MemberRole;
	name?: string;
	email?: string;
}

export interface ClusterRow {
	id: string;
	program_id: string;
	number: number;
	anchor_keyword: string | null;
	title: string | null;
	status: ClusterStatus;
	plan_status: PlanStatus;
	plan_md: string | null;
	plan_sent_at: string | null;
	plan_auto_approve_at: string | null;
	plan_approved_at: string | null;
	plan_approved_by: string | null;
	plan_loom_url: string | null;
	starts_on: string | null;
	ends_on: string | null;
	reaudit_due_on: string | null;
	audit_run_id: string | null;
	notes_md: string | null;
	created_at: string;
	updated_at: string;
}

export interface PageRow {
	id: string;
	program_id: string;
	cluster_id: string;
	number: number;
	kind: PageKind;
	keyword: string;
	title: string | null;
	chapter_index: number | null;
	chapter_title: string | null;
	video_id: string | null;
	word_target_min: number | null;
	word_target_max: number | null;
	status: PageStatus;
	body_md: string | null;
	quick_answer_md: string | null;
	faq_schema: unknown;
	internal_links: string[];
	meta_title: string | null;
	sent_to_client_at: string | null;
	auto_approve_at: string | null;
	approved_at: string | null;
	approved_by: string | null;
	verified_by: string | null;
	verified_at: string | null;
	handed_off_at: string | null;
	handed_off_to: string | null;
	live_url: string | null;
	live_at: string | null;
	citation_wave_due_at: string | null;
	citation_wave_done_at: string | null;
	target_citations: number | null;
	notes_md: string | null;
	source?: 'app' | 'import' | 'ai';
	import_ref?: string | null;
	created_at: string;
	updated_at: string;
}

export interface CitationRow {
	id: string;
	program_id: string;
	cluster_id: string | null;
	page_id: string | null;
	channel_key: string;
	status: CitationStatus;
	title: string | null;
	draft_md: string | null;
	url: string | null;
	posted_on: string | null;
	keyword: string | null;
	fact_id: string | null;
	models_surfacing: string[];
	poster_kind: PosterKind;
	poster_id: string | null;
	poster_handle: string | null;
	rules_check: { ok: boolean; failed: string[]; checked_at?: string } | null;
	verified_by: string | null;
	verified_at: string | null;
	cross_links: string[];
	source: 'app' | 'import' | 'ai';
	import_ref: string | null;
	notes_md: string | null;
	created_at: string;
	updated_at: string;
}

export interface FactRow {
	id: string;
	program_id: string;
	fact: string;
	source_url: string | null;
	status: FactStatus;
	verified_by: string | null;
	verified_at: string | null;
	use_count: number;
	sort: number;
	created_at: string;
}

export interface VideoChapter {
	index: number;
	title: string;
	start_sec?: number | null;
	page_id?: string | null;
}
export interface ChecklistItem {
	key: string;
	label: string;
	owner?: string;
	done?: boolean;
	done_at?: string | null;
	by?: string | null;
}

export interface VideoRow {
	id: string;
	program_id: string;
	cluster_id: string | null;
	month: string;
	title: string | null;
	status: VideoStatus;
	script_md: string | null;
	script_status: PlanStatus | 'draft' | 'in_review' | 'verification' | 'approved';
	chapters: VideoChapter[];
	checklist: ChecklistItem[];
	shoot_at: string | null;
	sme_name: string | null;
	recording_path: string | null;
	recording_url: string | null;
	youtube_url: string | null;
	transcript_md: string | null;
	session_call_id: string | null;
	shorts_cut_list: { title: string; start_sec?: number; end_sec?: number; keyword?: string }[];
	published_at: string | null;
	notes_md: string | null;
	created_at: string;
	updated_at: string;
}

export interface DeliverableRow {
	id: string;
	client_id: string;
	program_id: string | null;
	package_key: string;
	kind: string;
	title: string;
	status: DeliverableStatus;
	due_on: string | null;
	period_month: string | null;
	delivered_at: string | null;
	ref_table: string | null;
	ref_id: string | null;
	href: string | null;
	client_href: string | null;
	visible_to_client: boolean;
	owner_id: string | null;
	notes_md: string | null;
	created_at: string;
	updated_at: string;
}

export interface EventRow {
	id: number;
	program_id: string;
	kind: string;
	summary: string;
	payload: Record<string, unknown>;
	actor_id: string | null;
	actor_label: string | null;
	client_visible: boolean;
	created_at: string;
}

// ---------------------------------------------------------------- pure helpers

/** Add N business days (Mon-Fri) to a date. */
export function addBusinessDays(from: Date, days: number): Date {
	const d = new Date(from.getTime());
	let left = Math.max(0, Math.floor(days));
	while (left > 0) {
		d.setUTCDate(d.getUTCDate() + 1);
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6) left--;
	}
	return d;
}

/** Business days between two dates (positive when b is after a). */
export function businessDaysBetween(a: Date, b: Date): number {
	const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
	const end = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
	const sign = end >= start ? 1 : -1;
	let n = 0;
	const cur = new Date(start.getTime());
	while ((sign > 0 && cur < end) || (sign < 0 && cur > end)) {
		cur.setUTCDate(cur.getUTCDate() + sign);
		const dow = cur.getUTCDay();
		if (dow !== 0 && dow !== 6) n++;
	}
	return n * sign;
}

export interface ClusterProgress {
	pages_total: number;
	pages_live: number;
	pages_approved: number;
	citations_target: number;
	citations_shipped: number;
	waves_overdue: number;
	day: number | null;
	days_total: number;
	pct_time: number | null;
	pct_pages: number;
	pct_citations: number;
	behind: boolean;
}

/** Cluster Tracker row: pages live, citations shipped vs plan, time elapsed; "behind" when delivery lags time by > 15 points. */
export function clusterProgress(cluster: Pick<ClusterRow, 'starts_on' | 'ends_on'>, pages: Pick<PageRow, 'status' | 'target_citations' | 'citation_wave_due_at' | 'citation_wave_done_at' | 'live_at'>[], citations: Pick<CitationRow, 'status' | 'page_id'>[], now: Date = new Date()): ClusterProgress {
	const pages_total = pages.length;
	const pages_live = pages.filter((p) => p.status === 'live').length;
	const pages_approved = pages.filter((p) => ['approved', 'handed_off', 'live'].includes(p.status)).length;
	const citations_target = pages.reduce((s, p) => s + (p.target_citations ?? 20), 0);
	const citations_shipped = citations.filter((c) => SHIPPED_CITATION.includes(c.status)).length;
	const waves_overdue = pages.filter((p) => p.live_at && !p.citation_wave_done_at && p.citation_wave_due_at && new Date(p.citation_wave_due_at) < now).length;
	let day: number | null = null;
	let days_total = 90;
	if (cluster.starts_on) {
		const start = new Date(cluster.starts_on + 'T00:00:00Z');
		const end = cluster.ends_on ? new Date(cluster.ends_on + 'T00:00:00Z') : new Date(start.getTime() + 90 * 86_400_000);
		days_total = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
		day = Math.max(0, Math.min(days_total, Math.floor((now.getTime() - start.getTime()) / 86_400_000)));
	}
	const pct_time = day == null ? null : Math.round((day / days_total) * 100);
	const pct_pages = pages_total ? Math.round((pages_live / pages_total) * 100) : 0;
	const pct_citations = citations_target ? Math.round((citations_shipped / citations_target) * 100) : 0;
	// Grace: nothing is "behind" in the first 20 days (month 1 is audit + plan + shoot).
	const behind = pct_time != null && day != null && day > 20 && (pct_time - Math.max(pct_pages, pct_citations) > 15 || waves_overdue > 0);
	return { pages_total, pages_live, pages_approved, citations_target, citations_shipped, waves_overdue, day, days_total, pct_time, pct_pages, pct_citations, behind };
}

/** Per-page 8-row citation checklist (Page Tracker). */
export function pageChecklist(channels: ChannelRow[], citations: Pick<CitationRow, 'channel_key' | 'status'>[]): { channel: ChannelRow; target_min: number; target_max: number; planned: number; shipped: number; done: boolean }[] {
	return channels
		.filter((c) => c.is_active && c.per_page_min > 0)
		.map((channel) => {
			const mine = citations.filter((c) => c.channel_key === channel.key);
			const shipped = mine.filter((c) => SHIPPED_CITATION.includes(c.status)).length;
			return { channel, target_min: channel.per_page_min, target_max: channel.per_page_max, planned: mine.length, shipped, done: shipped >= channel.per_page_min };
		});
}

/** The SOP minimum intake: what is still missing on a program. */
export function intakeGaps(p: Pick<ProgramRow, 'brand_name' | 'primary_url' | 'competitors' | 'keywords' | 'icp_md' | 'sme_name' | 'access'>, facts: number): string[] {
	const gaps: string[] = [];
	if (!p.brand_name) gaps.push('brand name');
	if (!p.primary_url) gaps.push('primary URL');
	if ((p.competitors ?? []).filter(Boolean).length < 3) gaps.push('3 competitors');
	if ((p.keywords ?? []).filter(Boolean).length < 5) gaps.push('top 5 keywords');
	if (!p.icp_md) gaps.push('ideal customer description');
	if (!p.sme_name) gaps.push('SME nominated');
	const a = p.access ?? {};
	if (!a.gbp) gaps.push('GBP access');
	if (!a.search_console) gaps.push('Search Console access');
	if (!a.analytics) gaps.push('Analytics access');
	if (!a.site_backend) gaps.push('site backend / dev contact');
	if (facts < 6) gaps.push(`${6 - facts} more verifiable facts`);
	return gaps;
}

export function monthKey(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function fmtCents(c: number | null | undefined): string {
	if (c == null) return '—';
	return `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------- F4b (0143)

export interface StudioItem {
	item_kind: 'page' | 'citation' | 'video';
	item_id: string;
	program_id: string;
	client_name: string;
	cluster_number: number | null;
	page_number: number | null;
	title: string;
	keyword: string | null;
	channel_key: string | null;
	status: string;
	scheduled_for: string | null;
	due_at: string | null;
	published_at: string | null;
	live_url: string | null;
	assignee_id: string | null;
	draft_status: string | null;
	humanized: boolean;
	updated_at: string;
}

export interface ProgramAgentRow {
	program_id: string;
	agent_key: string;
	enabled: boolean;
	persona_override: string | null;
	show_in_portal: boolean;
	identity_slug: string | null;
}

// ---------------------------------------------------------------- F4 (0142)

export interface QueueRow {
	id: string;
	program_id: string;
	citation_id: string;
	channel_key: string;
	poster_kind: 'person' | 'network' | 'fourth_pillar';
	assignee_id: string | null;
	network_property: string | null;
	status: 'queued' | 'claimed' | 'posted' | 'verified' | 'dropped';
	due_at: string | null;
	claimed_at: string | null;
	posted_at: string | null;
	posted_url: string | null;
	note: string | null;
	client_name?: string;
	page_keyword?: string | null;
	page_number?: number | null;
	title?: string | null;
	draft_md?: string | null;
}

// ---------------------------------------------------------------- F3 (0138)

export interface AiModelRow {
	id: string;
	vendor: string;
	label: string;
	context_length: number | null;
	prompt_usd_per_m: number | null;
	completion_usd_per_m: number | null;
	web_search: boolean;
	is_core: boolean;
	in_panel: boolean;
	is_active: boolean;
	sort: number;
	synced_at: string;
}
