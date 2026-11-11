// Revenue Engine vocabulary (0121). No server imports: client components
// read these constants directly (the *Shared.ts split every lib/* module
// uses). Mirrors the CHECK constraints in 0121_revenue_engine_p1.sql; a
// change here is a migration there.

export const MOTIONS = ['pr', 'social', 'both', 'beacon', 'premium', 'low_ticket', 'high_ticket', 'other'] as const;
export type Motion = (typeof MOTIONS)[number];
export const MOTION_LABELS: Record<Motion, string> = {
	pr: 'PR',
	social: 'Social',
	both: 'PR + Social',
	beacon: 'Beacon',
	premium: 'Premium',
	low_ticket: 'Low ticket',
	high_ticket: 'High ticket',
	other: 'Other',
};

export const LANES = ['marketing', 'lead_gen', 'setter', 'closer', 'full_cycle', 'other'] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABELS: Record<Lane, string> = {
	marketing: 'Marketing',
	lead_gen: 'Lead Gen',
	setter: 'Setter',
	closer: 'Closer',
	full_cycle: 'Full cycle',
	other: 'Other',
};

export const BRANDS = ['main', 'premium', 'beacon'] as const;
export type Brand = (typeof BRANDS)[number];
export const BRAND_LABELS: Record<Brand | 'all', string> = { main: 'Main', premium: 'Premium', beacon: 'Beacon', all: 'All brands' };

export const PRODUCT_FAMILIES = ['pr', 'music', 'social', 'ads', 'addon', 'beacon', 'strategy', 'low_ticket', 'other'] as const;
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];
export const PRODUCT_FAMILY_LABELS: Record<ProductFamily, string> = {
	pr: 'PR packages',
	music: 'Music',
	social: 'Social',
	ads: 'Paid ads',
	addon: 'Add-ons',
	beacon: 'Beacon',
	strategy: 'Strategy',
	low_ticket: 'Low ticket',
	other: 'Other',
};
export const PRODUCT_KINDS = ['retainer', 'subscription', 'one_time', 'addon'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PERSON_ROLES = ['owner', 'marketing_manager', 'decision_maker', 'signer', 'assistant', 'other'] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
export const PERSON_ROLE_LABELS: Record<PersonRole, string> = {
	owner: 'Owner',
	marketing_manager: 'Marketing manager',
	decision_maker: 'Decision maker',
	signer: 'Signer',
	assistant: 'Assistant',
	other: 'Other',
};

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const ACTIVITY_KINDS = ['call', 'sms', 'email', 'dm', 'meeting', 'note', 'form', 'page_view', 'ad_click', 'scrape_hit', 'stage_change', 'task', 'system'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
	call: 'Call',
	sms: 'SMS',
	email: 'Email',
	dm: 'DM',
	meeting: 'Meeting',
	note: 'Note',
	form: 'Form',
	page_view: 'Page view',
	ad_click: 'Ad click',
	scrape_hit: 'Scrape hit',
	stage_change: 'Stage change',
	task: 'Task',
	system: 'System',
};
/** Kinds a rep logs by hand from the deal page. */
export const LOGGABLE_KINDS: readonly ActivityKind[] = ['call', 'sms', 'email', 'dm', 'meeting', 'note'];

export const CHANNELS = ['phone', 'email', 'linkedin', 'instagram', 'facebook', 'tiktok', 'x', 'zoom', 'web', 'in_person', 'ghl', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export const SOURCES = [
	'linkedin_dm', 'ig_dm', 'fb_dm', 'email', 'meta_ads', 'google_ads', 'organic', 'trade_show', 'dials', 'scrape',
	'referral', 'chatbot', 'inbound_call', 'webinar', 'low_ticket', 'manual', 'import', 'ghl', 'other',
] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
	linkedin_dm: 'LinkedIn DM',
	ig_dm: 'Instagram DM',
	fb_dm: 'Facebook DM',
	email: 'Email outreach',
	meta_ads: 'Meta ads',
	google_ads: 'Google ads',
	organic: 'Organic social',
	trade_show: 'Trade show',
	dials: 'Dials',
	scrape: 'Scrape',
	referral: 'Referral',
	chatbot: 'Chatbot',
	inbound_call: 'Inbound call',
	webinar: 'Webinar',
	low_ticket: 'Low ticket / book',
	manual: 'Manual',
	import: 'Import',
	ghl: 'GHL',
	other: 'Other',
};

export const BUDGET_BANDS = ['none', '500_3k', '3k_7_5k', '7_5k_20k', '20k_plus'] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];
export const BUDGET_BAND_LABELS: Record<BudgetBand, string> = {
	none: 'No budget',
	'500_3k': '$500 – $3k (Beacon)',
	'3k_7_5k': '$3k – $7.5k (qualified)',
	'7_5k_20k': '$7.5k – $20k (high value)',
	'20k_plus': '$20k+ (premium)',
};

