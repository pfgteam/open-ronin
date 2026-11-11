import { describe, expect, it } from 'vitest';
import {
	contactsHref, legacyDealsHref, pageRange, pageWindow, parseContactsFilters, parsePipelineFilters, pipelineHref, resolveBoardPipeline,
} from './listParams';

const UUID = '3f2b8c1e-1111-4222-8333-944455556666';

describe('parsePipelineFilters', () => {
	it('defaults: board, open, recent desc, page 1, size 50', () => {
		expect(parsePipelineFilters({})).toEqual({ view: 'board', pipeline: null, stage: null, owner: null, defaultOwner: null, source: null, status: 'open', q: null, sort: 'recent', dir: 'desc', page: 1, size: 50 });
	});
	it('every pipeline opens on the board; an explicit view wins', () => {
		expect(parsePipelineFilters({ pipeline: 'closer' }).view).toBe('board');
		expect(parsePipelineFilters({ pipeline: 'lead-gen' }).view).toBe('board');
		expect(parsePipelineFilters({ pipeline: 'marketing', view: 'table' }).view).toBe('table');
	});
	it('accepts known values and drops unknown ones', () => {
		const f = parsePipelineFilters({ stage: UUID, owner: UUID, source: 'scrape', status: 'won', q: ' glow ', sort: 'value', page: '3', size: '100' });
		expect(f).toMatchObject({ stage: UUID, owner: UUID, source: 'scrape', status: 'won', q: 'glow', sort: 'value', dir: 'desc', page: 3, size: 100 });
		expect(parsePipelineFilters({ stage: 'x', owner: 'bob', source: 'fax', status: 'x', sort: 'x', page: '-2', size: '7', pipeline: 'Bad Slug!' }))
			.toMatchObject({ stage: null, owner: null, source: null, status: 'open', sort: 'recent', page: 1, size: 50, pipeline: null });
		expect(parsePipelineFilters({ owner: 'me' }).owner).toBe('me');
		expect(parsePipelineFilters({ sort: 'title' }).dir).toBe('asc');
		expect(parsePipelineFilters({ sort: 'title', dir: 'desc' }).dir).toBe('desc');
	});
});

describe('rep default owner', () => {
	it('a rep opens on their own deals and can still ask for everyone', () => {
		const mine = parsePipelineFilters({}, 'me');
		expect(mine.owner).toBe('me');
		expect(pipelineHref(mine)).toBe('/prospects');
		const anyone = parsePipelineFilters({ owner: 'all' }, 'me');
		expect(anyone.owner).toBeNull();
		expect(pipelineHref(mine, { owner: null })).toBe('/prospects?owner=all');
		expect(pipelineHref(anyone, { owner: 'me' })).toBe('/prospects');
		expect(pipelineHref(mine, { owner: UUID })).toBe(`/prospects?owner=${UUID}`);
	});
	it('everyone else keeps anyone as the default', () => {
		expect(parsePipelineFilters({}).owner).toBeNull();
		expect(parsePipelineFilters({ owner: 'all' }).owner).toBeNull();
		expect(pipelineHref(parsePipelineFilters({}), { owner: 'me' })).toBe('/prospects?owner=me');
	});
});

describe('pipelineHref', () => {
	it('round-trips and omits defaults', () => {
		const f = parsePipelineFilters({ pipeline: 'setter', owner: 'me', q: 'acme', page: '2' });
		expect(pipelineHref(f)).toBe('/prospects?pipeline=setter&owner=me&q=acme');
		expect(pipelineHref(f, { page: 4 })).toBe('/prospects?pipeline=setter&owner=me&q=acme&page=4');
		expect(parsePipelineFilters(Object.fromEntries(new URLSearchParams(pipelineHref(f, { page: 4 }).split('?')[1])))).toEqual({ ...f, page: 4 });
	});
	it('keeps an explicit view only when it differs from the default', () => {
		expect(pipelineHref(parsePipelineFilters({}), { view: 'board' })).toBe('/prospects');
		expect(pipelineHref(parsePipelineFilters({}), { view: 'table' })).toBe('/prospects?view=table');
		expect(pipelineHref(parsePipelineFilters({ pipeline: 'closer' }), { view: 'table' })).toBe('/prospects?pipeline=closer&view=table');
	});
	it('drops the stage when the pipeline changes', () => {
		const f = parsePipelineFilters({ pipeline: 'closer', stage: UUID });
		expect(pipelineHref(f, { pipeline: 'setter' })).toBe('/prospects?pipeline=setter');
	});
});

describe('resolveBoardPipeline', () => {
	it('board without a pipeline uses the first active one', () => {
		expect(resolveBoardPipeline(parsePipelineFilters({ view: 'board' }), ['marketing', 'closer'])).toBe('marketing');
		expect(resolveBoardPipeline(parsePipelineFilters({ pipeline: 'closer' }), ['marketing', 'closer'])).toBe('closer');
		expect(resolveBoardPipeline(parsePipelineFilters({ pipeline: 'gone' }), ['marketing'])).toBe('marketing');
		expect(resolveBoardPipeline(parsePipelineFilters({}), [])).toBeNull();
	});
});

describe('legacyDealsHref', () => {
	it('maps /prospects/deals params onto the Pipeline table', () => {
		expect(legacyDealsHref({ lane: 'lead_gen', owner: 'me', q: 'x', page: '3', status: 'won', source: 'scrape' }, { lead_gen: ['lead-gen'], closer: ['closer', 'beacon'] }))
			.toBe('/prospects?pipeline=lead-gen&view=table&owner=me&source=scrape&status=won&q=x&page=3');
		expect(legacyDealsHref({ lane: 'closer' }, { closer: ['closer', 'beacon'] })).toBe('/prospects?view=table');
		expect(legacyDealsHref({}, {})).toBe('/prospects?view=table');
	});
	it('a board-default pipeline still lands on the table', () => {
		expect(legacyDealsHref({ lane: 'setter' }, { setter: ['setter'] })).toBe('/prospects?pipeline=setter&view=table');
	});
});

describe('contacts filters', () => {
	it('defaults and round-trip', () => {
		expect(parseContactsFilters({})).toEqual({ tab: 'people', has: 'all', q: null, sort: 'updated', page: 1, size: 50 });
		const f = parseContactsFilters({ tab: 'brands', has: 'none', q: 'glow', sort: 'name', page: '2' });
		expect(contactsHref(f, { page: 2 })).toBe('/prospects/contacts?tab=brands&has=none&q=glow&sort=name&page=2');
		expect(contactsHref(f, { tab: 'people' })).toBe('/prospects/contacts?has=none&q=glow&sort=name');
		expect(parseContactsFilters({ tab: 'x', has: 'x', sort: 'x' })).toMatchObject({ tab: 'people', has: 'all', sort: 'updated' });
	});
});

describe('pageWindow', () => {
	it('first, last, and two either side of the current page', () => {
		expect(pageWindow(1, 1)).toEqual([1]);
		expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(pageWindow(1, 140)).toEqual([1, 2, 3, 'gap', 140]);
		expect(pageWindow(70, 140)).toEqual([1, 'gap', 68, 69, 70, 71, 72, 'gap', 140]);
		expect(pageWindow(140, 140)).toEqual([1, 'gap', 138, 139, 140]);
		expect(pageWindow(4, 140)).toEqual([1, 2, 3, 4, 5, 6, 'gap', 140]);
	});
});

describe('pageRange', () => {
	it('is inclusive and zero based', () => {
		expect(pageRange(1)).toEqual({ from: 0, to: 49 });
		expect(pageRange(3, 10)).toEqual({ from: 20, to: 29 });
	});
});
