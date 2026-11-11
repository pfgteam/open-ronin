// Prospects list reads (spec 2026-10-15-prospects-lists-design.md §4–§6):
// ranged, exactly-counted PostgREST reads for the Pipeline table, one board
// column at a time, the rev_pipeline_summary totals (with a fallback until
// 0157 is applied), and the Contacts tables. Every read orders by a unique
// key last so pages never overlap (PostgREST caps at 1000 rows).

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEAL_CARD_COLUMNS, toCard, type DealJoined } from './server';
import { pageRange, type ContactsFilters, type DealSort, type StatusFilter } from './listParams';
import { SOURCES, type DealCard } from './shared';

type Db = SupabaseClient;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: StatusFilter[] = ['open', 'won', 'lost', 'all'];
const MAX_PIPELINES = 20;
const MAX_TERM = 100;

/** PostgREST or() and LIKE metacharacters out; the term is free text, never syntax. */
export function cleanTerm(q: string): string {
	return q.replace(/[,()%_*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM);
}

export interface StageSum {
	count: number;
	valueCents: number;
}
export interface PipelineSummary {
	byStage: Record<string, StageSum>;
	count: number;
	valueCents: number;
	/** false until 0157 is applied (or the RPC failed): callers fall back to row counts. */
	available: boolean;
}

export function summaryFromRows(rows: { stage_id: string; deals: number | string; value_cents: number | string }[]): PipelineSummary {
	const byStage: Record<string, StageSum> = {};
	let count = 0;
	let valueCents = 0;
	for (const r of rows) {
		const c = Number(r.deals);
		const v = Number(r.value_cents);
		byStage[r.stage_id] = { count: c, valueCents: v };
		count += c;
		valueCents += v;
	}
	return { byStage, count, valueCents, available: true };
}

export function isMissingFunction(err: { code?: string } | null | undefined): boolean {
	return err?.code === '42883' || err?.code === 'PGRST202';
}

export interface DealQuery {
	pipelineIds?: string[];
	stageId?: string | null;
	ownerId?: string | null;
	source?: string | null;
	status: StatusFilter;
	/** Already cleaned (cleanTerm); searched in SQL over title, primary person and brand. */
	q?: string | null;
}

/** rev_pipeline_deals / rev_pipeline_summary arguments (0157). Sent as a POST body by .rpc. */
export function pipelineRpcArgs(q: DealQuery) {
	return {
		p_pipeline_ids: q.pipelineIds ?? null,
		p_status: q.status,
		p_owner: q.ownerId ?? null,
		p_source: q.source ?? null,
		p_stage: q.stageId ?? null,
		p_q: q.q ?? null,
	};
}

/** The board's "Load more" receives its query from the browser: rebuild it from validated parts. */
export function sanitizeDealQuery(input: Partial<Record<keyof DealQuery, unknown>>): DealQuery {
	const uuid = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
	const ids = Array.isArray(input.pipelineIds) ? input.pipelineIds.map(uuid).filter((v): v is string => !!v).slice(0, MAX_PIPELINES) : undefined;
	const term = typeof input.q === 'string' ? cleanTerm(input.q) : '';
	return {
		pipelineIds: ids,
		stageId: uuid(input.stageId),
		ownerId: uuid(input.ownerId),
		source: typeof input.source === 'string' && (SOURCES as readonly string[]).includes(input.source) ? input.source : null,
		status: STATUSES.includes(input.status as StatusFilter) ? (input.status as StatusFilter) : 'open',
		q: term || null,
	};
}

/* The PostgREST filter builder's generic type is not usable as a parameter type; the
   helpers below only call eq / in / or / is on it, which every builder has. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function applyDealQuery<T>(qb: T, q: DealQuery): T {
	let x = qb as any;
	if (q.pipelineIds) x = x.in('pipeline_id', q.pipelineIds.length ? q.pipelineIds : ['00000000-0000-0000-0000-000000000000']);
	if (q.stageId) x = x.eq('stage_id', q.stageId);
	if (q.status !== 'all') x = x.eq('status', q.status);
	if (q.ownerId) x = x.or(`owner_lg_id.eq.${q.ownerId},owner_setter_id.eq.${q.ownerId},owner_closer_id.eq.${q.ownerId}`);
	if (q.source) x = x.eq('source', q.source);
	// Fallback path only (0157 not applied): title search; the RPC searches people and brands too.
	if (q.q) x = x.ilike('title', `%${q.q}%`);
	return x as T;
}

function applyHas<T>(qb: T, has: ContactsFilters['has']): T {
	if (has === 'all') return qb;
	const x = (qb as any).eq('rev_deals.status', 'open');
	return (has === 'none' ? x.is('rev_deals', null) : x) as T;
}

const SORT_COLUMN: Record<DealSort, string> = {
	recent: 'stage_entered_at',
	title: 'title',
	value: 'est_mrr_cents',
	heat: 'heat_score',
	touch: 'last_touch_at',
	next: 'next_action_at',
};

type Page<T> = { data: T[] | null; error: { code?: string; message: string } | null; count?: number | null };

/** The deal set from rev_pipeline_deals (0157); falls back to a direct read with title-only search until it is applied. */
async function dealRows(db: Db, q: DealQuery, order: (b: any) => any, from: number, to: number, count: boolean): Promise<{ deals: DealCard[]; count: number; error: string | null }> {
	const opts = count ? { count: 'exact' as const } : {};
	let res = (await order(db.rpc('rev_pipeline_deals', pipelineRpcArgs(q), opts).select(DEAL_CARD_COLUMNS)).range(from, to)) as Page<DealJoined>;
	if (res.error && isMissingFunction(res.error)) {
		res = (await order(applyDealQuery(db.from('rev_deals').select(DEAL_CARD_COLUMNS, opts), q)).range(from, to)) as Page<DealJoined>;
	}
	if (res.error) return { deals: [], count: 0, error: res.error.message };
	return { deals: (res.data ?? []).map(toCard), count: res.count ?? 0, error: null };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadDealsPage(db: Db, q: DealQuery, sort: DealSort, dir: 'asc' | 'desc', page: number, size: number): Promise<{ deals: DealCard[]; count: number; error: string | null }> {
	const r = pageRange(page, size);
	return dealRows(db, q, (b) => b.order(SORT_COLUMN[sort], { ascending: dir === 'asc', nullsFirst: false }).order('id', { ascending: true }), r.from, r.to, true);
}

/** One board column: hottest first, then most recently moved. */
export async function loadStageColumn(db: Db, q: DealQuery, stageId: string, offset: number, limit = 50): Promise<{ deals: DealCard[]; error: string | null }> {
	const res = await dealRows(
		db,
		{ ...q, stageId },
		(b) => b.order('heat_score', { ascending: false, nullsFirst: false }).order('stage_entered_at', { ascending: false }).order('id', { ascending: true }),
		offset,
		offset + limit - 1,
		false,
	);
	return { deals: res.deals, error: res.error };
}

export async function loadPipelineSummary(db: Db, q: DealQuery): Promise<PipelineSummary> {
	const { data, error } = await db.rpc('rev_pipeline_summary', pipelineRpcArgs(q));
	if (error) {
		if (!isMissingFunction(error)) console.error('[prospects] rev_pipeline_summary failed', error.message);
		return { byStage: {}, count: 0, valueCents: 0, available: false };
	}
	return summaryFromRows((data ?? []) as { stage_id: string; deals: number; value_cents: number }[]);
}

// ------------------------------------------------------------ contacts

export interface ContactPerson {
	id: string;
	display_name: string;
	title: string | null;
	email: string | null;
	phone: string | null;
	updated_at: string;
	brand: string | null;
	deal: { id: string; pipeline_id: string; stage_id: string; owner_lg_id: string | null; owner_setter_id: string | null; owner_closer_id: string | null } | null;
}

export interface ContactBrand {
	id: string;
	name: string;
	domain: string | null;
	website: string | null;
	client_id: string | null;
	updated_at: string;
	people: number;
	openDeals: number;
}

type PersonBase = Omit<ContactPerson, 'brand' | 'deal'>;
type OpenDeal = NonNullable<ContactPerson['deal']> & { primary_person_id: string; updated_at: string };

export async function loadPeoplePage(db: Db, f: ContactsFilters): Promise<{ rows: ContactPerson[]; count: number; error: string | null }> {
	const r = pageRange(f.page, f.size);
	const embed = f.has === 'open' ? ', rev_deals!inner(id)' : f.has === 'none' ? ', rev_deals(id)' : '';
	let qb = applyHas(db.from('rev_people').select(`id, display_name, title, email, phone, updated_at${embed}`, { count: 'exact' }), f.has);
	const term = f.q ? cleanTerm(f.q) : '';
	if (term) qb = qb.or(`display_name.ilike.%${term}%,email_key.ilike.%${term.toLowerCase()}%,phone.ilike.%${term}%`);
	const { data, error, count } = await qb
		.order(f.sort === 'name' ? 'display_name' : 'updated_at', { ascending: f.sort === 'name' })
		.order('id', { ascending: true })
		.range(r.from, r.to);
	if (error) return { rows: [], count: 0, error: error.message };
	const people = ((data ?? []) as unknown as PersonBase[]).map(({ id, display_name, title, email, phone, updated_at }) => ({ id, display_name, title, email, phone, updated_at }));
	const ids = people.map((p) => p.id);
	const [links, deals] = ids.length
		? await Promise.all([
				db.from('rev_person_links').select('person_id, is_primary, rev_brands(name)').in('person_id', ids),
				db.from('rev_deals').select('id, primary_person_id, pipeline_id, stage_id, owner_lg_id, owner_setter_id, owner_closer_id, updated_at').in('primary_person_id', ids).eq('status', 'open'),
			])
		: [{ data: [] }, { data: [] }];
	const brandBy = new Map<string, { name: string; primary: boolean }>();
	for (const l of (links.data ?? []) as unknown as { person_id: string; is_primary: boolean; rev_brands: { name: string } | { name: string }[] | null }[]) {
		const b = Array.isArray(l.rev_brands) ? l.rev_brands[0] : l.rev_brands;
		if (!b) continue;
		const cur = brandBy.get(l.person_id);
		if (!cur || (!cur.primary && l.is_primary)) brandBy.set(l.person_id, { name: b.name, primary: l.is_primary });
	}
	const dealBy = new Map<string, OpenDeal>();
	for (const d of (deals.data ?? []) as OpenDeal[]) {
		const cur = dealBy.get(d.primary_person_id);
		if (!cur || d.updated_at > cur.updated_at) dealBy.set(d.primary_person_id, d);
	}
	return {
		rows: people.map((p) => {
			const d = dealBy.get(p.id);
			return {
				...p,
				brand: brandBy.get(p.id)?.name ?? null,
				deal: d ? { id: d.id, pipeline_id: d.pipeline_id, stage_id: d.stage_id, owner_lg_id: d.owner_lg_id, owner_setter_id: d.owner_setter_id, owner_closer_id: d.owner_closer_id } : null,
			};
		}),
		count: count ?? 0,
		error: null,
	};
}

export async function loadBrandsPage(db: Db, f: ContactsFilters): Promise<{ rows: ContactBrand[]; count: number; error: string | null }> {
	const r = pageRange(f.page, f.size);
	const embed = f.has === 'open' ? ', rev_deals!inner(id)' : f.has === 'none' ? ', rev_deals(id)' : '';
	let qb = applyHas(db.from('rev_brands').select(`id, name, domain, website, client_id, updated_at${embed}`, { count: 'exact' }), f.has);
	const term = f.q ? cleanTerm(f.q) : '';
	if (term) qb = qb.or(`name.ilike.%${term}%,domain.ilike.%${term}%`);
	const { data, error, count } = await qb
		.order(f.sort === 'name' ? 'name' : 'updated_at', { ascending: f.sort === 'name' })
		.order('id', { ascending: true })
		.range(r.from, r.to);
	if (error) return { rows: [], count: 0, error: error.message };
	const brands = (data ?? []) as unknown as Omit<ContactBrand, 'people' | 'openDeals'>[];
	const ids = brands.map((b) => b.id);
	const [links, deals] = ids.length
		? await Promise.all([
				db.from('rev_person_links').select('brand_id').in('brand_id', ids),
				db.from('rev_deals').select('brand_id').in('brand_id', ids).eq('status', 'open'),
			])
		: [{ data: [] }, { data: [] }];
	const tally = (rows: { brand_id: string }[]) => rows.reduce((m, x) => m.set(x.brand_id, (m.get(x.brand_id) ?? 0) + 1), new Map<string, number>());
	const people = tally((links.data ?? []) as { brand_id: string }[]);
	const open = tally((deals.data ?? []) as { brand_id: string }[]);
	return {
		rows: brands.map((b) => ({ id: b.id, name: b.name, domain: b.domain, website: b.website, client_id: b.client_id, updated_at: b.updated_at, people: people.get(b.id) ?? 0, openDeals: open.get(b.id) ?? 0 })),
		count: count ?? 0,
		error: null,
	};
}

export async function loadContactCounts(db: Db): Promise<{ people: number; brands: number; duplicates: number }> {
	const head = { count: 'exact' as const, head: true };
	const [p, b, d] = await Promise.all([
		db.from('rev_people').select('id', head),
		db.from('rev_brands').select('id', head),
		db.from('rev_duplicate_candidates').select('id', head).eq('status', 'open'),
	]);
	return { people: p.count ?? 0, brands: b.count ?? 0, duplicates: d.count ?? 0 };
}

/** Exact per-id counts (one head query each), for numbers a person decides on — an .in() read would stop at PostgREST's 1000-row cap. */
export async function countPerId(db: Db, table: string, column: string, ids: string[]): Promise<Map<string, number>> {
	const res = await Promise.all(ids.map((id) => db.from(table).select('id', { count: 'exact', head: true }).eq(column, id)));
	return new Map(ids.map((id, i) => [id, (res[i] as { count: number | null }).count ?? 0]));
}