export const TIMINGS = ['immediately', 'within_30', 'after_30', 'unknown'] as const;
export type Timing = (typeof TIMINGS)[number];
export const TIMING_LABELS: Record<Timing, string> = {
	immediately: 'Immediately',
	within_30: 'Within 30 days',
	after_30: 'After 30 days',
	unknown: 'Unknown',
};

export const OWNER_LANES = ['owner_lg_id', 'owner_setter_id', 'owner_closer_id'] as const;
export type OwnerLane = (typeof OWNER_LANES)[number];
export const OWNER_LANE_LABELS: Record<OwnerLane, string> = { owner_lg_id: 'Lead gen', owner_setter_id: 'Setter', owner_closer_id: 'Closer' };

/** Which owner column a pipeline's lane fills. */
export function ownerLaneFor(lane: Lane): OwnerLane {
	if (lane === 'marketing' || lane === 'lead_gen') return 'owner_lg_id';
	if (lane === 'setter') return 'owner_setter_id';
	return 'owner_closer_id';
}

// ---------------------------------------------------------------- row types

export interface PipelineRow {
	id: string;
	slug: string;
	name: string;
	lane: Lane;
	brand: Brand | 'all';
	description: string | null;
	is_active: boolean;
	position: number;
}

export interface StageRow {
	id: string;
	pipeline_id: string;
	slug: string;
	name: string;
	position: number;
	probability: number;
	sla_hours: number | null;
	required_fields: string[];
	outcome: 'open' | 'won' | 'lost';
	handoff_pipeline_id: string | null;
	handoff_stage_slug: string | null;
	color: string | null;
}

export interface ProductRow {
	id: string;
	slug: string;
	name: string;
	brand: Brand;
	family: ProductFamily;
	kind: ProductKind;
	price_cents: number | null;
	price_max_cents: number | null;
	per_unit_cents: number | null;
	unit_label: string | null;
	deliverables_md: string | null;
	terms_md: string | null;
	is_active: boolean;
	position: number;
}

export interface DispositionRow {
	id: string;
	slug: string;
	name: string;
	kind: 'call' | 'dm' | 'email' | 'meeting';
	counts_as: string[];
	heat_delta: number;
	position: number;
	is_active: boolean;
}

export interface PersonRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	display_name: string;
	title: string | null;
	email: string | null;
	emails: string[];
	phone: string | null;
	phones: string[];
	linkedin_url: string | null;
	instagram: string | null;
	facebook: string | null;
	tiktok: string | null;
	x_handle: string | null;
	website: string | null;
	location: string | null;
	notes_md: string | null;
	do_not_contact: boolean;
	ghl_contact_id: string | null;
	created_at: string;
	updated_at: string;
	intel?: Record<string, unknown>;
	enrichment?: Record<string, unknown>;
}

export interface BrandRow {
	id: string;
	name: string;
	domain: string | null;
	website: string | null;
	industry: string | null;
	vertical: string | null;
	socials: Record<string, string>;
	description: string | null;
	client_id: string | null;
	created_at: string;
	updated_at: string;
	intel?: Record<string, unknown>;
	enrichment?: Record<string, unknown>;
	enrichment_status?: string;
}

export interface CompanyRow {
	id: string;
	name: string;
	parent_company_id: string | null;
	domain: string | null;
	website: string | null;
	industry: string | null;
	vertical: string | null;
	hq_city: string | null;
	hq_state: string | null;
	hq_country: string | null;
	employee_count: number | null;
	est_revenue_cents: number | null;
	linkedin_url: string | null;
	client_id: string | null;
}

export interface DealRow {
	id: string;
	brand_id: string | null;
	company_id: string | null;
	primary_person_id: string | null;
	title: string;
	motion: Motion;
	pipeline_id: string;
	stage_id: string;
	status: DealStatus;
	product_ids: string[];
	est_mrr_cents: number | null;
	est_one_time_cents: number | null;
	owner_lg_id: string | null;
	owner_setter_id: string | null;
	owner_closer_id: string | null;
	source: string | null;
	campaign: string | null;
	channel: string | null;
	quality_score: number | null;
	heat_score: number | null;
	qualification: string | null;
	budget_band: BudgetBand | null;
	timing: Timing | null;
	next_action: string | null;
	next_action_at: string | null;
	lost_reason: string | null;
	first_touch_at: string | null;
	last_touch_at: string | null;
	touches_30d: number;
	no_show_count: number;
	stage_entered_at: string;
	won_at: string | null;
	lost_at: string | null;
	client_id: string | null;
	ghl_opportunity_id: string | null;
	created_via: string;
	created_at: string;
	updated_at: string;
	// 0122
	fit_signals: Record<string, unknown>;
	quality_breakdown: { total?: number; max?: number; parts?: Record<string, number> } | null;
	heat_breakdown: { total?: number; parts?: Record<string, number | string> } | null;
	scored_at: string | null;
	mql_tier: number | null;
	routing: Routing | null;
	routed_at: string | null;
	delay_until: string | null;
	ai_fit_summary: string | null;
	// 0123
	ghl_location_id: string | null;
	ghl_push_status: 'eligible' | 'pushed' | 'failed' | 'skipped' | null;
	ghl_push_error: string | null;
	ghl_contact_id: string | null;
	ghl_pushed_at: string | null;
}

