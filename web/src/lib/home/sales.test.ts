import { describe, expect, it } from 'vitest';
import {
	callKindLabel, groupSalesRows, isSalesCall, matchCallsToDeals, pickTargets, presetAt, salesCallEmails,
	salesDueLabel, salesGroupOf, slowNewLeads, todayCallDeals, type SalesCallEvent, type SalesRow,
} from './sales';
import type { TargetRow } from '@/lib/revenue/server';

// 2026-10-15 15:00 UTC = 10:00 Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-15T15:00:00Z');

function row(p: Partial<SalesRow> & { deal_id: string }): SalesRow {
	return {
		title: p.deal_id, stage_name: 'Discovery booked', pipeline_slug: 'closer', lane: 'closer',
		person_name: null, brand_name: null, heat_score: null, quality_score: null, routing: null,
		next_action: null, next_action_at: null, created_at: '2026-10-01T00:00:00Z', stage_entered_at: '2026-10-01T00:00:00Z',
		sla_hours: null, delay_until: null, value_cents: 0, phone: null, email: null, score: 0, reason: 'next up',
		person_id: null, pipeline_id: null, stage_id: null, answered: false, ghl_url: null,
		...p,
	};
}

describe('salesGroupOf', () => {
	it('new lead stays new until answered', () => {
		expect(salesGroupOf(row({ deal_id: 'a', reason: 'new lead' }), NOW, {})).toBe('new');
		expect(salesGroupOf(row({ deal_id: 'a', reason: 'new lead', answered: true }), NOW, {})).toBe('none');
	});
	it('puts matched calls before overdue and today', () => {
		expect(salesGroupOf(row({ deal_id: 'c', next_action_at: '2026-10-14T15:00:00Z' }), NOW, { c: '2026-10-15T21:00:00Z' })).toBe('calls');
	});
	it('checks on-hold before overdue', () => {
		expect(salesGroupOf(row({ deal_id: 'h', delay_until: '2026-10-20T00:00:00Z', next_action_at: '2026-10-14T00:00:00Z' }), NOW, {})).toBe('hold');
	});
	it('overdue by date or by reason', () => {
		expect(salesGroupOf(row({ deal_id: 'o', next_action_at: '2026-10-15T14:00:00Z' }), NOW, {})).toBe('overdue');
		expect(salesGroupOf(row({ deal_id: 'o', reason: 'follow-up overdue' }), NOW, {})).toBe('overdue');
	});
	it('uses the Chicago day', () => {
		// 2026-10-16T04:30Z = 23:30 Chicago on the 15th: still today.
		expect(salesGroupOf(row({ deal_id: 't', next_action_at: '2026-10-16T04:30:00Z' }), NOW, {})).toBe('today');
		// 2026-10-16T05:30Z = 00:30 Chicago on the 16th: this week (Thu → Sun).
		expect(salesGroupOf(row({ deal_id: 'w', next_action_at: '2026-10-16T05:30:00Z' }), NOW, {})).toBe('week');
	});
	it('later after Sunday, none without a date', () => {
		expect(salesGroupOf(row({ deal_id: 'l', next_action_at: '2026-10-20T15:00:00Z' }), NOW, {})).toBe('later');
		expect(salesGroupOf(row({ deal_id: 'n' }), NOW, {})).toBe('none');
	});
});

describe('groupSalesRows', () => {
	it('returns non-empty groups in display order, calls sorted by start, others in input order', () => {
		const rows = [
			row({ deal_id: 'n1' }),
			row({ deal_id: 'c2' }),
			row({ deal_id: 'new1', reason: 'new lead' }),
			row({ deal_id: 'c1' }),
			row({ deal_id: 'h1', delay_until: '2026-10-30T00:00:00Z' }),
			row({ deal_id: 'l1', next_action_at: '2026-10-28T15:00:00Z' }),
		];
		const g = groupSalesRows(rows, NOW, { c1: '2026-10-15T20:00:00Z', c2: '2026-10-15T22:00:00Z' });
		expect(g.map((x) => x.key)).toEqual(['new', 'calls', 'later', 'hold', 'none']);
		expect(g[1].rows.map((r) => r.deal_id)).toEqual(['c1', 'c2']);
	});
});

