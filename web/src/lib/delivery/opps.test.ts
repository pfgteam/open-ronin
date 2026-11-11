import { describe, expect, it } from 'vitest';
import type { DataRecord } from '@/lib/data';
import { STAGE_ORDER, groupOpps, oppsFormula, sumReach, tierLabel, toOppRow, type OppFields } from './opps';

function rec(fields: OppFields, id = 'rec1'): DataRecord<OppFields> {
	return { id, fields, createdTime: '2026-09-01T00:00:00.000Z' };
}

describe('toOppRow', () => {
	it('maps the Airtable row and decides live by Live Link, not status', () => {
		const row = toOppRow(rec({ Outlet: 'AOL', 'Media Opp': 'AOL - Acme Snacks - Sep 11, 2026', Status: 'Secured Coverage', 'Live Link': 'https://aol.com/x', 'Date Secured': '2026-09-11', 'Media Tier': 'Top Tier', 'Secured By': 'Casey', Reach: 198000000 }));
		expect(row.stage).toBe('secured');
		expect(row.live).toBe(true);
		expect(row.outlet).toBe('AOL');
		expect(row.tier).toBe('Top Tier');
	});
	it('a secured row without a link is not live; a pending row with a link is', () => {
		expect(toOppRow(rec({ Status: 'Waiting to go Live' })).live).toBe(false);
		expect(toOppRow(rec({ Status: 'Pending Coverage', 'Live Link': 'https://x' })).live).toBe(true);
	});
	it('falls back to the Media Opp title when Outlet is empty, and to a dash when both are', () => {
		expect(toOppRow(rec({ 'Media Opp': 'Some title' })).outlet).toBe('Some title');
		expect(toOppRow(rec({})).outlet).toBe('—');
	});
});

describe('groupOpps', () => {
	it('puts every stage in the map even when empty, and groups dash/space variants correctly', () => {
		const rows = [
			toOppRow(rec({ Status: 'Secured Coverage' }, 'a')),
			toOppRow(rec({ Status: 'Live – Pending Client Approval' }, 'b')), // en-dash spelling
			toOppRow(rec({ Status: 'Warm lead (responded) ' }, 'c')), // trailing space
			toOppRow(rec({ Status: 'Pending Coverage' }, 'd')),
			toOppRow(rec({ Status: 'Client Decline' }, 'e')),
			toOppRow(rec({ Status: 'Brand New Status' }, 'f')),
		];
		const g = groupOpps(rows);
		expect(Object.keys(g).sort()).toEqual([...STAGE_ORDER].sort());
		expect(g.secured.map((r) => r.id)).toEqual(['a', 'b', 'c']);
		expect(g.pitched.map((r) => r.id)).toEqual(['d']);
		expect(g.client_lost.map((r) => r.id)).toEqual(['e']);
		expect(g.media_lost).toEqual([]);
		expect(g.unmapped.map((r) => r.id)).toEqual(['f']);
	});
});

describe('oppsFormula', () => {
	it('matches the client name and the month on any of the three dates', () => {
		const f = oppsFormula('Acme Snacks', '2026-09');
		expect(f).toContain(`FIND("Acme Snacks", ARRAYJOIN({Client})) > 0`);
		expect(f).toContain(`DATETIME_FORMAT({Date Secured}, 'YYYY-MM') = '2026-09'`);
		expect(f).toContain(`DATETIME_FORMAT({Live Date}, 'YYYY-MM') = '2026-09'`);
		expect(f).toContain(`DATETIME_FORMAT({Date Sent to Client}, 'YYYY-MM') = '2026-09'`);
		expect(f).not.toMatch(/\n/);
	});
	it('escapes double quotes in the name so the formula cannot be broken', () => {
		expect(oppsFormula('Say "Hi" Co', '2026-09')).toContain(`FIND("Say \\"Hi\\" Co"`);
	});
});

describe('tierLabel / sumReach', () => {
	it('drops the word Tier and dashes a missing tier', () => {
		expect(tierLabel('Top Tier')).toBe('Top');
		expect(tierLabel('New/Emerging Tier')).toBe('New/Emerging');
		expect(tierLabel(null)).toBe('—');
	});
	it('sums reach over live rows only', () => {
		const rows = [
			toOppRow(rec({ Status: 'Secured Coverage', 'Live Link': 'https://a', Reach: 100 }, 'a')),
			toOppRow(rec({ Status: 'Secured Coverage', Reach: 50 }, 'b')),
			toOppRow(rec({ Status: 'Secured Coverage', 'Live Link': 'https://c' }, 'c')),
		];
		expect(sumReach(rows)).toBe(100);
	});
});
