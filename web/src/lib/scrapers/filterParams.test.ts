import { describe, it, expect } from 'vitest';
import {
	parseFilterParams,
	filtersToSearchParams,
	filtersFromJobParams,
	filtersEqual,
	DEFAULT_MAX_RESULTS,
	type LeadFilters,
} from './filterParams';

describe('parseFilterParams', () => {
	it('reads multi-value filters off f.* keys', () => {
		expect(
			parseFilterParams({ 'f.industry': ['cosmetics', 'retail'], 'f.seniority': ['founder'] }),
		).toMatchObject({ industry: ['cosmetics', 'retail'], seniority: ['founder'] });
	});

	// Next.js hands a key that appears ONCE as a bare string, not a one-element
	// array. Treating that as a string is how a single-industry filter silently
	// disappears — or worse, gets spread into characters.
	it('normalises a single-occurrence key to a one-element array', () => {
		const f = parseFilterParams({ 'f.industry': 'cosmetics' });
		expect(f.industry).toEqual(['cosmetics']);
	});

	it('yields empty arrays, not undefined, for absent keys', () => {
		const f = parseFilterParams({});
		expect(f.industry).toEqual([]);
		expect(f.city).toEqual([]);
		expect(f.emailStatus).toEqual([]);
	});

	// The actor validates against its own enums, so a hand-edited URL must not
	// reach createJob with a value the actor will reject or silently ignore.
	it('drops values outside the preset vocabulary', () => {
		const f = parseFilterParams({ 'f.industry': ['cosmetics', 'not-a-real-industry'] });
		expect(f.industry).toEqual(['cosmetics']);
	});

	it('keeps free-text lists as typed, since they have no vocabulary', () => {
		const f = parseFilterParams({ 'f.city': ['HQ', 'Alex'], 'f.keywords': 'supplements' });
		expect(f.city).toEqual(['HQ', 'Alex']);
		expect(f.keywords).toEqual(['supplements']);
	});

	it('reads the single-valued revenue bounds', () => {
		const f = parseFilterParams({ 'f.minRevenue': '1M', 'f.maxRevenue': '50M' });
		expect(f.minRevenue).toBe('1M');
		expect(f.maxRevenue).toBe('50M');
	});

	it('drops a revenue bound outside the vocabulary', () => {
		expect(parseFilterParams({ 'f.minRevenue': '3M' }).minRevenue).toBeUndefined();
	});

	describe('maxResults', () => {
		it('falls back to the default when absent', () => {
			expect(parseFilterParams({}).maxResults).toBe(DEFAULT_MAX_RESULTS);
		});

		it('falls back when unparseable', () => {
			expect(parseFilterParams({ 'f.maxResults': 'abc' }).maxResults).toBe(DEFAULT_MAX_RESULTS);
		});

		it('reads a valid value', () => {
			expect(parseFilterParams({ 'f.maxResults': '1000' }).maxResults).toBe(1000);
		});

		// 0041 has a CHECK capping this; a URL must not carry a value the insert
		// would reject.
		it('clamps out-of-range values to the allowed span', () => {
			expect(parseFilterParams({ 'f.maxResults': '999999' }).maxResults).toBe(5000);
			expect(parseFilterParams({ 'f.maxResults': '0' }).maxResults).toBe(1);
		});

		it('floors a fractional value', () => {
			expect(parseFilterParams({ 'f.maxResults': '250.7' }).maxResults).toBe(250);
		});
	});
});

describe('filtersToSearchParams', () => {
	it('round-trips through parseFilterParams', () => {
		const original: LeadFilters = {
			seniority: ['founder', 'c_suite'],
			functionArea: ['marketing'],
			industry: ['cosmetics'],
			size: ['11-20'],
			location: ['united states'],
			city: ['HQ'],
			jobTitle: ['Head of Brand'],
			keywords: ['supplements'],
			emailStatus: ['validated'],
			minRevenue: '1M',
			maxRevenue: '50M',
			maxResults: 500,
		};
		const sp = filtersToSearchParams(original);
		// Simulate what Next hands a page: repeated keys collapse to arrays,
		// single keys stay strings.
		const asRecord: Record<string, string | string[]> = {};
		for (const key of new Set(sp.keys())) {
			const all = sp.getAll(key);
			asRecord[key] = all.length === 1 ? all[0] : all;
		}
		expect(parseFilterParams(asRecord)).toEqual(original);
	});

	it('omits empty filters rather than emitting bare keys', () => {
		const sp = filtersToSearchParams({ industry: [], city: [], maxResults: 250 });
		expect(sp.has('f.industry')).toBe(false);
		expect(sp.has('f.city')).toBe(false);
	});

	it('emits one entry per value for a multi-value filter', () => {
		const sp = filtersToSearchParams({ industry: ['cosmetics', 'retail'], maxResults: 250 });
		expect(sp.getAll('f.industry')).toEqual(['cosmetics', 'retail']);
	});
});

describe('filtersFromJobParams', () => {
	it('reads a stored B2B job back into filters', () => {
		const f = filtersFromJobParams({ industry: ['cosmetics'], seniority: ['founder'] }, 500);
		expect(f.industry).toEqual(['cosmetics']);
		expect(f.seniority).toEqual(['founder']);
		expect(f.maxResults).toBe(500);
	});

	// A trade-show job's targeting IS the URL; it has no ICP filters at all.
	// Selecting one must not throw and must not invent filters.
	it('handles a trade-show job, whose params are just a url', () => {
		const f = filtersFromJobParams({ url: 'https://example.com/exhibitors' }, 250);
		expect(f.industry).toEqual([]);
		expect(f.seniority).toEqual([]);
		expect(f.maxResults).toBe(250);
	});

	it('tolerates junk in a stored params blob', () => {
		const f = filtersFromJobParams({ industry: 'not-an-array', bogus: 42 }, 250);
		expect(f.industry).toEqual([]);
	});

	it('falls back to the default max when none is given', () => {
		expect(filtersFromJobParams({}, null).maxResults).toBe(DEFAULT_MAX_RESULTS);
	});
});

describe('filtersEqual', () => {
	const base: LeadFilters = { industry: ['cosmetics', 'retail'], maxResults: 250 };

	it('is true for the same filters', () => {
		expect(filtersEqual(base, { industry: ['cosmetics', 'retail'], maxResults: 250 })).toBe(true);
	});

	// The rail renders checkboxes in preset order; a stored job may have them in
	// whatever order it was submitted. Order must not read as "changed", or the
	// dirty notice cries wolf every time an old run is selected.
	it('ignores array order', () => {
		expect(filtersEqual(base, { industry: ['retail', 'cosmetics'], maxResults: 250 })).toBe(true);
	});

	it('is false when content differs', () => {
		expect(filtersEqual(base, { industry: ['cosmetics'], maxResults: 250 })).toBe(false);
	});

	it('is false when maxResults differs — it changes what the run costs', () => {
		expect(filtersEqual(base, { industry: ['cosmetics', 'retail'], maxResults: 1000 })).toBe(false);
	});

	it('is false when a revenue bound differs', () => {
		expect(filtersEqual({ maxResults: 250 }, { maxResults: 250, minRevenue: '1M' })).toBe(false);
	});

	it('treats an absent filter and an empty one as the same', () => {
		expect(filtersEqual({ maxResults: 250 }, { industry: [], city: [], maxResults: 250 })).toBe(true);
	});
});
