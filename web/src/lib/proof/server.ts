// Proof Library (0160) server readers. Admin reads go through the session
// client (RLS: can_view_revenue); the public API reads `ready` rows through
// the service role, so the website never needs an anon grant.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
	ASSET_COLUMNS,
	CASE_STUDY_COLUMNS,
	PLACEMENT_COLUMNS,
	SLOT_COLUMNS,
	TESTIMONIAL_COLUMNS,
	buildSlotManifest,
	isIndustry,
	isService,
	pickPlacements,
	publicAsset,
	publicCaseStudy,
	publicTestimonial,
	type AssetRow,
	type CaseStudyRow,
	type ItemKind,
	type PlacementRow,
	type ProofStatus,
	type SlotManifest,
	type SlotRow,
	type SlotWithPlacements,
	type TestimonialRow,
} from './shared';

export const MIGRATION_FILE = '0160_proof_library.sql';

/** 0160 not applied: relation missing. Pages show a Callout instead of a stack trace. */
export function isNotApplied(e: { code?: string; message?: string } | null | undefined): boolean {
	return !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /relation .* does not exist|schema cache/i.test(e.message ?? ''));
}

export interface ProofFilters {
	industry?: string | null;
	service?: string | null;
	status?: string | null;
	type?: string | null;
	q?: string | null;
}

export interface ProofLibrary {
	notApplied: boolean;
	caseStudies: CaseStudyRow[];
	testimonials: TestimonialRow[];
	assets: AssetRow[];
	counts: { case_study: number; testimonial: number; asset: number; ready: number };
	byIndustry: Record<string, number>;
}

const EMPTY: ProofLibrary = { notApplied: false, caseStudies: [], testimonials: [], assets: [], counts: { case_study: 0, testimonial: 0, asset: 0, ready: 0 }, byIndustry: {} };

function applyFilters<T>(q: T, f: ProofFilters, searchCols: string[]): T {
	// PostgREST builder is structurally typed; keep this helper loose on purpose.
	let b = q as unknown as {
		eq: (c: string, v: string) => unknown;
		contains: (c: string, v: string[]) => unknown;
		or: (s: string) => unknown;
	};
	if (f.industry && isIndustry(f.industry)) b = b.eq('industry', f.industry) as typeof b;
	if (f.service && isService(f.service)) b = b.contains('services', [f.service]) as typeof b;
	if (f.status && ['draft', 'ready', 'hidden'].includes(f.status)) b = b.eq('status', f.status) as typeof b;
	if (f.q) {
		const term = f.q.replace(/[%,().]/g, ' ').trim().slice(0, 80);
		if (term) b = b.or(searchCols.map((c) => `${c}.ilike.%${term}%`).join(',')) as typeof b;
	}
	return b as unknown as T;
}