export const ROUTINGS = ['book_call', 'setter_outreach', 'nurture', 'beacon_offer', 'manual'] as const;
export type Routing = (typeof ROUTINGS)[number];
export const ROUTING_LABELS: Record<Routing, string> = {
	book_call: 'Book a call',
	setter_outreach: 'Setter reaches out',
	nurture: 'Nurture',
	beacon_offer: 'Beacon offer',
	manual: 'Manual',
};

/** Quality inputs a rep can set by hand (the MQL answers). */
export const FIT_SIGNAL_FIELDS = [
	{ key: 'website', label: 'Website quality (0-3)', kind: 'website' },
	{ key: 'why_grow', label: 'Why do they want to grow?', kind: 'text' },
	{ key: 'roadblock', label: 'Biggest roadblock', kind: 'text' },
	{ key: 'interest_pr', label: 'Interested in PR', kind: 'bool' },
	{ key: 'interest_ads', label: 'Running ads', kind: 'bool' },
	{ key: 'interest_smm', label: 'Interested in social', kind: 'bool' },
	{ key: 'industry', label: 'Industry', kind: 'short' },
	{ key: 'agency_before', label: 'Worked with an agency before', kind: 'bool' },
	{ key: 'work_email', label: 'Work email (override)', kind: 'bool' },
	{ key: 'brand_presence', label: 'Brand presence', kind: 'short' },
	{ key: 'revenue', label: 'Annual revenue', kind: 'short' },
	{ key: 'locations', label: 'Locations', kind: 'short' },
	{ key: 'competitors', label: 'Competitors', kind: 'short' },
	{ key: 'pr_goal', label: '#1 PR goal', kind: 'text' },
	{ key: 'decision_maker', label: 'Decision maker?', kind: 'short' },
] as const;

/** DealRow plus the joined names the board / list render. */
export interface DealCard extends DealRow {
	brand_name: string | null;
	person_name: string | null;
	person_email: string | null;
	company_name: string | null;
}

export interface ActivityRow {
	id: string;
	deal_id: string | null;
	person_id: string | null;
	brand_id: string | null;
	kind: ActivityKind;
	channel: string | null;
	direction: 'inbound' | 'outbound' | 'internal' | null;
	actor_id: string | null;
	actor_kind: 'human' | 'ai' | 'system' | 'prospect';
	disposition_id: string | null;
	outcome: string | null;
	subject: string | null;
	body_md: string | null;
	recording_url: string | null;
	duration_sec: number | null;
	is_touch: boolean;
	is_positive: boolean | null;
	occurred_at: string;
	created_at: string;
}

export interface TaskRow {
	id: string;
	deal_id: string | null;
	person_id: string | null;
	owner_id: string | null;
	title: string;
	body_md: string | null;
	due_at: string | null;
	done_at: string | null;
	created_by_kind: 'human' | 'ai' | 'automation';
	created_at: string;
}

export interface StageHistoryRow {
	id: string;
	deal_id: string;
	from_pipeline_id: string | null;
	from_stage_id: string | null;
	to_pipeline_id: string;
	to_stage_id: string;
	changed_by: string | null;
	reason: 'manual' | 'event' | 'handoff' | 'import' | 'sync' | 'automation' | 'created';
	note: string | null;
	created_at: string;
}

export interface DuplicateRow {
	id: string;
	entity: 'person' | 'brand' | 'company';
	keep_id: string;
	drop_id: string;
	match_on: string;
	confidence: number;
	status: 'open' | 'merged' | 'dismissed';
	created_at: string;
}

export interface PersonLinkRow {
	id: string;
	person_id: string;
	brand_id: string | null;
	company_id: string | null;
	role: PersonRole;
	is_primary: boolean;
}

// ---------------------------------------------------------------- helpers

