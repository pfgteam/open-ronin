import { describe, expect, it } from 'vitest';
import { addBusinessDays, businessDaysBetween, clusterProgress, intakeGaps, pageChecklist, type ChannelRow } from './shared';

const channels: ChannelRow[] = [
	{ key: 'medium', label: 'Medium', sort: 1, per_page_min: 1, per_page_max: 1, per_cluster: 0, why: null, non_promotional: false, poster_default: 'person', is_active: true },
	{ key: 'quora_answer', label: 'Quora answers', sort: 2, per_page_min: 5, per_page_max: 10, per_cluster: 0, why: null, non_promotional: true, poster_default: 'person', is_active: true },
	{ key: 'podcast', label: 'Podcast', sort: 3, per_page_min: 0, per_page_max: 0, per_cluster: 1, why: null, non_promotional: false, poster_default: 'fourth_pillar', is_active: true },
];

describe('business days', () => {
	it('skips weekends when adding', () => {
		// Fri 2026-10-02 + 3 business days = Wed 2026-10-07
		expect(addBusinessDays(new Date('2026-10-02T15:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2026-10-07');
	});
	it('counts Mon-Fri between dates', () => {
		expect(businessDaysBetween(new Date('2026-10-02T00:00:00Z'), new Date('2026-10-07T00:00:00Z'))).toBe(3);
		expect(businessDaysBetween(new Date('2026-10-07T00:00:00Z'), new Date('2026-10-02T00:00:00Z'))).toBe(-3);
	});
});

describe('clusterProgress', () => {
	const now = new Date('2026-11-16T00:00:00Z'); // day 45 of a cluster started Oct 2
	const cluster = { starts_on: '2026-10-02', ends_on: '2026-12-31' };
	it('reads on-pace delivery as not behind', () => {
		const pages = Array.from({ length: 10 }, (_, i) => ({ status: i < 5 ? ('live' as const) : ('planned' as const), target_citations: 20, citation_wave_due_at: null, citation_wave_done_at: i < 5 ? '2026-10-10' : null, live_at: i < 5 ? '2026-10-05' : null }));
		const citations = Array.from({ length: 100 }, () => ({ status: 'posted' as const, page_id: 'p' }));
		const r = clusterProgress(cluster, pages, citations, now);
		expect(r.pages_live).toBe(5);
		expect(r.citations_shipped).toBe(100);
		expect(r.pct_time).toBe(50);
		expect(r.behind).toBe(false);
	});
	it('flags a cluster whose pages lag time by more than 15 points', () => {
		const pages = Array.from({ length: 10 }, () => ({ status: 'planned' as const, target_citations: 20, citation_wave_due_at: null, citation_wave_done_at: null, live_at: null }));
		const r = clusterProgress(cluster, pages, [], now);
		expect(r.behind).toBe(true);
		expect(r.citations_target).toBe(200);
	});
	it('flags an overdue citation wave even when counts are fine', () => {
		const pages = [{ status: 'live' as const, target_citations: 20, citation_wave_due_at: '2026-11-10T00:00:00Z', citation_wave_done_at: null, live_at: '2026-11-07T00:00:00Z' }];
		const r = clusterProgress({ starts_on: '2026-10-02', ends_on: '2026-12-31' }, pages, Array.from({ length: 20 }, () => ({ status: 'posted' as const, page_id: 'x' })), now);
		expect(r.waves_overdue).toBe(1);
		expect(r.behind).toBe(true);
	});
	it('gives month 1 grace', () => {
		const pages = Array.from({ length: 10 }, () => ({ status: 'planned' as const, target_citations: 20, citation_wave_due_at: null, citation_wave_done_at: null, live_at: null }));
		expect(clusterProgress(cluster, pages, [], new Date('2026-10-15T00:00:00Z')).behind).toBe(false);
	});
});

describe('pageChecklist', () => {
	it('one row per per-page channel with shipped vs min', () => {
		const rows = pageChecklist(channels, [
			{ channel_key: 'medium', status: 'posted' },
			{ channel_key: 'quora_answer', status: 'posted' },
			{ channel_key: 'quora_answer', status: 'planned' },
		]);
		expect(rows).toHaveLength(2); // podcast is per cluster
		expect(rows[0].done).toBe(true);
		expect(rows[1]).toMatchObject({ planned: 2, shipped: 1, done: false, target_min: 5 });
	});
});

describe('intakeGaps', () => {
	it('lists what the SOP minimum still needs', () => {
		const gaps = intakeGaps({ brand_name: 'MINT', primary_url: null, competitors: ['a', 'b'], keywords: ['k1', 'k2', 'k3', 'k4', 'k5'], icp_md: 'pros', sme_name: null, access: { gbp: true } }, 4);
		expect(gaps).toEqual(['primary URL', '3 competitors', 'SME nominated', 'Search Console access', 'Analytics access', 'site backend / dev contact', '2 more verifiable facts']);
	});
	it('is empty when complete', () => {
		expect(intakeGaps({ brand_name: 'x', primary_url: 'u', competitors: ['a', 'b', 'c'], keywords: ['1', '2', '3', '4', '5'], icp_md: 'i', sme_name: 's', access: { gbp: true, search_console: true, analytics: true, site_backend: true } }, 6)).toEqual([]);
	});
});
