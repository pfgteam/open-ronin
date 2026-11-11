import { describe, expect, it } from 'vitest';
import { tripDays, tripsToCalendarEvents, formatUsd, type TripRow } from './shared';

const trip: TripRow = {
	id: 't1', traveler_id: 'u1', purpose: 'Client onsite', client_id: null,
	depart_on: '2026-10-05', return_on: '2026-10-07', destination: 'Alex, TX',
	status: 'booked', cost_usd: '1240.50', notes_md: null, source: 'ingest', created_at: '2026-09-19T00:00:00Z',
};

describe('tripDays', () => {
	it('is inclusive of both ends', () => {
		expect(tripDays('2026-10-05', '2026-10-07')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
	});
	it('single day trip is one day', () => {
		expect(tripDays('2026-10-05', '2026-10-05')).toEqual(['2026-10-05']);
	});
});

describe('tripsToCalendarEvents', () => {
	it('emits one all-day chip per day inside the window, source trip', () => {
		const evs = tripsToCalendarEvents([trip], () => 'Alex', '2026-10-06T00:00:00.000Z', '2026-10-13T00:00:00.000Z');
		expect(evs.map((e) => e.id)).toEqual(['trip:t1:2026-10-06', 'trip:t1:2026-10-07']);
		expect(evs[0].all_day).toBe(true);
		expect(evs[0].source).toBe('trip');
		expect(evs[0].category_key).toBe('travel');
		expect(evs[0].title).toBe('✈ Alex, TX · Alex');
		expect(evs[0].url).toBe('/the-work/calendar/trips?focus=t1');
	});
	it('skips cancelled trips', () => {
		expect(tripsToCalendarEvents([{ ...trip, status: 'cancelled' }], () => null, '2026-10-01', '2026-11-01')).toEqual([]);
	});
});

describe('formatUsd', () => {
	it('handles numeric strings from PostgREST and nulls', () => {
		expect(formatUsd('1240.50')).toBe('$1,241');
		expect(formatUsd(null)).toBeNull();
		expect(formatUsd('nope')).toBeNull();
	});
});