/** Quality-Heat display, e.g. "20-15"; dashes for unscored (P2 fills them). */
export function scoreLabel(quality: number | null | undefined, heat: number | null | undefined): string {
	if (quality == null && heat == null) return '—';
	return `${quality ?? '–'}-${heat ?? '–'}`;
}

/** Heat as a word (Self → Sales). "hot >= 10" is the same line rev_my_day uses for its 'hot' reason. */
export type HeatLevel = 'hot' | 'warm' | 'cold';
export const HEAT_HOT = 10;
export const HEAT_WARM = 4;
export function heatLevel(heat: number | null | undefined): HeatLevel {
	const h = heat ?? 0;
	return h >= HEAT_HOT ? 'hot' : h >= HEAT_WARM ? 'warm' : 'cold';
}
export const HEAT_LABELS: Record<HeatLevel, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };

/** rev_my_day().reason → what a rep reads. */
export const REASON_LABELS: Record<string, string> = {
	'new lead': 'New lead',
	'follow-up overdue': 'Overdue',
	'due today': 'Today',
	'SLA breached': 'SLA breached',
	'on delay': 'On hold',
	hot: 'Hot',
	'next up': 'Next up',
};

/** Hours a deal has sat in its stage. */
export function hoursInStage(stageEnteredAt: string, now: Date = new Date()): number {
	return Math.max(0, (now.getTime() - new Date(stageEnteredAt).getTime()) / 3_600_000);
}

/** SLA state for a stage timer: null = no SLA; 'ok' | 'warn' (>75%) | 'breach'. */
export function slaState(stage: Pick<StageRow, 'sla_hours'>, deal: Pick<DealRow, 'stage_entered_at' | 'status'>, now: Date = new Date()): 'ok' | 'warn' | 'breach' | null {
	if (!stage.sla_hours || deal.status !== 'open') return null;
	const h = hoursInStage(deal.stage_entered_at, now);
	if (h >= stage.sla_hours) return 'breach';
	if (h >= stage.sla_hours * 0.75) return 'warn';
	return 'ok';
}

/** Expected value = probability-weighted MRR (one-time counted once). */
export function weightedValueCents(deal: Pick<DealRow, 'est_mrr_cents' | 'est_one_time_cents'>, stage: Pick<StageRow, 'probability'>): number {
	const v = (deal.est_mrr_cents ?? 0) + (deal.est_one_time_cents ?? 0);
	return Math.round((v * stage.probability) / 100);
}

/** Group stages by pipeline, in position order. */
export function stagesByPipeline(stages: StageRow[]): Map<string, StageRow[]> {
	const out = new Map<string, StageRow[]>();
	for (const s of [...stages].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
		const list = out.get(s.pipeline_id) ?? [];
		list.push(s);
		out.set(s.pipeline_id, list);
	}
	return out;
}

/** Deal counts and value per stage, for column headers and the funnel strip. */
export function stageTotals(deals: Pick<DealRow, 'stage_id' | 'est_mrr_cents' | 'est_one_time_cents'>[]): Map<string, { count: number; valueCents: number }> {
	const out = new Map<string, { count: number; valueCents: number }>();
	for (const d of deals) {
		const t = out.get(d.stage_id) ?? { count: 0, valueCents: 0 };
		t.count += 1;
		t.valueCents += (d.est_mrr_cents ?? 0) + (d.est_one_time_cents ?? 0);
		out.set(d.stage_id, t);
	}
	return out;
}

export function formatCents(cents: number | null | undefined): string {
	if (cents == null) return '—';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

/** "$4,750/mo" or "$10,000" or "$999 + $200 / additional client / month". */
export function productPriceLabel(p: Pick<ProductRow, 'price_cents' | 'price_max_cents' | 'per_unit_cents' | 'unit_label' | 'kind'>): string {
	if (p.price_cents == null) return 'Quote';
	let s = formatCents(p.price_cents);
	if (p.price_max_cents != null && p.price_max_cents !== p.price_cents) s += ` – ${formatCents(p.price_max_cents)}`;
	if (p.kind === 'retainer' || p.kind === 'subscription') s += '/mo';
	if (p.per_unit_cents != null) s += ` + ${formatCents(p.per_unit_cents)} / ${p.unit_label ?? 'unit'}`;
	return s;
}

/** The deal's owner for the pipeline lane it sits in (the person "working" it). */
export function laneOwnerId(deal: Pick<DealRow, 'owner_lg_id' | 'owner_setter_id' | 'owner_closer_id'>, lane: Lane): string | null {
	return deal[ownerLaneFor(lane)];
}

export function isMotion(v: unknown): v is Motion {
	return typeof v === 'string' && (MOTIONS as readonly string[]).includes(v);
}

/** Active staff member for owner pickers (id + display name + email). */
export interface StaffOption {
	id: string;
	name: string;
	email: string;
}
