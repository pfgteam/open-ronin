import { describe, expect, it } from 'vitest';
import {
	buildSlotManifest,
	ctr,
	isLive,
	kindFromSegment,
	pickPlacements,
	slugify,
	splitList,
	storageUrl,
	type AssetRow,
	type CaseStudyRow,
	type PlacementRow,
	type SlotRow,
	type TestimonialRow,
} from './shared';

const base = { active: true, impressions: 0, clicks: 0, starts_at: null, ends_at: null };
const seq = (values: number[]) => {
	let i = 0;
	return () => values[i++ % values.length];
};

describe('pickPlacements', () => {
	it('skips inactive, zero-weight and out-of-window placements', () => {
		const now = Date.parse('2026-10-27T12:00:00Z');
		const rows = [
			{ ...base, id: 'off', weight: 100, active: false },
			{ ...base, id: 'zero', weight: 0 },
			{ ...base, id: 'future', weight: 100, starts_at: '2027-01-01T00:00:00Z' },
			{ ...base, id: 'past', weight: 100, ends_at: '2026-01-01T00:00:00Z' },
			{ ...base, id: 'live', weight: 100 },
		];
		expect(rows.filter((r) => isLive(r, now)).map((r) => r.id)).toEqual(['live']);
		expect(pickPlacements(rows, 3, 'weighted', () => 0.5, now).map((r) => r.id)).toEqual(['live']);
	});

	it('weighted draw honours weights and never repeats an item', () => {
		const rows = [
			{ ...base, id: 'a', weight: 100 },
			{ ...base, id: 'b', weight: 300 },
		];
		// r = 0.1 * 400 = 40 -> a; next draw only b remains
		expect(pickPlacements(rows, 2, 'weighted', seq([0.1])).map((r) => r.id)).toEqual(['a', 'b']);
		// r = 0.5 * 400 = 200 -> past a (100), lands in b
		expect(pickPlacements(rows, 1, 'weighted', seq([0.5])).map((r) => r.id)).toEqual(['b']);
		expect(pickPlacements(rows, 5, 'weighted', seq([0.9, 0.9]))).toHaveLength(2);
	});

	it('bandit leads with the best measured CTR, explores 10% of the time', () => {
		const rows = [
			{ ...base, id: 'new', weight: 100, impressions: 5, clicks: 5 },
			{ ...base, id: 'good', weight: 100, impressions: 200, clicks: 20 },
			{ ...base, id: 'meh', weight: 100, impressions: 200, clicks: 2 },
		];
		// first rand 0.5 >= 0.1 -> exploit: good; then weighted fill
		expect(pickPlacements(rows, 2, 'bandit', seq([0.5, 0.0]))[0].id).toBe('good');
		// first rand 0.05 < 0.1 -> explore: plain weighted draw, r = 0.0 -> new
		expect(pickPlacements(rows, 1, 'bandit', seq([0.05, 0.0]))[0].id).toBe('new');
		// nothing measured yet: weighted
		const fresh = rows.map((r) => ({ ...r, impressions: 1 }));
		expect(pickPlacements(fresh, 1, 'bandit', seq([0.5, 0.0]))[0].id).toBe('new');
	});

	it('returns nothing from an empty pool', () => {
		expect(pickPlacements([], 3)).toEqual([]);
	});
});

describe('helpers', () => {
	it('ctr formats and guards zero', () => {
		expect(ctr(0, 0)).toBe('–');
		expect(ctr(200, 7)).toBe('3.5%');
	});
	it('slugify', () => {
		expect(slugify('Acme Legal, Inc.')).toBe('acme-legal-inc');
		expect(slugify('  ')).toBe('item');
	});
	it('splitList dedupes on commas and newlines', () => {
		expect(splitList('Forbes, Inc\nForbes,,')).toEqual(['Forbes', 'Inc']);
		expect(splitList(null)).toEqual([]);
	});
	it('kindFromSegment maps the url words', () => {
		expect(kindFromSegment('case-studies')).toBe('case_study');
		expect(kindFromSegment('bogus')).toBeNull();
	});
	it('storageUrl builds a public bucket url', () => {
		expect(storageUrl('https://x.supabase.co/', 'logos/a b.png')).toBe('https://x.supabase.co/storage/v1/object/public/proof-assets/logos/a%20b.png');
		expect(storageUrl('https://x.supabase.co', null)).toBeNull();
	});
});

