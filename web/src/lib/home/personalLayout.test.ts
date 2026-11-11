import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUTS, TILES, layoutFor, normalizeLayout, personaFor, visibleTiles } from './personalLayout';

describe('personal page layout (D5, 8.4)', () => {
	it('picks the persona from role and reports', () => {
		expect(personaFor('exec', false)).toBe('exec');
		expect(personaFor('admin', false)).toBe('exec');
		expect(personaFor('manager', false)).toBe('manager');
		expect(personaFor('contributor', true)).toBe('manager');
		expect(personaFor('contributor', false)).toBe('publicist');
	});

	it('a new user gets the persona default, every other tile available but hidden', () => {
		const l = layoutFor(null, 'contributor', false);
		expect(l.filter((x) => !x.hidden).map((x) => x.id)).toEqual(DEFAULT_LAYOUTS.publicist.map((x) => x.id));
		expect(new Set(l.map((x) => x.id)).size).toBe(TILES.length);
	});

	it('a saved layout wins, keeps its order and sizes, drops junk and duplicates', () => {
		const l = normalizeLayout([{ id: 'agenda', size: 2 }, { id: 'nope' }, { id: 'agenda' }, { id: 'radar', hidden: true }, 'x'], []);
		expect(l[0]).toEqual({ id: 'agenda', size: 2 });
		expect(l[1]).toEqual({ id: 'radar', size: 1, hidden: true });
		expect(l.slice(2).every((x) => x.hidden)).toBe(true);
	});

	it('leads-only and sales-only tiles drop for other viewers', () => {
		const l = layoutFor(null, 'manager', true);
		expect(visibleTiles(l, { isLead: false, hasSales: false }).some((x) => x.id === 'team')).toBe(false);
		expect(visibleTiles(l, { isLead: true, hasSales: false }).some((x) => x.id === 'team')).toBe(true);
		expect(visibleTiles(l, { isLead: true, hasSales: false }).some((x) => x.id === 'sales_queue')).toBe(false);
	});
});