/** Everything for the admin list (one page, filters in SQL). */
export async function loadProofLibrary(supabase: SupabaseClient, f: ProofFilters = {}): Promise<ProofLibrary> {
	const cs = applyFilters(supabase.from('proof_case_studies').select(CASE_STUDY_COLUMNS), f, ['client_name', 'headline', 'results']).order('strength', { ascending: false }).order('client_name').limit(1000);
	const ts = applyFilters(supabase.from('proof_testimonials').select(TESTIMONIAL_COLUMNS), f, ['quote', 'person', 'company']).order('is_featured', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
	let as = applyFilters(supabase.from('proof_assets').select(ASSET_COLUMNS), f, ['label', 'value']).order('type').order('label').limit(2000);
	if (f.type) as = as.eq('type', f.type);
	const [c, t, a, counts] = await Promise.all([cs, ts, as, loadCounts(supabase)]);
	const err = c.error ?? t.error ?? a.error ?? counts.error;
	if (err) {
		if (isNotApplied(err)) return { ...EMPTY, notApplied: true };
		throw new Error(err.message);
	}
	return {
		notApplied: false,
		caseStudies: (c.data ?? []) as unknown as CaseStudyRow[],
		testimonials: (t.data ?? []) as unknown as TestimonialRow[],
		assets: (a.data ?? []) as unknown as AssetRow[],
		counts: counts.counts,
		byIndustry: counts.byIndustry,
	};
}

async function loadCounts(supabase: SupabaseClient) {
	const [c, t, a, cr, tr, ind] = await Promise.all([
		supabase.from('proof_case_studies').select('id', { count: 'exact', head: true }),
		supabase.from('proof_testimonials').select('id', { count: 'exact', head: true }),
		supabase.from('proof_assets').select('id', { count: 'exact', head: true }),
		supabase.from('proof_case_studies').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
		supabase.from('proof_testimonials').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
		supabase.from('proof_case_studies').select('industry').limit(5000),
	]);
	const byIndustry: Record<string, number> = {};
	for (const r of (ind.data ?? []) as { industry: string }[]) byIndustry[r.industry] = (byIndustry[r.industry] ?? 0) + 1;
	return {
		error: c.error ?? t.error ?? a.error ?? ind.error,
		counts: { case_study: c.count ?? 0, testimonial: t.count ?? 0, asset: a.count ?? 0, ready: (cr.count ?? 0) + (tr.count ?? 0) },
		byIndustry,
	};
}

export type ProofItem =
	| { kind: 'case_study'; row: CaseStudyRow }
	| { kind: 'testimonial'; row: TestimonialRow }
	| { kind: 'asset'; row: AssetRow };

export async function loadProofItem(supabase: SupabaseClient, kind: ItemKind, id: string): Promise<ProofItem | null | 'not_applied'> {
	const cols: string = kind === 'case_study' ? CASE_STUDY_COLUMNS : kind === 'testimonial' ? TESTIMONIAL_COLUMNS : ASSET_COLUMNS;
	const table: string = kind === 'case_study' ? 'proof_case_studies' : kind === 'testimonial' ? 'proof_testimonials' : 'proof_assets';
	const { data, error } = await supabase.from(table).select(cols).eq('id', id).maybeSingle();
	if (error) {
		if (isNotApplied(error)) return 'not_applied';
		throw new Error(error.message);
	}
	if (!data) return null;
	return { kind, row: data as unknown } as ProofItem;
}

export type { SlotWithPlacements };

/** Slots + their placements with a human label for each item, for the admin. */
export async function loadSlots(supabase: SupabaseClient): Promise<{ notApplied: boolean; slots: SlotWithPlacements[] }> {
	const [s, p] = await Promise.all([
		supabase.from('proof_slots').select(SLOT_COLUMNS).order('page').order('key'),
		supabase.from('proof_placements').select(PLACEMENT_COLUMNS).order('weight', { ascending: false }).limit(5000),
	]);
	const err = s.error ?? p.error;
	if (err) {
		if (isNotApplied(err)) return { notApplied: true, slots: [] };
		throw new Error(err.message);
	}
	const placements = (p.data ?? []) as unknown as PlacementRow[];
	const labels = await itemLabels(supabase, placements);
	const byKey = new Map<string, SlotWithPlacements>();
	for (const slot of (s.data ?? []) as unknown as SlotRow[]) byKey.set(slot.key, { ...slot, placements: [] });
	for (const pl of placements) byKey.get(pl.slot_key)?.placements.push({ ...pl, label: labels.get(`${pl.item_kind}:${pl.item_id}`) ?? pl.item_id.slice(0, 8) });
	return { notApplied: false, slots: Array.from(byKey.values()) };
}

async function itemLabels(supabase: SupabaseClient, placements: PlacementRow[]): Promise<Map<string, string>> {
	const ids = (kind: ItemKind) => placements.filter((p) => p.item_kind === kind).map((p) => p.item_id);
	const out = new Map<string, string>();
	const [c, t, a] = await Promise.all([
		ids('case_study').length ? supabase.from('proof_case_studies').select('id, client_name, headline').in('id', ids('case_study')) : null,
		ids('testimonial').length ? supabase.from('proof_testimonials').select('id, person, company, quote').in('id', ids('testimonial')) : null,
		ids('asset').length ? supabase.from('proof_assets').select('id, label, type').in('id', ids('asset')) : null,
	]);
	for (const r of (c?.data ?? []) as { id: string; client_name: string; headline: string | null }[]) out.set(`case_study:${r.id}`, r.headline ? `${r.client_name}: ${r.headline}` : r.client_name);
	for (const r of (t?.data ?? []) as { id: string; person: string | null; company: string | null; quote: string }[]) out.set(`testimonial:${r.id}`, `${r.person ?? r.company ?? 'Anonymous'}: ${r.quote.slice(0, 60)}`);
	for (const r of (a?.data ?? []) as { id: string; label: string; type: string }[]) out.set(`asset:${r.id}`, `${r.label} (${r.type})`);
	return out;
}

/** Ready items of one kind, for the "add to slot" picker. */
export async function loadPickerItems(supabase: SupabaseClient): Promise<{ kind: ItemKind; id: string; label: string; media_type: string }[]> {
	const [c, t, a] = await Promise.all([
		supabase.from('proof_case_studies').select('id, client_name, headline, media_type').eq('status', 'ready').order('client_name').limit(1000),
		supabase.from('proof_testimonials').select('id, person, company, quote, media_type').eq('status', 'ready').order('company').limit(1000),
		supabase.from('proof_assets').select('id, label, type').eq('status', 'ready').order('label').limit(2000),
	]);
	const out: { kind: ItemKind; id: string; label: string; media_type: string }[] = [];
	for (const r of (c.data ?? []) as { id: string; client_name: string; headline: string | null; media_type: string }[]) out.push({ kind: 'case_study', id: r.id, label: r.headline ? `${r.client_name}: ${r.headline}` : r.client_name, media_type: r.media_type });
	for (const r of (t.data ?? []) as { id: string; person: string | null; company: string | null; quote: string; media_type: string }[]) out.push({ kind: 'testimonial', id: r.id, label: `${r.person ?? r.company ?? 'Anonymous'}: ${r.quote.slice(0, 60)}`, media_type: r.media_type });
	for (const r of (a.data ?? []) as { id: string; label: string; type: string }[]) out.push({ kind: 'asset', id: r.id, label: `${r.label} (${r.type})`, media_type: r.type === 'video' ? 'video' : 'image' });
	return out;
}

// ---------------------------------------------------------------------------
// Public API (service role, ready only)
// ---------------------------------------------------------------------------

function supabaseUrl() {
	return process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
}

export interface PublicListOptions {
	industry?: string | null;
	service?: string | null;
	type?: string | null;
	media_type?: string | null;
	featured?: boolean;
	limit?: number;
}

/** GET /api/proof/<kind>: every ready item of a kind, filtered. */
export async function publicList(kind: ItemKind, o: PublicListOptions) {
	const db = createServiceRoleClient();
	const limit = Math.min(Math.max(o.limit ?? 50, 1), 500);
	if (kind === 'case_study') {
		let q = db.from('proof_case_studies').select(CASE_STUDY_COLUMNS).eq('status', 'ready');
		if (o.industry && isIndustry(o.industry)) q = q.eq('industry', o.industry);
		if (o.service && isService(o.service)) q = q.contains('services', [o.service]);
		if (o.media_type) q = q.eq('media_type', o.media_type);
		if (o.featured) q = q.eq('is_featured', true);
		const { data, error } = await q.order('is_featured', { ascending: false }).order('strength', { ascending: false }).order('year', { ascending: false, nullsFirst: false }).limit(limit);
		if (error) return { error };
		return { items: ((data ?? []) as unknown as CaseStudyRow[]).map(publicCaseStudy) };
	}
	if (kind === 'testimonial') {
		let q = db.from('proof_testimonials').select(TESTIMONIAL_COLUMNS).eq('status', 'ready');
		if (o.industry && isIndustry(o.industry)) q = q.eq('industry', o.industry);
		if (o.service && isService(o.service)) q = q.contains('services', [o.service]);
		if (o.media_type) q = q.eq('media_type', o.media_type);
		if (o.featured) q = q.eq('is_featured', true);
		const { data, error } = await q.order('is_featured', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
		if (error) return { error };
		return { items: ((data ?? []) as unknown as TestimonialRow[]).map(publicTestimonial) };
	}
	let q = db.from('proof_assets').select(ASSET_COLUMNS).eq('status', 'ready');
	if (o.industry && isIndustry(o.industry)) q = q.eq('industry', o.industry);
	if (o.service && isService(o.service)) q = q.contains('services', [o.service]);
	if (o.type) q = q.eq('type', o.type);
	const { data, error } = await q.order('label').limit(limit);
	if (error) return { error };
	const url = supabaseUrl();
	return { items: ((data ?? []) as unknown as AssetRow[]).map((r) => publicAsset(r, url)) };
}

export interface SlotPick {
	slot: { key: string; item_kind: ItemKind; media_type: string; max_items: number; strategy: string };
	items: { placement_id: string; variant: string; item: ReturnType<typeof publicCaseStudy> | ReturnType<typeof publicTestimonial> | ReturnType<typeof publicAsset> }[];
}

/** GET /api/proof/slot/<key>: the items to show this time, each with its placement id for event logging. */
export async function publicSlot(key: string, n?: number): Promise<SlotPick | { error: { code?: string; message: string } } | null> {
	const db = createServiceRoleClient();
	const { data: slot, error: se } = await db.from('proof_slots').select(SLOT_COLUMNS).eq('key', key).eq('active', true).maybeSingle();
	if (se) return { error: se };
	if (!slot) return null;
	const s = slot as unknown as SlotRow;
	const { data: pls, error: pe } = await db.from('proof_placements').select(PLACEMENT_COLUMNS).eq('slot_key', key).eq('active', true);
	if (pe) return { error: pe };
	const placements = (pls ?? []) as unknown as PlacementRow[];
	// only placements whose item is still `ready`
	const ids = placements.map((p) => p.item_id);
	const table: string = s.item_kind === 'case_study' ? 'proof_case_studies' : s.item_kind === 'testimonial' ? 'proof_testimonials' : 'proof_assets';
	const cols: string = s.item_kind === 'case_study' ? CASE_STUDY_COLUMNS : s.item_kind === 'testimonial' ? TESTIMONIAL_COLUMNS : ASSET_COLUMNS;
	const { data: rows, error: re } = ids.length ? await db.from(table).select(cols).in('id', ids).eq('status', 'ready' satisfies ProofStatus) : { data: [], error: null };
	if (re) return { error: re };
	const byId = new Map<string, unknown>(((rows ?? []) as unknown as { id: string }[]).map((r) => [r.id, r]));
	const live = placements.filter((p) => byId.has(p.item_id));
	const picked = pickPlacements(live, Math.min(n ?? s.max_items, s.max_items), s.strategy);
	const url = supabaseUrl();
	return {
		slot: { key: s.key, item_kind: s.item_kind, media_type: s.media_type, max_items: s.max_items, strategy: s.strategy },
		items: picked.map((p) => {
			const row = byId.get(p.item_id);
			const item =
				s.item_kind === 'case_study' ? publicCaseStudy(row as CaseStudyRow) : s.item_kind === 'testimonial' ? publicTestimonial(row as TestimonialRow) : publicAsset(row as AssetRow, url);
			return { placement_id: p.id, variant: p.variant, item };
		}),
	};
}

export interface PublicSlotsFilter {
	page?: string | null;
	keys?: string[];
}

/**
 * GET /api/proof/slots: every active slot (optionally one page or a key
 * list) with its live placements and ready items. Four reads total: slots,
 * placements, then one `ready`-only query per referenced kind.
 */
export async function publicSlots(filter: PublicSlotsFilter = {}): Promise<SlotManifest | { error: { code?: string; message: string } }> {
	const db = createServiceRoleClient();
	let sq = db.from('proof_slots').select(SLOT_COLUMNS).eq('active', true);
	if (filter.page) sq = sq.eq('page', filter.page);
	if (filter.keys?.length) sq = sq.in('key', filter.keys);
	const { data: sd, error: se } = await sq.order('page').order('key');
	if (se) return { error: se };
	const slots = (sd ?? []) as unknown as SlotRow[];

	const keys = slots.map((s) => s.key);
	const { data: pd, error: pe } = keys.length
		? await db.from('proof_placements').select(PLACEMENT_COLUMNS).in('slot_key', keys).eq('active', true).limit(5000)
		: { data: [], error: null };
	if (pe) return { error: pe };
	const placements = (pd ?? []) as unknown as PlacementRow[];

	const ids = (kind: ItemKind) => Array.from(new Set(placements.filter((p) => p.item_kind === kind).map((p) => p.item_id)));
	const ready = 'ready' satisfies ProofStatus;
	const cIds = ids('case_study');
	const tIds = ids('testimonial');
	const aIds = ids('asset');
	const [c, t, a] = await Promise.all([
		cIds.length ? db.from('proof_case_studies').select(CASE_STUDY_COLUMNS).in('id', cIds).eq('status', ready) : null,
		tIds.length ? db.from('proof_testimonials').select(TESTIMONIAL_COLUMNS).in('id', tIds).eq('status', ready) : null,
		aIds.length ? db.from('proof_assets').select(ASSET_COLUMNS).in('id', aIds).eq('status', ready) : null,
	]);
	const re = c?.error ?? t?.error ?? a?.error;
	if (re) return { error: re };
	const toMap = <T extends { id: string }>(rows: unknown): Map<string, T> => new Map(((rows ?? []) as T[]).map((r) => [r.id, r]));

	return buildSlotManifest({
		slots,
		placements,
		itemsByKind: {
			case_study: toMap<CaseStudyRow>(c?.data),
			testimonial: toMap<TestimonialRow>(t?.data),
			asset: toMap<AssetRow>(a?.data),
		},
		supabaseUrl: supabaseUrl(),
	});
}

/** POST /api/proof/events: one event through the rate-limited RPC. */
export async function logProofEvent(input: { placement_id: string; event: string; ip_hash: string | null; session_id: string | null; page_url: string | null }): Promise<string> {
	const db = createServiceRoleClient();
	const { data, error } = await db.rpc('proof_log_event', {
		p_placement_id: input.placement_id,
		p_event: input.event,
		p_ip_hash: input.ip_hash,
		p_session_id: input.session_id,
		p_page_url: input.page_url,
	});
	if (error) return isNotApplied(error) ? 'not_applied' : `error:${error.message}`;
	return String(data);
}
