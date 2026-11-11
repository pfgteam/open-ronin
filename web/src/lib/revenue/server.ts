// Revenue Engine server readers (0121). Server-only: every function takes the
// caller's Supabase client so RLS (can_view_revenue) decides what comes back.
// Pages render from these; actions.ts writes.

import type { SupabaseClient } from '@supabase/supabase-js';
import { pageRange } from './listParams';
import { TIMELINE_PAGE_SIZE, rangeFor } from '@/lib/pagination';
import type {
	ActivityRow,
	BrandRow,
	CompanyRow,
	DealCard,
	DealRow,
	DispositionRow,
	DuplicateRow,
	PersonLinkRow,
	PersonRow,
	PipelineRow,
	ProductRow,
	StaffOption,
	StageHistoryRow,
	StageRow,
	TaskRow,
} from './shared';

type Db = SupabaseClient;

export const PIPELINE_COLUMNS = 'id, slug, name, lane, brand, description, is_active, position';
export const STAGE_COLUMNS = 'id, pipeline_id, slug, name, position, probability, sla_hours, required_fields, outcome, handoff_pipeline_id, handoff_stage_slug, color';
export const PRODUCT_COLUMNS = 'id, slug, name, brand, family, kind, price_cents, price_max_cents, per_unit_cents, unit_label, deliverables_md, terms_md, is_active, position';
export const DISPOSITION_COLUMNS = 'id, slug, name, kind, counts_as, heat_delta, position, is_active';
export const PERSON_COLUMNS =
	'id, first_name, last_name, display_name, title, email, emails, phone, phones, linkedin_url, instagram, facebook, tiktok, x_handle, website, location, notes_md, do_not_contact, ghl_contact_id, created_at, updated_at, intel, enrichment';
export const BRAND_COLUMNS = 'id, name, domain, website, industry, vertical, socials, description, client_id, created_at, updated_at, intel, enrichment, enrichment_status';
export const COMPANY_COLUMNS = 'id, name, parent_company_id, domain, website, industry, vertical, hq_city, hq_state, hq_country, employee_count, est_revenue_cents, linkedin_url, client_id';
export const DEAL_COLUMNS =
	'id, brand_id, company_id, primary_person_id, title, motion, pipeline_id, stage_id, status, product_ids, est_mrr_cents, est_one_time_cents, owner_lg_id, owner_setter_id, owner_closer_id, source, campaign, channel, quality_score, heat_score, qualification, budget_band, timing, next_action, next_action_at, lost_reason, first_touch_at, last_touch_at, touches_30d, no_show_count, stage_entered_at, won_at, lost_at, client_id, ghl_opportunity_id, created_via, created_at, updated_at, fit_signals, quality_breakdown, heat_breakdown, scored_at, mql_tier, routing, routed_at, delay_until, ai_fit_summary, ghl_push_status, ghl_push_error, ghl_contact_id, ghl_pushed_at, ghl_location_id';
export const DEAL_CARD_COLUMNS = `${DEAL_COLUMNS}, rev_brands(name), rev_people(display_name, email), rev_companies(name)`;
export const ACTIVITY_COLUMNS =
	'id, deal_id, person_id, brand_id, kind, channel, direction, actor_id, actor_kind, disposition_id, outcome, subject, body_md, recording_url, duration_sec, is_touch, is_positive, occurred_at, created_at';
export const TASK_COLUMNS = 'id, deal_id, person_id, owner_id, title, body_md, due_at, done_at, created_by_kind, created_at';
export const HISTORY_COLUMNS = 'id, deal_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, changed_by, reason, note, created_at';
export const DUPLICATE_COLUMNS = 'id, entity, keep_id, drop_id, match_on, confidence, status, created_at';
export const LINK_COLUMNS = 'id, person_id, brand_id, company_id, role, is_primary';

/** 0121 not applied: relation missing. Pages show a Callout instead of a stack trace. */
export function isNotApplied(e: { code?: string; message?: string } | null | undefined): boolean {
	return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(e.message ?? ''));
}

export interface RevenueConfig {
	pipelines: PipelineRow[];
	stages: StageRow[];
	products: ProductRow[];
	dispositions: DispositionRow[];
	notApplied: boolean;
	error: string | null;
}