describe('pickTargets', () => {
	let n = 0;
	const t = (p: Partial<TargetRow>): TargetRow => ({ id: String(n++), user_id: null, lane: 'closer', metric: 'closes', period: 'week', target: 2, ...p });
	it('personal beats lane, day before week, month dropped, max 4', () => {
		const targets = [
			t({ metric: 'closes', period: 'week', target: 2 }),
			t({ metric: 'discovery_taken', period: 'day', target: 2 }),
			t({ metric: 'discovery_taken', period: 'day', target: 3, user_id: 'u1' }),
			t({ metric: 'offers', period: 'month', target: 20 }),
			t({ metric: 'dials', period: 'day', lane: 'setter', target: 100 }),
			t({ metric: 'sales_taken', period: 'day', target: 1 }),
			t({ metric: 'offers', period: 'week', target: 5 }),
			t({ metric: 'shows', period: 'week', target: 3 }),
		];
		const tiles = pickTargets(targets, ['closer'], 'u1', { discovery_taken: 1 }, { closes: 2 });
		expect(tiles.map((x) => x.key)).toEqual(['discovery_taken:day', 'sales_taken:day', 'closes:week', 'offers:week']);
		expect(tiles[0]).toMatchObject({ target: 3, done: 1, label: 'Discovery taken' });
		expect(tiles[2]).toMatchObject({ done: 2, target: 2 });
	});
	it('ignores other people’s personal targets', () => {
		expect(pickTargets([t({ user_id: 'someone-else', period: 'day' })], ['closer'], 'u1', {}, {})).toEqual([]);
	});
});

describe('slowNewLeads', () => {
	it('counts unanswered new leads older than the goal', () => {
		const rows = [
			row({ deal_id: 'a', reason: 'new lead', created_at: '2026-10-15T14:50:00Z' }), // 10 min
			row({ deal_id: 'b', reason: 'new lead', created_at: '2026-10-15T14:58:00Z' }), // 2 min
			row({ deal_id: 'c', reason: 'new lead', created_at: '2026-10-15T14:00:00Z', answered: true }),
		];
		expect(slowNewLeads(rows, NOW, 5)).toBe(1);
	});
});

describe('calendar matching', () => {
	const ev = (p: Partial<SalesCallEvent> & { id: string }): SalesCallEvent => ({ title: 'X x Open Ronin Discovery Call', starts_at: '2026-10-15T21:00:00Z', category_key: 'sales_call', attendee_external: [], location: null, ...p });
	it('labels discovery vs sales calls', () => {
		expect(isSalesCall({ category_key: 'sales_call' })).toBe(true);
		expect(isSalesCall({ category_key: null })).toBe(false);
		expect(callKindLabel('Lonnie x Open Ronin Discovery Call')).toBe('Discovery');
		expect(callKindLabel('Closing call - Acme')).toBe('Sales call');
	});
	it('collects unique external emails of sales calls only', () => {
		const events = [
			ev({ id: '1', attendee_external: ['A@x.com', 'user-d53652@example.com'] }),
			ev({ id: '2', attendee_external: ['a@x.com'] }),
			ev({ id: '3', category_key: null, attendee_external: ['b@y.com'] }),
		];
		expect(salesCallEmails(events)).toEqual(['a@x.com']);
	});
	it('matchCallsToDeals ignores internal and unknown emails, picks the most recent open deal', () => {
		const events = [
			ev({ id: 'e1', attendee_external: ['user-d53652@example.com', 'lee@example.net'] }),
			ev({ id: 'e2', attendee_external: ['nobody@z.com'] }),
			ev({ id: 'e3', attendee_external: null }),
		];
		const people = [{ id: 'p1', email: 'lee@example.net' }];
		const deals = [
			{ id: 'd-old', title: 'Old', primary_person_id: 'p1', updated_at: '2026-09-01T00:00:00Z' },
			{ id: 'd-new', title: 'Lonnie Gienger', primary_person_id: 'p1', updated_at: '2026-10-10T00:00:00Z' },
		];
		expect(matchCallsToDeals(events, people, deals)).toEqual({ e1: { dealId: 'd-new', dealTitle: 'Lonnie Gienger' } });
	});
	it('todayCallDeals keeps only today (Chicago) and the earliest start per deal', () => {
		const events = [ev({ id: 'e1', starts_at: '2026-10-15T22:00:00Z' }), ev({ id: 'e2', starts_at: '2026-10-15T20:00:00Z' }), ev({ id: 'e3', starts_at: '2026-10-17T20:00:00Z' })];
		const m = { e1: { dealId: 'd1', dealTitle: 'D' }, e2: { dealId: 'd1', dealTitle: 'D' }, e3: { dealId: 'd2', dealTitle: 'E' } };
		expect(todayCallDeals(events, m, NOW)).toEqual({ d1: '2026-10-15T20:00:00Z' });
	});
});