describe('buildSlotManifest', () => {
	const NOW = Date.parse('2026-11-05T12:00:00Z');
	const slot = (key: string, item_kind: SlotRow['item_kind'], over: Partial<SlotRow> = {}): SlotRow => ({
		key,
		label: key,
		page: key.split('.')[0],
		item_kind,
		media_type: 'text',
		max_items: 3,
		strategy: 'weighted',
		industry: null,
		notes: 'internal note',
		active: true,
		...over,
	});
	const pl = (id: string, slot_key: string, item_kind: PlacementRow['item_kind'], item_id: string, over: Partial<PlacementRow> = {}): PlacementRow => ({
		id,
		slot_key,
		item_kind,
		item_id,
		variant: 'a',
		weight: 100,
		active: true,
		impressions: 1234,
		clicks: 56,
		conversions: 7,
		starts_at: null,
		ends_at: null,
		created_at: '2026-10-01T00:00:00Z',
		...over,
	});
	const cs = (id: string): CaseStudyRow => ({
		id,
		slug: id,
		client_name: `Client ${id}`,
		client_id: 'client-uuid',
		industry: 'legal',
		services: ['pr'],
		year: 2025,
		headline: `Headline ${id}`,
		problem: null,
		approach: null,
		results: null,
		metrics: {},
		notable_outlets: [],
		quote: 'Great',
		quote_person: 'Pat',
		quote_title: 'CEO',
		media_type: 'text',
		video_url: null,
		thumbnail_url: null,
		image_url: null,
		source_file_ids: ['secret-file'],
		source_urls: ['https://internal'],
		status: 'ready',
		is_featured: false,
		strength: 5,
		tags: [],
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	});
	const tm = (id: string): TestimonialRow => ({
		id,
		slug: id,
		quote: `Quote ${id}`,
		person: 'Sam',
		title: 'Founder',
		company: 'Acme',
		client_id: null,
		case_study_id: null,
		industry: 'finance',
		services: ['social'],
		media_type: 'video',
		video_url: 'https://v',
		thumbnail_url: 'https://t',
		image_url: null,
		source: 'email',
		source_file_ids: ['secret-file'],
		source_urls: [],
		rating: 5,
		status: 'ready',
		is_featured: true,
		tags: [],
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	});
	const asset = (id: string): AssetRow => ({
		id,
		type: 'press_logo',
		label: 'Forbes',
		url: null,
		storage_path: 'logos/forbes.svg',
		thumbnail_url: null,
		value: null,
		description: null,
		client_id: null,
		case_study_id: null,
		industry: 'other',
		services: [],
		source_file_ids: ['secret-file'],
		source_urls: [],
		status: 'ready',
		tags: [],
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	});
	// Ready maps: c1..c4, t1, a1 are ready; 'draft-cs' / 'hidden-t' are absent (the query filtered them out).
	const itemsByKind = {
		case_study: new Map(['c1', 'c2', 'c3', 'c4'].map((id) => [id, cs(id)])),
		testimonial: new Map([['t1', tm('t1')]]),
		asset: new Map([['a1', asset('a1')]]),
	};
	const build = (slots: SlotRow[], placements: PlacementRow[]) => buildSlotManifest({ slots, placements, itemsByKind, supabaseUrl: 'https://x.supabase.co/', now: NOW });

	it('lists only active slots, and keeps empty ones with items []', () => {
		const m = build([slot('home.case_studies', 'case_study'), slot('home.off', 'case_study', { active: false }), slot('legal.hero_proof', 'case_study', { industry: 'legal' })], []);
		expect(m.generated_at).toBe('2026-11-05T12:00:00.000Z');
		expect(m.slots.map((s) => s.key)).toEqual(['home.case_studies', 'legal.hero_proof']);
		expect(m.slots.every((s) => Array.isArray(s.items) && s.items.length === 0)).toBe(true);
		expect(m.slots[1]).toEqual({
			key: 'legal.hero_proof',
			label: 'legal.hero_proof',
			page: 'legal',
			item_kind: 'case_study',
			media_type: 'text',
			max_items: 3,
			strategy: 'weighted',
			industry: 'legal',
			items: [],
		});
	});

	it('drops placements that are not live (inactive, weight 0, outside the window)', () => {
		const m = build(
			[slot('home.case_studies', 'case_study')],
			[
				pl('p-off', 'home.case_studies', 'case_study', 'c1', { active: false }),
				pl('p-zero', 'home.case_studies', 'case_study', 'c1', { weight: 0 }),
				pl('p-future', 'home.case_studies', 'case_study', 'c2', { starts_at: '2027-01-01T00:00:00Z' }),
				pl('p-past', 'home.case_studies', 'case_study', 'c3', { ends_at: '2026-01-01T00:00:00Z' }),
				pl('p-live', 'home.case_studies', 'case_study', 'c4', { starts_at: '2026-01-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' }),
			],
		);
		expect(m.slots[0].items.map((i) => i.placement_id)).toEqual(['p-live']);
	});

	it('drops placements whose item is not ready (absent from the ready map) or belongs to another slot', () => {
		const m = build(
			[slot('home.case_studies', 'case_study'), slot('home.testimonials_video', 'testimonial', { media_type: 'video' })],
			[
				pl('p-draft', 'home.case_studies', 'case_study', 'draft-cs'),
				pl('p-ok', 'home.case_studies', 'case_study', 'c1'),
				pl('p-hidden', 'home.testimonials_video', 'testimonial', 'hidden-t'),
				pl('p-t', 'home.testimonials_video', 'testimonial', 't1'),
				pl('p-orphan', 'home.gone', 'case_study', 'c2'),
			],
		);
		expect(m.slots.map((s) => [s.key, s.items.map((i) => i.placement_id)])).toEqual([
			['home.case_studies', ['p-ok']],
			['home.testimonials_video', ['p-t']],
		]);
	});

	it('sorts items by weight desc, then placement created_at', () => {
		const m = build(
			[slot('home.case_studies', 'case_study')],
			[
				pl('p-low', 'home.case_studies', 'case_study', 'c1', { weight: 50 }),
				pl('p-new', 'home.case_studies', 'case_study', 'c2', { weight: 200, created_at: '2026-10-20T00:00:00Z' }),
				pl('p-old', 'home.case_studies', 'case_study', 'c3', { weight: 200, created_at: '2026-10-02T00:00:00Z' }),
				pl('p-mid', 'home.case_studies', 'case_study', 'c4', { weight: 100 }),
			],
		);
		expect(m.slots[0].items.map((i) => [i.placement_id, i.weight])).toEqual([
			['p-old', 200],
			['p-new', 200],
			['p-mid', 100],
			['p-low', 50],
		]);
	});

	it('maps items through the public mappers and strips internal fields', () => {
		const m = build(
			[slot('home.case_studies', 'case_study'), slot('home.testimonials_video', 'testimonial'), slot('home.press_logos', 'asset', { media_type: 'image' })],
			[
				pl('p-c', 'home.case_studies', 'case_study', 'c1', { variant: 'b' }),
				pl('p-t', 'home.testimonials_video', 'testimonial', 't1'),
				pl('p-a', 'home.press_logos', 'asset', 'a1'),
			],
		);
		const [c, t, a] = m.slots.map((s) => s.items[0]);
		expect(Object.keys(c).sort()).toEqual(['item', 'placement_id', 'variant', 'weight']);
		expect(c.variant).toBe('b');
		expect(c.item).toMatchObject({ id: 'c1', kind: 'case_study', client_name: 'Client c1', headline: 'Headline c1', quote_person: 'Pat', quote_title: 'CEO', industry: 'legal' });
		expect(t.item).toMatchObject({ id: 't1', kind: 'testimonial', quote: 'Quote t1', quote_person: 'Sam', quote_title: 'Founder, Acme', media_type: 'video', video_url: 'https://v', thumbnail_url: 'https://t' });
		expect(a.item).toMatchObject({ id: 'a1', kind: 'asset', label: 'Forbes', url: 'https://x.supabase.co/storage/v1/object/public/proof-assets/logos/forbes.svg' });
		const json = JSON.stringify(m);
		for (const k of ['source_file_ids', 'source_urls', 'storage_path', 'status', 'impressions', 'clicks', 'conversions', 'client_id', 'notes', 'secret-file', 'starts_at', 'ends_at']) {
			expect(json).not.toContain(k);
		}
	});
});