export async function loadConfig(db: Db): Promise<RevenueConfig> {
	const [p, s, pr, d] = await Promise.all([
		db.from('rev_pipelines').select(PIPELINE_COLUMNS).order('position'),
		db.from('rev_stages').select(STAGE_COLUMNS).order('position'),
		db.from('rev_products').select(PRODUCT_COLUMNS).order('position'),
		db.from('rev_dispositions').select(DISPOSITION_COLUMNS).order('position'),
	]);
	const err = p.error ?? s.error ?? pr.error ?? d.error ?? null;
	return {
		pipelines: (p.data ?? []) as unknown as PipelineRow[],
		stages: (s.data ?? []) as unknown as StageRow[],
		products: (pr.data ?? []) as unknown as ProductRow[],
		dispositions: (d.data ?? []) as unknown as DispositionRow[],
		notApplied: isNotApplied(err),
		error: err && !isNotApplied(err) ? err.message : null,
	};
}

export type DealJoined = DealRow & {
	rev_brands: { name: string } | { name: string }[] | null;
	rev_people: { display_name: string; email: string | null } | { display_name: string; email: string | null }[] | null;
	rev_companies: { name: string } | { name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
	return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function toCard(row: DealJoined): DealCard {
	const { rev_brands, rev_people, rev_companies, ...deal } = row;
	const b = one(rev_brands);
	const p = one(rev_people);
	const c = one(rev_companies);
	return { ...deal, brand_name: b?.name ?? null, person_name: p?.display_name ?? null, person_email: p?.email ?? null, company_name: c?.name ?? null };
}

export interface DealFilters {
	pipelineId?: string;
	status?: 'open' | 'won' | 'lost' | 'all';
	ownerId?: string;
	brandId?: string;
	personId?: string;
	motion?: string;
	source?: string;
	q?: string;
	limit?: number;
	pipelineIds?: string[];
	page?: number;
	pageSize?: number;
}

export async function loadDeals(db: Db, f: DealFilters = {}): Promise<{ deals: DealCard[]; error: string | null; count: number | null }> {
	let q = db.from('rev_deals').select(DEAL_CARD_COLUMNS, { count: 'exact' });
	if (f.pipelineId) q = q.eq('pipeline_id', f.pipelineId);
	if (f.pipelineIds) q = q.in('pipeline_id', f.pipelineIds.length ? f.pipelineIds : ['00000000-0000-0000-0000-000000000000']);
	if (!f.status || f.status === 'open') q = q.eq('status', 'open');
	else if (f.status !== 'all') q = q.eq('status', f.status);
	if (f.ownerId) q = q.or(`owner_lg_id.eq.${f.ownerId},owner_setter_id.eq.${f.ownerId},owner_closer_id.eq.${f.ownerId}`);
	if (f.brandId) q = q.eq('brand_id', f.brandId);
	if (f.personId) q = q.eq('primary_person_id', f.personId);
	if (f.motion) q = q.eq('motion', f.motion);
	if (f.source) q = q.eq('source', f.source);
	if (f.q) q = q.ilike('title', `%${f.q.replace(/[%_]/g, '')}%`);
	const ordered = q.order('stage_entered_at', { ascending: false }).order('id', { ascending: true });
	const r = f.page ? pageRange(f.page, f.pageSize) : null;
	const { data, error, count } = await (r ? ordered.range(r.from, r.to) : ordered.limit(f.limit ?? 500));
	if (error) return { deals: [], error: isNotApplied(error) ? null : error.message, count: null };
	return { deals: ((data ?? []) as unknown as DealJoined[]).map(toCard), error: null, count: count ?? null };
}

export async function loadDeal(db: Db, id: string): Promise<DealCard | null> {
	const { data, error } = await db.from('rev_deals').select(DEAL_CARD_COLUMNS).eq('id', id).maybeSingle();
	if (error || !data) return null;
	return toCard(data as unknown as DealJoined);
}

/** One page of a timeline, newest first; id breaks ties so pages never overlap or skip. */
function activityPage(db: Db, col: 'deal_id' | 'person_id', id: string, page: number) {
	const r = rangeFor(page, TIMELINE_PAGE_SIZE);
	return db
		.from('rev_activities')
		.select(ACTIVITY_COLUMNS, { count: 'exact' })
		.eq(col, id)
		.order('occurred_at', { ascending: false })
		.order('id', { ascending: false })
		.range(r.from, r.to);
}

export async function loadDealContext(db: Db, deal: DealCard, opts: { timelinePage?: number } = {}) {
	const [acts, tasks, hist, person, brand, company, links] = await Promise.all([
		activityPage(db, 'deal_id', deal.id, opts.timelinePage ?? 1),
		db.from('rev_tasks').select(TASK_COLUMNS).eq('deal_id', deal.id).order('due_at', { ascending: true, nullsFirst: false }),
		db.from('rev_deal_stage_history').select(HISTORY_COLUMNS).eq('deal_id', deal.id).order('created_at', { ascending: false }),
		deal.primary_person_id ? db.from('rev_people').select(PERSON_COLUMNS).eq('id', deal.primary_person_id).maybeSingle() : Promise.resolve({ data: null }),
		deal.brand_id ? db.from('rev_brands').select(BRAND_COLUMNS).eq('id', deal.brand_id).maybeSingle() : Promise.resolve({ data: null }),
		deal.company_id ? db.from('rev_companies').select(COMPANY_COLUMNS).eq('id', deal.company_id).maybeSingle() : Promise.resolve({ data: null }),
		deal.brand_id || deal.company_id
			? db
					.from('rev_person_links')
					.select(`${LINK_COLUMNS}, rev_people(${PERSON_COLUMNS})`)
					.or([deal.brand_id ? `brand_id.eq.${deal.brand_id}` : null, deal.company_id ? `company_id.eq.${deal.company_id}` : null].filter(Boolean).join(','))
			: Promise.resolve({ data: [] }),
	]);
	return {
		activities: (acts.data ?? []) as unknown as ActivityRow[],
		activitiesTotal: acts.count ?? 0,
		tasks: (tasks.data ?? []) as unknown as TaskRow[],
		history: (hist.data ?? []) as unknown as StageHistoryRow[],
		person: (person.data ?? null) as PersonRow | null,
		brand: (brand.data ?? null) as BrandRow | null,
		company: (company.data ?? null) as CompanyRow | null,
		people: ((links.data ?? []) as unknown as (PersonLinkRow & { rev_people: PersonRow | PersonRow[] | null })[]).map((l) => ({ ...l, person: one(l.rev_people) })),
	};
}

export async function loadPeople(db: Db, q?: string, limit = 300): Promise<{ people: PersonRow[]; error: string | null }> {
	let query = db.from('rev_people').select(PERSON_COLUMNS).order('updated_at', { ascending: false }).limit(limit);
	if (q) {
		const term = `%${q.replace(/[%_]/g, '')}%`;
		query = query.or(`display_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
	}
	const { data, error } = await query;
	if (error) return { people: [], error: isNotApplied(error) ? null : error.message };
	return { people: (data ?? []) as unknown as PersonRow[], error: null };
}

export async function loadPerson(db: Db, id: string, opts: { timelinePage?: number } = {}) {
	const [p, links, deals, acts, tasks] = await Promise.all([
		db.from('rev_people').select(PERSON_COLUMNS).eq('id', id).maybeSingle(),
		db.from('rev_person_links').select(`${LINK_COLUMNS}, rev_brands(${BRAND_COLUMNS}), rev_companies(${COMPANY_COLUMNS})`).eq('person_id', id),
		db.from('rev_deals').select(DEAL_CARD_COLUMNS).eq('primary_person_id', id).order('created_at', { ascending: false }),
		activityPage(db, 'person_id', id, opts.timelinePage ?? 1),
		db.from('rev_tasks').select(TASK_COLUMNS).eq('person_id', id).is('done_at', null).order('due_at', { ascending: true, nullsFirst: false }),
	]);
	if (!p.data) return null;
	return {
		person: p.data as unknown as PersonRow,
		links: ((links.data ?? []) as unknown as (PersonLinkRow & { rev_brands: BrandRow | BrandRow[] | null; rev_companies: CompanyRow | CompanyRow[] | null })[]).map((l) => ({
			...l,
			brand: one(l.rev_brands),
			company: one(l.rev_companies),
		})),
		deals: ((deals.data ?? []) as unknown as DealJoined[]).map(toCard),
		activities: (acts.data ?? []) as unknown as ActivityRow[],
		activitiesTotal: acts.count ?? 0,
		tasks: (tasks.data ?? []) as unknown as TaskRow[],
	};
}

export async function loadBrands(db: Db, q?: string, limit = 300): Promise<{ brands: BrandRow[]; error: string | null }> {
	let query = db.from('rev_brands').select(BRAND_COLUMNS).order('updated_at', { ascending: false }).limit(limit);
	if (q) {
		const term = `%${q.replace(/[%_]/g, '')}%`;
		query = query.or(`name.ilike.${term},domain.ilike.${term}`);
	}
	const { data, error } = await query;
	if (error) return { brands: [], error: isNotApplied(error) ? null : error.message };
	return { brands: (data ?? []) as unknown as BrandRow[], error: null };
}

export async function loadBrand(db: Db, id: string) {
	const [b, links, deals, companies] = await Promise.all([
		db.from('rev_brands').select(BRAND_COLUMNS).eq('id', id).maybeSingle(),
		db.from('rev_person_links').select(`${LINK_COLUMNS}, rev_people(${PERSON_COLUMNS})`).eq('brand_id', id),
		db.from('rev_deals').select(DEAL_CARD_COLUMNS).eq('brand_id', id).order('created_at', { ascending: false }),
		db.from('rev_brand_companies').select(`company_id, is_primary, rev_companies(${COMPANY_COLUMNS})`).eq('brand_id', id),
	]);
	if (!b.data) return null;
	return {
		brand: b.data as unknown as BrandRow,
		people: ((links.data ?? []) as unknown as (PersonLinkRow & { rev_people: PersonRow | PersonRow[] | null })[]).map((l) => ({ ...l, person: one(l.rev_people) })),
		deals: ((deals.data ?? []) as unknown as DealJoined[]).map(toCard),
		companies: ((companies.data ?? []) as unknown as { company_id: string; is_primary: boolean; rev_companies: CompanyRow | CompanyRow[] | null }[]).map((c) => ({ ...c, company: one(c.rev_companies) })),
	};
}

export async function loadDuplicates(db: Db): Promise<{ rows: (DuplicateRow & { keep: PersonRow | null; drop: PersonRow | null })[]; error: string | null }> {
	const { data, error } = await db.from('rev_duplicate_candidates').select(DUPLICATE_COLUMNS).eq('status', 'open').order('created_at', { ascending: false }).limit(200);
	if (error) return { rows: [], error: isNotApplied(error) ? null : error.message };
	const rows = (data ?? []) as unknown as DuplicateRow[];
	const ids = [...new Set(rows.filter((r) => r.entity === 'person').flatMap((r) => [r.keep_id, r.drop_id]))];
	const people = new Map<string, PersonRow>();
	if (ids.length) {
		const { data: p } = await db.from('rev_people').select(PERSON_COLUMNS).in('id', ids);
		for (const row of (p ?? []) as unknown as PersonRow[]) people.set(row.id, row);
	}
	return { rows: rows.map((r) => ({ ...r, keep: people.get(r.keep_id) ?? null, drop: people.get(r.drop_id) ?? null })), error: null };
}

export type { StaffOption } from './shared';

// ---------------------------------------------------------------- 0122

export interface ScoringConfigRow {
	key: string;
	group_key: 'quality' | 'heat' | 'routing' | 'lists';
	label: string;
	value: unknown;
	note: string | null;
	updated_at: string;
}

export interface IntakeSourceView {
	key: string;
	label: string;
	kind: 'webhook' | 'api' | 'csv' | 'form';
	enabled: boolean;
	token_issued_at: string | null;
	secret_env: string | null;
	default_pipeline: string;
	default_source: string | null;
	default_channel: string | null;
	default_motion: string;
	field_map: Record<string, string>;
	note: string | null;
	last_event_at: string | null;
	event_count: number;
	error_count: number;
	last_error: string | null;
}

export interface IntakeEventRow {
	id: string;
	source_key: string;
	external_id: string | null;
	status: 'received' | 'processed' | 'rejected' | 'duplicate' | 'ignored';
	deal_id: string | null;
	person_id: string | null;
	error: string | null;
	received_at: string;
}

export interface FormLinkRow {
	form_id: string;
	enabled: boolean;
	public: boolean;
	default_pipeline: string;
	default_source: string;
	default_channel: string | null;
	default_motion: string;
	field_map: Record<string, string>;
	routing_copy: Record<string, unknown>;
	form: { slug: string; title: string; status: string } | null;
}

export async function loadScoringConfig(db: Db): Promise<ScoringConfigRow[]> {
	const { data } = await db.from('rev_scoring_config').select('key, group_key, label, value, note, updated_at').order('group_key').order('key');
	return (data ?? []) as unknown as ScoringConfigRow[];
}

/** token_hash is a column grant away from authenticated; select the visible columns explicitly. */
export async function loadIntakeSources(db: Db): Promise<IntakeSourceView[]> {
	const { data } = await db
		.from('rev_intake_sources')
		.select('key, label, kind, enabled, token_issued_at, secret_env, default_pipeline, default_source, default_channel, default_motion, field_map, note, last_event_at, event_count, error_count, last_error')
		.order('kind')
		.order('label');
	return (data ?? []) as unknown as IntakeSourceView[];
}

export async function loadIntakeEvents(db: Db, limit = 50): Promise<IntakeEventRow[]> {
	const { data } = await db.from('rev_intake_events').select('id, source_key, external_id, status, deal_id, person_id, error, received_at').order('received_at', { ascending: false }).limit(limit);
	return (data ?? []) as unknown as IntakeEventRow[];
}

export async function loadFormLinks(db: Db): Promise<FormLinkRow[]> {
	const { data } = await db.from('rev_form_links').select('form_id, enabled, public, default_pipeline, default_source, default_channel, default_motion, field_map, routing_copy, forms(slug, title, status)');
	return ((data ?? []) as unknown as (Omit<FormLinkRow, 'form'> & { forms: FormLinkRow['form'] | FormLinkRow['form'][] })[]).map((r) => {
		const { forms, ...rest } = r;
		return { ...rest, form: one(forms) };
	});
}

// ---------------------------------------------------------------- 0123

export interface GhlConnectionView {
	id: string;
	label: string | null;
	ghl_location_id: string | null;
	auth_kind: 'oauth' | 'private_token';
	org: string | null;
	is_default: boolean;
	installed_at: string;
	disconnected_at: string | null;
	last_ok_at: string | null;
	last_error: string | null;
	expires_at: string | null;
}
export interface CutoverRow {
	key: string;
	label: string;
	owner: 'ghl' | 'main' | 'off';
	note: string | null;
	updated_at: string;
}
export interface StageMapRow {
	ghl_stage_id: string;
	ghl_pipeline_id: string;
	ghl_pipeline_name: string;
	ghl_stage_name: string;
	pipeline_slug: string;
	stage_slug: string;
	icp_band: string | null;
}

export async function loadScraperLink(svc: Db): Promise<{ enabled: boolean; sent: number; unsent: number }> {
	const [src, sent, unsent] = await Promise.all([
		svc.from('rev_intake_sources').select('enabled').eq('key', 'apify_scraper').maybeSingle(),
		svc.from('scraped_records').select('id', { count: 'exact', head: true }).not('rev_deal_id', 'is', null),
		svc.from('scraped_records').select('id, scrape_jobs!inner(kind)', { count: 'exact', head: true }).eq('status', 'approved').is('sent_to_prospects_at', null).eq('scrape_jobs.kind', 'lead'),
	]);
	return { enabled: (src.data as { enabled: boolean } | null)?.enabled === true, sent: sent.count ?? 0, unsent: unsent.count ?? 0 };
}

export async function loadGhlBaseUrl(db: Db): Promise<string> {
	const { data } = await db.from('ghl_settings').select('value').eq('key', 'app_base_url').maybeSingle();
	const v = (data as { value: unknown } | null)?.value;
	return typeof v === 'string' && v ? v : 'https://app.gohighlevel.com';
}

export interface GhlSettingRow {
	key: string;
	value: unknown;
	note: string | null;
}
export interface SyncLogRow {
	id: string;
	direction: 'outbound' | 'inbound';
	kind: string;
	status: 'ok' | 'failed' | 'skipped' | 'retry';
	deal_id: string | null;
	ghl_contact_id: string | null;
	ghl_opportunity_id: string | null;
	summary: string | null;
	error: string | null;
	attempts: number;
	created_at: string;
}

/** The service role reads connections (0007 RLS is admin-only); the page gates on can_view_revenue before calling. */
export async function loadGhlOverview(db: Db, svc: Db) {
	const [conns, cut, set, map, runs] = await Promise.all([
		svc.from('ghl_connections').select('id, label, ghl_location_id, auth_kind, org, is_default, installed_at, disconnected_at, last_ok_at, last_error, expires_at').is('disconnected_at', null).order('installed_at'),
		db.from('ghl_cutover').select('key, label, owner, note, updated_at').order('key'),
		db.from('ghl_settings').select('key, value, note').order('key'),
		db.from('ghl_stage_map').select('ghl_stage_id, ghl_pipeline_id, ghl_pipeline_name, ghl_stage_name, pipeline_slug, stage_slug, icp_band').order('ghl_pipeline_name').order('ghl_stage_name'),
		db.from('ghl_backfill_runs').select('id, connection_id, ghl_pipeline_id, ghl_status, since, state, cursor_after, cursor_after_id, fetched, imported, existed, skipped, failed, last_error, created_at, finished_at').order('created_at'),
	]);
	return {
		connections: (conns.data ?? []) as unknown as GhlConnectionView[],
		cutover: (cut.data ?? []) as unknown as CutoverRow[],
		settings: (set.data ?? []) as unknown as GhlSettingRow[],
		stageMap: (map.data ?? []) as unknown as StageMapRow[],
		backfillRuns: (runs.data ?? []) as unknown as import('./ghlImport').BackfillRunRow[],
	};
}

// ---------------------------------------------------------------- 0124

export interface MyDayRow {
	deal_id: string;
	title: string;
	stage_name: string;
	pipeline_slug: string;
	lane: string;
	person_name: string | null;
	brand_name: string | null;
	heat_score: number | null;
	quality_score: number | null;
	routing: string | null;
	next_action: string | null;
	next_action_at: string | null;
	created_at: string;
	stage_entered_at: string;
	sla_hours: number | null;
	delay_until: string | null;
	value_cents: number;
	phone: string | null;
	email: string | null;
	score: number;
	reason: string;
}
export interface DailyMetricRow {
	day: string;
	user_id: string;
	metric: string;
	value: number;
}
export interface ChannelMetricRow {
	day: string;
	channel: string;
	source: string;
	metric: string;
	value: number;
}
export interface LanePersonRow {
	id: string;
	user_id: string;
	lane: string;
	org: string;
	level: string;
	is_active: boolean;
}
export interface TargetRow {
	id: string;
	user_id: string | null;
	lane: string;
	metric: string;
	period: 'day' | 'week' | 'month';
	target: number;
}
export interface QueueRuleRow {
	key: string;
	label: string;
	value: number;
	note: string | null;
}

export async function loadMyDay(db: Db, userId: string, limit = 50): Promise<MyDayRow[]> {
	const { data } = await db.rpc('rev_my_day', { p_user: userId, p_limit: limit });
	return (data ?? []) as MyDayRow[];
}

export async function loadDailyMetrics(db: Db, from: string, to: string, userId?: string): Promise<DailyMetricRow[]> {
	const { data } = await db.rpc('rev_daily_metrics', { p_from: from, p_to: to, p_user: userId ?? null });
	return ((data ?? []) as DailyMetricRow[]).map((r) => ({ ...r, value: Number(r.value) }));
}

export async function loadChannelMetrics(db: Db, from: string, to: string): Promise<ChannelMetricRow[]> {
	const { data } = await db.rpc('rev_channel_metrics', { p_from: from, p_to: to });
	return ((data ?? []) as ChannelMetricRow[]).map((r) => ({ ...r, value: Number(r.value) }));
}

export async function loadLanes(db: Db): Promise<{ people: LanePersonRow[]; targets: TargetRow[]; rules: QueueRuleRow[] }> {
	const [p, t, r] = await Promise.all([
		db.from('rev_lanes_people').select('id, user_id, lane, org, level, is_active').order('lane'),
		db.from('rev_targets').select('id, user_id, lane, metric, period, target').order('lane').order('metric'),
		db.from('rev_queue_rules').select('key, label, value, note').order('key'),
	]);
	return {
		people: (p.data ?? []) as LanePersonRow[],
		targets: ((t.data ?? []) as TargetRow[]).map((x) => ({ ...x, target: Number(x.target) })),
		rules: ((r.data ?? []) as QueueRuleRow[]).map((x) => ({ ...x, value: Number(x.value) })),
	};
}

// ---------------------------------------------------------------- 0125

export interface CallRow {
	id: string;
	deal_id: string | null;
	person_id: string | null;
	session_call_id: string | null;
	call_kind: 'triage' | 'discovery' | 'closing' | 'other';
	rubric_key: string | null;
	source: 'zoom' | 'ghl' | 'manual' | 'upload';
	external_id: string | null;
	owner_id: string | null;
	scheduled_at: string | null;
	occurred_at: string | null;
	duration_sec: number | null;
	recording_url: string | null;
	transcript_md: string | null;
	summary_md: string | null;
	next_steps_md: string | null;
	follow_up_draft_md: string | null;
	suggested_stage_slug: string | null;
	score: number | null;
	score_breakdown: { total?: number | null; rubric?: string | null; criteria?: unknown[] } | null;
	analyzed_at: string | null;
	analyzer: string | null;
	status: 'scheduled' | 'recorded' | 'transcribed' | 'analyzed' | 'no_show' | 'cancelled';
	created_at: string;
}
export interface ActionItemRow {
	id: string;
	call_id: string;
	deal_id: string | null;
	title: string;
	owner_id: string | null;
	due_at: string | null;
	task_id: string | null;
	status: 'suggested' | 'accepted' | 'dismissed';
}
export interface BriefRow {
	id: string;
	deal_id: string;
	call_id: string | null;
	for_user_id: string | null;
	body_md: string;
	analyzer: string | null;
	created_at: string;
}
export interface DocumentRow {
	id: string;
	deal_id: string | null;
	kind: 'proposal' | 'presentation' | 'contract' | 'brief' | 'other';
	title: string;
	bucket_path: string | null;
	url: string | null;
	status: 'draft' | 'sent' | 'viewed' | 'signed' | 'void';
	meta: Record<string, unknown>;
	created_by: string | null;
	created_at: string;
}
export interface RubricRow {
	key: string;
	label: string;
	call_kind: 'triage' | 'discovery' | 'closing' | 'other';
	body_md: string;
	criteria: { name: string; weight: number }[];
	is_active: boolean;
	version: number;
	updated_at: string;
}

export async function loadDealCalls(db: Db, dealId: string) {
	const [calls, items, briefs, docs] = await Promise.all([
		db.from('rev_calls').select('id, deal_id, person_id, session_call_id, call_kind, rubric_key, source, external_id, owner_id, scheduled_at, occurred_at, duration_sec, recording_url, transcript_md, summary_md, next_steps_md, follow_up_draft_md, suggested_stage_slug, score, score_breakdown, analyzed_at, analyzer, status, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(30),
		db.from('rev_call_action_items').select('id, call_id, deal_id, title, owner_id, due_at, task_id, status').eq('deal_id', dealId).order('created_at'),
		db.from('rev_briefs').select('id, deal_id, call_id, for_user_id, body_md, analyzer, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(5),
		db.from('rev_documents').select('id, deal_id, kind, title, bucket_path, url, status, meta, created_by, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }),
	]);
	return {
		calls: ((calls.data ?? []) as unknown as CallRow[]).map((c) => ({ ...c, score: c.score == null ? null : Number(c.score) })),
		items: (items.data ?? []) as unknown as ActionItemRow[],
		briefs: (briefs.data ?? []) as unknown as BriefRow[],
		documents: (docs.data ?? []) as unknown as DocumentRow[],
	};
}

export async function loadRubrics(db: Db): Promise<RubricRow[]> {
	const { data } = await db.from('rev_call_rubrics').select('key, label, call_kind, body_md, criteria, is_active, version, updated_at').order('call_kind');
	return (data ?? []) as unknown as RubricRow[];
}

// ---------------------------------------------------------------- 0126

export interface ContractRow {
	id: string;
	deal_id: string;
	brand_id: string | null;
	template_id: string | null;
	signer_person_id: string | null;
	signer_email: string | null;
	signer_name: string | null;
	title: string;
	line_items: { name: string; qty: number; unit_cents: number; billing: string }[];
	mrr_cents: number;
	one_time_cents: number;
	deposit_cents: number | null;
	term_months: number | null;
	starts_on: string | null;
	body_md: string | null;
	status: 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'void';
	provider: string | null;
	provider_ref: string | null;
	provider_url: string | null;
	signed_pdf_path: string | null;
	sent_at: string | null;
	signed_at: string | null;
	client_id: string | null;
	contract_row_id: string | null;
	converted_at: string | null;
	created_at: string;
}
export interface PresentationRow {
	id: string;
	deal_id: string;
	title: string;
	inputs: Record<string, unknown>;
	outline: unknown;
	body_md: string | null;
	export_url: string | null;
	analyzer: string | null;
	status: 'draft' | 'ready' | 'presented';
	created_at: string;
}
export interface TemplateRow {
	id: string;
	key: string;
	label: string;
	org: 'main' | 'premium' | 'beacon';
	body_md: string;
	terms_md: string | null;
	default_term_months: number | null;
	is_active: boolean;
	version: number;
	updated_at: string;
}

export async function loadDealClosing(db: Db, dealId: string) {
	const [c, p, t] = await Promise.all([
		db.from('rev_contracts').select('id, deal_id, brand_id, template_id, signer_person_id, signer_email, signer_name, title, line_items, mrr_cents, one_time_cents, deposit_cents, term_months, starts_on, body_md, status, provider, provider_ref, provider_url, signed_pdf_path, sent_at, signed_at, client_id, contract_row_id, converted_at, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }),
		db.from('rev_presentations').select('id, deal_id, title, inputs, outline, body_md, export_url, analyzer, status, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(5),
		db.from('rev_contract_templates').select('id, key, label, org, body_md, terms_md, default_term_months, is_active, version, updated_at').eq('is_active', true).order('org'),
	]);
	return {
		contracts: ((c.data ?? []) as unknown as ContractRow[]).map((x) => ({ ...x, mrr_cents: Number(x.mrr_cents), one_time_cents: Number(x.one_time_cents) })),
		presentations: (p.data ?? []) as unknown as PresentationRow[],
		templates: (t.data ?? []) as unknown as TemplateRow[],
	};
}

export async function loadContractTemplates(db: Db): Promise<TemplateRow[]> {
	const { data } = await db.from('rev_contract_templates').select('id, key, label, org, body_md, terms_md, default_term_months, is_active, version, updated_at').order('org');
	return (data ?? []) as unknown as TemplateRow[];
}

// ---------------------------------------------------------------- 0127

export interface ReferralCodeRow {
	code: string;
	referrer_person_id: string | null;
	referrer_client_id: string | null;
	referrer_name: string | null;
	referrer_email: string | null;
	kind: 'non_client' | 'client' | 'staff';
	is_active: boolean;
	uses: number;
	created_at: string;
}
export interface ReferralRow {
	id: string;
	code: string | null;
	referrer_name: string | null;
	referrer_kind: 'non_client' | 'client' | 'staff';
	deal_id: string | null;
	deal_title: string | null;
	status: 'referred' | 'call_reached' | 'closed' | 'lost';
	reached_call_at: string | null;
	closed_at: string | null;
	commission: Record<string, unknown>;
	created_at: string;
}
export interface PayoutRow {
	id: string;
	referral_id: string;
	kind: 'intro_bonus' | 'monthly_pct' | 'adjustment';
	period_month: string | null;
	amount_cents: number;
	pct: number | null;
	status: 'due' | 'paid' | 'void';
	paid_at: string | null;
}
export interface FeedbackRow {
	id: string;
	kind: 'call' | 'client' | 'prospect';
	deal_id: string | null;
	deal_title: string | null;
	call_id: string | null;
	subject_user_id: string | null;
	rating: number | null;
	comment: string | null;
	requested_at: string | null;
	submitted_at: string | null;
}
export interface ReviewRow {
	id: string;
	client_id: string | null;
	client_name: string | null;
	deal_id: string | null;
	deal_title: string | null;
	milestone: 'signed' | 'first_placement' | 'day_90' | 'renewal' | 'manual';
	status: 'requested' | 'reminded' | 'collected' | 'declined' | 'void';
	platform: string | null;
	url: string | null;
	rating: number | null;
	quote: string | null;
	display: boolean;
	requested_at: string;
}

export async function loadGrowth(db: Db) {
	const [codes, refs, pays, fb, rv] = await Promise.all([
		db.from('rev_referral_codes').select('code, referrer_person_id, referrer_client_id, referrer_name, referrer_email, kind, is_active, uses, created_at').order('created_at', { ascending: false }).limit(100),
		db.from('rev_referrals').select('id, code, referrer_name, referrer_kind, deal_id, status, reached_call_at, closed_at, commission, created_at, rev_deals(title)').order('created_at', { ascending: false }).limit(200),
		db.from('rev_commission_payouts').select('id, referral_id, kind, period_month, amount_cents, pct, status, paid_at').order('period_month'),
		db.from('rev_feedback').select('id, kind, deal_id, call_id, subject_user_id, rating, comment, requested_at, submitted_at, rev_deals(title)').order('created_at', { ascending: false }).limit(200),
		db.from('rev_reviews').select('id, client_id, deal_id, milestone, status, platform, url, rating, quote, display, requested_at, rev_deals(title), clients_v2(display_name)').order('requested_at', { ascending: false }).limit(200),
	]);
	const err = codes.error ?? refs.error ?? pays.error ?? fb.error ?? rv.error;
	type J = { rev_deals?: { title: string } | { title: string }[] | null; clients_v2?: { display_name: string } | { display_name: string }[] | null };
	return {
		notApplied: isNotApplied(err ?? null),
		codes: (codes.data ?? []) as unknown as ReferralCodeRow[],
		referrals: ((refs.data ?? []) as unknown as (ReferralRow & J)[]).map(({ rev_deals, ...r }) => ({ ...r, deal_title: one(rev_deals ?? null)?.title ?? null })),
		payouts: ((pays.data ?? []) as unknown as PayoutRow[]).map((p) => ({ ...p, amount_cents: Number(p.amount_cents), pct: p.pct == null ? null : Number(p.pct) })),
		feedback: ((fb.data ?? []) as unknown as (FeedbackRow & J)[]).map(({ rev_deals, ...f }) => ({ ...f, deal_title: one(rev_deals ?? null)?.title ?? null })),
		reviews: ((rv.data ?? []) as unknown as (ReviewRow & J)[]).map(({ rev_deals, clients_v2, ...r }) => ({ ...r, deal_title: one(rev_deals ?? null)?.title ?? null, client_name: one(clients_v2 ?? null)?.display_name ?? null })),
	};
}

/** Active staff for owner pickers. */
export async function loadStaff(db: Db): Promise<StaffOption[]> {
	const { data } = await db.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name');
	return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string }[]).map((p) => ({
		id: p.id,
		name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
		email: p.email,
	}));
}
