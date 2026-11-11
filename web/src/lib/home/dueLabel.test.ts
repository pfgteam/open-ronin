import { describe, expect, it } from 'vitest';
import { dueBucket, parseDueLocal, relativeDue, weekEndOf } from './dueLabel';

// A Tuesday, local midnight. Every case below is relative to it.
const today = new Date(2026, 8, 22);

describe('parseDueLocal', () => {
	it('reads a bare date as LOCAL midnight, not UTC', () => {
		const d = parseDueLocal('2026-09-22');
		expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 22, 0]);
	});

	it('passes a full timestamp through to normal parsing', () => {
		expect(parseDueLocal('2026-09-22T15:30:00Z').getTime()).toBe(Date.parse('2026-09-22T15:30:00Z'));
	});
});

describe('relativeDue', () => {
	it('is a dash with no date', () => {
		expect(relativeDue(null, today)).toBe('—');
	});

	it('counts days late, singular and plural', () => {
		expect(relativeDue('2026-09-21', today)).toBe('1d late');
		expect(relativeDue('2026-09-18', today)).toBe('4d late');
	});

	it('names today and tomorrow', () => {
		expect(relativeDue('2026-09-22', today)).toBe('Today');
		expect(relativeDue('2026-09-23', today)).toBe('Tomorrow');
	});

	it('uses the weekday for the rest of the coming week', () => {
		expect(relativeDue('2026-09-24', today)).toBe('Thu');
		expect(relativeDue('2026-09-28', today)).toBe('Mon'); // 6 days out
	});

	it('falls back to a short date from a week out, with the year only when it differs', () => {
		expect(relativeDue('2026-09-29', today)).toBe('Sep 29'); // exactly 7 days
		expect(relativeDue('2026-10-15', today)).toBe('Oct 15');
		expect(relativeDue('2027-01-05', today)).toBe('Jan 5, 2027');
	});

	it('ignores the time of day on a timestamp due date', () => {
		expect(relativeDue('2026-09-22T23:59:00', today)).toBe('Today');
	});
});

describe('dueBucket / weekEndOf (one definition for the Overview KPIs and the My work groups)', () => {
	// Wednesday 2026-10-07, local.
	const wed = new Date(2026, 9, 7);
	it('ends the week on the coming Sunday, and on Sunday itself', () => {
		expect(weekEndOf(wed).getDay()).toBe(0);
		expect(weekEndOf(wed).getDate()).toBe(11);
		const sun = new Date(2026, 9, 11);
		expect(weekEndOf(sun).getDate()).toBe(11);
	});
	it('buckets around today, the week end and the next week end', () => {
		expect(dueBucket(null, wed)).toBe('none');
		expect(dueBucket('2026-10-06', wed)).toBe('overdue');
		expect(dueBucket('2026-10-07', wed)).toBe('today');
		expect(dueBucket('2026-10-11', wed)).toBe('week');   // Sunday, last day of this week
		expect(dueBucket('2026-10-12', wed)).toBe('next');   // Monday
		expect(dueBucket('2026-10-18', wed)).toBe('next');   // next Sunday
		expect(dueBucket('2026-10-19', wed)).toBe('later');
	});
	it('on a Sunday "this week" is only today', () => {
		const sun = new Date(2026, 9, 11);
		expect(dueBucket('2026-10-11', sun)).toBe('today');
		expect(dueBucket('2026-10-12', sun)).toBe('next');
	});
	it('reads a bare date as LOCAL midnight (no UTC shift)', () => {
		expect(dueBucket('2026-10-07', new Date(2026, 9, 7, 23, 30))).toBe('today');
	});
});
