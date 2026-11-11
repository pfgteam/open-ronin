// Proof Library (0160) vocabulary, row shapes, public mappers and the slot
// selection rule. No server imports: client components and the public API
// both read from here.

export const PROOF_INDUSTRIES = [
	'legal',
	'finance',
	'cpg',
	'personal_brand',
	'professional_services',
	'luxury',
	'healthcare_wellness',
	'real_estate',
	'tech_saas',
	'nonprofit_impact',
	'hospitality_food_beverage',
	'sports_entertainment',
	'other',
] as const;
export type ProofIndustry = (typeof PROOF_INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<ProofIndustry, string> = {
	legal: 'Legal',
	finance: 'Finance',
	cpg: 'CPG',
	personal_brand: 'Personal brand',
	professional_services: 'Professional services',
	luxury: 'Luxury',
	healthcare_wellness: 'Healthcare & wellness',
	real_estate: 'Real estate',
	tech_saas: 'Tech / SaaS',
	nonprofit_impact: 'Nonprofit & impact',
	hospitality_food_beverage: 'Hospitality, food & beverage',
	sports_entertainment: 'Sports & entertainment',
	other: 'Other',
};

export const PROOF_SERVICES = ['pr', 'social', 'podcast', 'flywheel', 'beacon'] as const;
export type ProofService = (typeof PROOF_SERVICES)[number];
export const SERVICE_LABELS: Record<ProofService, string> = {
	pr: 'PR',
	social: 'Social',
	podcast: 'Podcast',
	flywheel: 'Flywheel (SEO / GEO)',
	beacon: 'Beacon',
};

export const PROOF_STATUSES = ['draft', 'ready', 'hidden'] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

export const ASSET_TYPES = ['press_logo', 'client_logo', 'stat', 'screenshot', 'video', 'image'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
	press_logo: 'Press logo',
	client_logo: 'Client logo',
	stat: 'Stat',
	screenshot: 'Screenshot',
	video: 'Video',
	image: 'Image',
};

export const ITEM_KINDS = ['case_study', 'testimonial', 'asset'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABELS: Record<ItemKind, string> = { case_study: 'Case study', testimonial: 'Testimonial', asset: 'Asset' };
/** URL segment <-> item kind (/prospects/proof/<segment>, /api/proof/<segment>). */
export const KIND_SEGMENTS: Record<ItemKind, string> = { case_study: 'case-studies', testimonial: 'testimonials', asset: 'assets' };
export function kindFromSegment(segment: string): ItemKind | null {
	const hit = (Object.entries(KIND_SEGMENTS) as [ItemKind, string][]).find(([, s]) => s === segment);
	return hit ? hit[0] : null;
}
export const KIND_TABLES: Record<ItemKind, string> = { case_study: 'proof_case_studies', testimonial: 'proof_testimonials', asset: 'proof_assets' };

export const SLOT_MEDIA_TYPES = ['text', 'video', 'image'] as const;
export type SlotMediaType = (typeof SLOT_MEDIA_TYPES)[number];
export const SLOT_STRATEGIES = ['weighted', 'bandit'] as const;
export type SlotStrategy = (typeof SLOT_STRATEGIES)[number];

export function isIndustry(v: unknown): v is ProofIndustry {
	return typeof v === 'string' && (PROOF_INDUSTRIES as readonly string[]).includes(v);
}
export function isService(v: unknown): v is ProofService {
	return typeof v === 'string' && (PROOF_SERVICES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface CaseStudyRow {
	id: string;
	slug: string;
	client_name: string;
	client_id: string | null;
	industry: ProofIndustry;
	services: ProofService[];
	year: number | null;
	headline: string | null;
	problem: string | null;
	approach: string | null;
	results: string | null;
	metrics: Record<string, unknown>;
	notable_outlets: string[];
	quote: string | null;
	quote_person: string | null;
	quote_title: string | null;
	media_type: 'text' | 'video';
	video_url: string | null;
	thumbnail_url: string | null;
	image_url: string | null;
	source_file_ids: string[];
	source_urls: string[];
	status: ProofStatus;
	is_featured: boolean;
	strength: number;
	tags: string[];
	created_at: string;
	updated_at: string;
}

export interface TestimonialRow {
	id: string;
	slug: string;
	quote: string;
	person: string | null;
	title: string | null;
	company: string | null;
	client_id: string | null;
	case_study_id: string | null;
	industry: ProofIndustry;
	services: ProofService[];
	media_type: 'text' | 'video' | 'image';
	video_url: string | null;
	thumbnail_url: string | null;
	image_url: string | null;
	source: string | null;
	source_file_ids: string[];
	source_urls: string[];
	rating: number | null;
	status: ProofStatus;
	is_featured: boolean;
	tags: string[];
	created_at: string;
	updated_at: string;
}

export interface AssetRow {
	id: string;
	type: AssetType;
	label: string;
	url: string | null;
	storage_path: string | null;
	thumbnail_url: string | null;
	value: string | null;
	description: string | null;
	client_id: string | null;
	case_study_id: string | null;
	industry: ProofIndustry;
	services: ProofService[];
	source_file_ids: string[];
	source_urls: string[];
	status: ProofStatus;
	tags: string[];
	created_at: string;
	updated_at: string;
}

export interface SlotRow {
	key: string;
	label: string;
	page: string;
	item_kind: ItemKind;
	media_type: SlotMediaType;
	max_items: number;
	strategy: SlotStrategy;
	industry: ProofIndustry | null;
	notes: string | null;
	active: boolean;
}

export interface PlacementRow {
	id: string;
	slot_key: string;
	item_kind: ItemKind;
	item_id: string;
	variant: string;
	weight: number;
	active: boolean;
	impressions: number;
	clicks: number;
	conversions: number;
	starts_at: string | null;
	ends_at: string | null;
	created_at: string;
}

export interface SlotWithPlacements extends SlotRow {
	placements: (PlacementRow & { label: string })[];
}

export const CASE_STUDY_COLUMNS =
	'id, slug, client_name, client_id, industry, services, year, headline, problem, approach, results, metrics, notable_outlets, quote, quote_person, quote_title, media_type, video_url, thumbnail_url, image_url, source_file_ids, source_urls, status, is_featured, strength, tags, created_at, updated_at';
export const TESTIMONIAL_COLUMNS =
	'id, slug, quote, person, title, company, client_id, case_study_id, industry, services, media_type, video_url, thumbnail_url, image_url, source, source_file_ids, source_urls, rating, status, is_featured, tags, created_at, updated_at';
export const ASSET_COLUMNS =
	'id, type, label, url, storage_path, thumbnail_url, value, description, client_id, case_study_id, industry, services, source_file_ids, source_urls, status, tags, created_at, updated_at';
export const SLOT_COLUMNS = 'key, label, page, item_kind, media_type, max_items, strategy, industry, notes, active';
export const PLACEMENT_COLUMNS = 'id, slot_key, item_kind, item_id, variant, weight, active, impressions, clicks, conversions, starts_at, ends_at, created_at';

// ---------------------------------------------------------------------------
// Public shapes (what /api/proof/* returns to the website). Source file ids
// and raw extraction never leave the building.
// ---------------------------------------------------------------------------

/** Public URL of an object in the proof-assets bucket. */
export function storageUrl(supabaseUrl: string, path: string | null): string | null {
	if (!path) return null;
	return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/proof-assets/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function publicCaseStudy(r: CaseStudyRow) {
	return {
		id: r.id,
		kind: 'case_study' as const,
		slug: r.slug,
		client_name: r.client_name,
		industry: r.industry,
		services: r.services,
		year: r.year,
		headline: r.headline,
		problem: r.problem,
		approach: r.approach,
		results: r.results,
		metrics: r.metrics,
		notable_outlets: r.notable_outlets,
		quote: r.quote,
		quote_person: r.quote_person,
		quote_title: r.quote_title,
		media_type: r.media_type,
		video_url: r.video_url,
		thumbnail_url: r.thumbnail_url,
		image_url: r.image_url,
		is_featured: r.is_featured,
		tags: r.tags,
	};
}
export type PublicCaseStudy = ReturnType<typeof publicCaseStudy>;

export function publicTestimonial(r: TestimonialRow) {
	return {
		id: r.id,
		kind: 'testimonial' as const,
		slug: r.slug,
		quote: r.quote,
		person: r.person,
		title: r.title,
		company: r.company,
		// Aliases the website client (openronin-web lib/proof.ts) reads for every slot item.
		quote_person: r.person,
		quote_title: [r.title, r.company].filter(Boolean).join(', ') || null,
		industry: r.industry,
		services: r.services,
		media_type: r.media_type,
		video_url: r.video_url,
		thumbnail_url: r.thumbnail_url,
		image_url: r.image_url,
		rating: r.rating,
		is_featured: r.is_featured,
		tags: r.tags,
	};
}
export type PublicTestimonial = ReturnType<typeof publicTestimonial>;

export function publicAsset(r: AssetRow, supabaseUrl: string) {
	return {
		id: r.id,
		kind: 'asset' as const,
		type: r.type,
		label: r.label,
		url: r.url ?? storageUrl(supabaseUrl, r.storage_path),
		thumbnail_url: r.thumbnail_url,
		value: r.value,
		description: r.description,
		industry: r.industry,
		services: r.services,
		tags: r.tags,
	};
}
export type PublicAsset = ReturnType<typeof publicAsset>;

// ---------------------------------------------------------------------------
// Selection: which placements a slot shows this time.
// ---------------------------------------------------------------------------

export interface Pickable {
	id: string;
	weight: number;
	active: boolean;
	impressions: number;
	clicks: number;
	starts_at?: string | null;
	ends_at?: string | null;
}

/** Live right now: active, inside its window, with a positive weight. */
export function isLive(p: Pickable, now = Date.now()): boolean {
	if (!p.active || p.weight <= 0) return false;
	if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
	if (p.ends_at && new Date(p.ends_at).getTime() < now) return false;
	return true;
}

const BANDIT_MIN_IMPRESSIONS = 50;
const BANDIT_EXPLORE = 0.1;

/**
 * Pick up to `n` distinct placements for a slot.
 *
 * weighted: weighted random without replacement (weight 200 shows twice as
 * often as 100). bandit: epsilon-greedy on click-through — 90% of the time
 * the best measured CTR among placements with 50+ impressions leads, the
 * rest is the weighted draw, so a new placement still gets seen. `rand` is
 * injectable for tests.
 */
export function pickPlacements<T extends Pickable>(
	placements: T[],
	n: number,
	strategy: SlotStrategy = 'weighted',
	rand: () => number = Math.random,
	now = Date.now(),
): T[] {
	const pool = placements.filter((p) => isLive(p, now));
	const out: T[] = [];
	if (strategy === 'bandit' && pool.length > 1 && rand() >= BANDIT_EXPLORE) {
		const measured = pool.filter((p) => p.impressions >= BANDIT_MIN_IMPRESSIONS);
		if (measured.length) {
			const best = measured.reduce((a, b) => (b.clicks / b.impressions > a.clicks / a.impressions ? b : a));
			out.push(best);
		}
	}
	while (out.length < n && out.length < pool.length) {
		const rest = pool.filter((p) => !out.includes(p));
		const total = rest.reduce((s, p) => s + p.weight, 0);
		let r = rand() * total;
		let chosen = rest[rest.length - 1];
		for (const p of rest) {
			r -= p.weight;
			if (r < 0) {
				chosen = p;
				break;
			}
		}
		out.push(chosen);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Manifest: every active slot with its live, ready items (GET /api/proof/slots).
// ---------------------------------------------------------------------------

export type PublicProofItem = PublicCaseStudy | PublicTestimonial | PublicAsset;

export interface SlotManifestItem {
	placement_id: string;
	variant: string;
	weight: number;
	item: PublicProofItem;
}

export interface SlotManifestEntry {
	key: string;
	label: string;
	page: string;
	item_kind: ItemKind;
	media_type: SlotMediaType;
	max_items: number;
	strategy: SlotStrategy;
	industry: ProofIndustry | null;
	items: SlotManifestItem[];
}

export interface SlotManifest {
	generated_at: string;
	slots: SlotManifestEntry[];
}

export interface ReadyItemMaps {
	case_study: Map<string, CaseStudyRow>;
	testimonial: Map<string, TestimonialRow>;
	asset: Map<string, AssetRow>;
}

/**
 * The cached manifest the website renders from. Only active slots; only
 * placements that are live now and whose item is in the `ready` map (the
 * query enforces ready-only, the lookup enforces it here). Items are sorted
 * by weight desc, then placement age, and go through the public mappers, so
 * source files, status and impression / click counts never leave. Slots with
 * nothing live stay listed with `items: []` so the site can fall back.
 */
export function buildSlotManifest(input: {
	slots: SlotRow[];
	placements: PlacementRow[];
	itemsByKind: ReadyItemMaps;
	supabaseUrl: string;
	now?: number;
}): SlotManifest {
	const now = input.now ?? Date.now();
	const bySlot = new Map<string, PlacementRow[]>();
	for (const p of input.placements) {
		const list = bySlot.get(p.slot_key);
		if (list) list.push(p);
		else bySlot.set(p.slot_key, [p]);
	}
	const toItem = (kind: ItemKind, id: string): PublicProofItem | null => {
		if (kind === 'case_study') {
			const r = input.itemsByKind.case_study.get(id);
			return r ? publicCaseStudy(r) : null;
		}
		if (kind === 'testimonial') {
			const r = input.itemsByKind.testimonial.get(id);
			return r ? publicTestimonial(r) : null;
		}
		const r = input.itemsByKind.asset.get(id);
		return r ? publicAsset(r, input.supabaseUrl) : null;
	};
	const slots = input.slots
		.filter((s) => s.active)
		.map((s): SlotManifestEntry => {
			const live = (bySlot.get(s.key) ?? [])
				.filter((p) => p.item_kind === s.item_kind && isLive(p, now))
				.sort((a, b) => b.weight - a.weight || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
			const items: SlotManifestItem[] = [];
			for (const p of live) {
				const item = toItem(p.item_kind, p.item_id);
				if (item) items.push({ placement_id: p.id, variant: p.variant, weight: p.weight, item });
			}
			return {
				key: s.key,
				label: s.label,
				page: s.page,
				item_kind: s.item_kind,
				media_type: s.media_type,
				max_items: s.max_items,
				strategy: s.strategy,
				industry: s.industry,
				items,
			};
		});
	return { generated_at: new Date(now).toISOString(), slots };
}

/** Click-through as a percentage string for the admin table. */
export function ctr(impressions: number, clicks: number): string {
	if (!impressions) return '–';
	return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

/** Slug from a client name: "Acme Legal, Inc." -> "acme-legal-inc". */
export function slugify(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80) || 'item';
}

/** Comma / newline separated input -> trimmed unique list. */
export function splitList(v: string | null | undefined): string[] {
	if (!v) return [];
	return Array.from(new Set(v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)));
}
