import { describe, expect, it } from 'vitest';
import { addDays, closerDerived, execFunnel, pct, rangeFor, setterDerived, sumBy, withDerived, type MetricRow } from './metrics';

const rows: MetricRow[] = [
	{ day: '2026-10-01', user_id: 'a', metric: 'dials', value: 60 },
	{ day: '2026-10-02', user_id: 'a', metric: 'dials', value: 40 },
	{ day: '2026-10-02', user_id: 'a', metric: 'conversations', value: 10 },
	{ day: '2026-10-02', user_id: 'a', metric: 'sets', value: 4 },
	{ day: '2026-10-02', user_id: 'a', metric: 'shows', value: 2 },
	{ day: '2026-10-02', user_id: 'a', metric: 'offers', value: 2 },
	{ day: '2026-10-02', user_id: 'a', metric: 'closes', value: 1 },
	{ day: '2026-10-02', user_id: 'a', metric: 'fe_cash_cents', value: 475000 },
	{ day: '2026-10-02', user_id: 'b', metric: 'dials', value: 5 },
];

describe('tracker math', () => {
	it('sums per metric and filters by person', () => {
		expect(sumBy(rows).dials).toBe(105);
		expect(sumBy(rows, (r) => r.user_id === 'a').dials).toBe(100);
	});
	it('reproduces the setter tracker ratios', () => {
		const s = setterDerived(sumBy(rows, (r) => r.user_id === 'a'));
		expect(s.conversation_pct).toBe(10);
		expect(s.convo_to_set_pct).toBe(40);
		expect(s.show_pct).toBe(50);
		expect(s.offer_pct).toBe(100);
		expect(s.set_to_close_pct).toBe(25);
		expect(s.offer_to_close_pct).toBe(50);
		expect(s.fe_cash).toBe(4750);
	});
	it('closer + exec funnels handle zero denominators', () => {
		const c = closerDerived({});
		expect(c.call1_show_pct).toBeNull();
		const f = execFunnel({ new_leads: 100, discovery_booked: 10, discovery_taken: 8, sales_booked: 4, shows: 3, won: 1, mrr_sold_cents: 475000 }, 2000);
		expect(f.leads_to_first_pct).toBe(10);
		expect(f.first_to_sales_pct).toBe(50);
		expect(f.sales_to_client_pct).toBe(33.3);
		expect(f.mrr_added).toBe(4750);
	});
	it('pct rounds to one decimal', () => {
		expect(pct(1, 3)).toBe(33.3);
		expect(pct(0, 0)).toBeNull();
	});
	it('date ranges: week starts Monday', () => {
		expect(rangeFor('week', '2026-10-02')).toEqual({ from: '2026-09-28', to: '2026-10-02' });
		expect(rangeFor('month', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-02' });
		expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
	});
});

describe('withDerived', () => {
	it('sales_taken = max(shows, offers_sent), raw totals untouched', () => {
		expect(withDerived({ shows: 2, offers_sent: 3 })).toEqual({ shows: 2, offers_sent: 3, sales_taken: 3 });
		expect(withDerived({ shows: 4 })).toMatchObject({ sales_taken: 4 });
		expect(withDerived({})).toMatchObject({ sales_taken: 0 });
	});
});