describe('presetAt', () => {
	const thu = new Date(2026, 9, 15, 14, 0); // local Thu Oct 15, 14:00
	it('tomorrow / in 2 days / next Monday, all at 9:00 local', () => {
		const t = presetAt('tomorrow', thu);
		expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([16, 9, 0]);
		expect(presetAt('two_days', thu).getDate()).toBe(17);
		const m = presetAt('next_week', thu);
		expect([m.getDay(), m.getDate(), m.getHours()]).toEqual([1, 19, 9]);
	});
});

describe('salesDueLabel', () => {
	it('new leads count minutes and go late past the goal', () => {
		expect(salesDueLabel(row({ deal_id: 'a', created_at: '2026-10-15T14:53:00Z' }), 'new', NOW, undefined, 5)).toEqual({ text: '7m', late: true });
		expect(salesDueLabel(row({ deal_id: 'a', created_at: '2026-10-15T14:58:00Z' }), 'new', NOW, undefined, 5)).toEqual({ text: '2m', late: false });
	});
	it('overdue says yesterday / Nd late', () => {
		expect(salesDueLabel(row({ deal_id: 'o', next_action_at: '2026-10-14T15:00:00Z' }), 'overdue', NOW)).toEqual({ text: 'yesterday', late: true });
		expect(salesDueLabel(row({ deal_id: 'o', next_action_at: '2026-10-12T15:00:00Z' }), 'overdue', NOW)).toEqual({ text: '3d late', late: true });
	});
	it('no next action renders a dash', () => {
		expect(salesDueLabel(row({ deal_id: 'n' }), 'none', NOW)).toEqual({ text: '—', late: false });
	});
});

describe('salesDueLabel times are Chicago time (server and browser agree)', () => {
	it('formats today / calls / week / later in America/Chicago whatever the process zone', () => {
		// 20:00Z = 3:00 PM Chicago; 2026-10-17T03:00Z = Fri 10:00 PM Chicago (Sat in UTC/Tokyo).
		expect(salesDueLabel(row({ deal_id: 't', next_action_at: '2026-10-15T20:00:00Z' }), 'today', NOW).text).toBe('3:00 PM');
		expect(salesDueLabel(row({ deal_id: 'c' }), 'calls', NOW, '2026-10-15T21:00:00Z').text).toBe('4:00 PM');
		expect(salesDueLabel(row({ deal_id: 'w', next_action_at: '2026-10-17T03:00:00Z' }), 'week', NOW).text).toBe('Fri');
		expect(salesDueLabel(row({ deal_id: 'l', next_action_at: '2026-10-28T03:00:00Z' }), 'later', NOW).text).toBe('Oct 27');
	});
});

describe('pickTargets with derived metrics', () => {
	it('a sales_taken target reads shows / offers sent instead of 0', () => {
		const t: TargetRow = { id: 'x', user_id: null, lane: 'closer', metric: 'sales_taken', period: 'day', target: 1 };
		const tiles = pickTargets([t], ['closer'], 'u1', { shows: 1 }, {});
		expect(tiles[0]).toMatchObject({ label: 'Sales calls taken', done: 1, target: 1 });
	});
});
