import { describe, expect, it } from 'vitest';
import { FRIDAY_REMINDER_HOUR, REMINDER_HOUR, dueNudge, reminderCopy, reminderDedupeKey } from './reminders';
import { shiftWeeks } from './checkinWeeks';

describe('dueNudge', () => {
	it('nudges on Friday mid-morning, after the 9:15 opening, about the week ending that day', () => {
		expect(FRIDAY_REMINDER_HOUR).toBeGreaterThanOrEqual(10);
		expect(dueNudge({ localHour: FRIDAY_REMINDER_HOUR, localDow: 5 })).toEqual({ kind: 'friday', weekOffset: 0 });
	});

	it('does not nudge on Friday at 9, before the week has opened', () => {
		expect(dueNudge({ localHour: 9, localDow: 5 })).toBeNull();
	});

	it('chases on Monday morning about the week that just closed', () => {
		expect(dueNudge({ localHour: REMINDER_HOUR, localDow: 1 })).toEqual({ kind: 'monday', weekOffset: -1 });
	});

	it('sends nothing at every other hour of the nudge days', () => {
		for (const hour of [0, 8, 11, 13, 23]) {
			expect(dueNudge({ localHour: hour, localDow: 5 })).toBeNull();
			expect(dueNudge({ localHour: hour, localDow: 1 })).toBeNull();
		}
	});

	it('sends nothing on the other days, even at the right hours', () => {
		for (const dow of [0, 2, 3, 4, 6]) {
			expect(dueNudge({ localHour: REMINDER_HOUR, localDow: dow })).toBeNull();
			expect(dueNudge({ localHour: FRIDAY_REMINDER_HOUR, localDow: dow })).toBeNull();
		}
	});

	// The hourly schedule exists so DST cannot shift the nudge off its hour.
	// Across a whole week of hourly runs, exactly two must fire.
	it('fires exactly twice across a week of hourly invocations', () => {
		let fired = 0;
		for (let dow = 0; dow <= 6; dow++) {
			for (let hour = 0; hour <= 23; hour++) {
				if (dueNudge({ localHour: hour, localDow: dow })) fired++;
			}
		}
		expect(fired).toBe(2);
	});
});

describe('reminderDedupeKey', () => {
	it('is stable for the same week and nudge', () => {
		expect(reminderDedupeKey('2026-08-21', 'friday')).toBe(reminderDedupeKey('2026-08-21', 'friday'));
	});

	it('differs by week', () => {
		expect(reminderDedupeKey('2026-08-21', 'friday')).not.toBe(reminderDedupeKey('2026-08-14', 'friday'));
	});

	it('differs by nudge, so Friday and Monday can both reach the same week', () => {
		expect(reminderDedupeKey('2026-08-14', 'friday')).not.toBe(reminderDedupeKey('2026-08-14', 'monday'));
	});

	// The property the whole guard rests on: nothing about execution time may
	// leak into the key, or a re-run would look like a new send.
	it('carries no trace of when it was generated', () => {
		const key = reminderDedupeKey('2026-08-21', 'friday');
		expect(key).toBe('checkin-reminder:2026-08-21:friday');
		const year = String(new Date().getUTCFullYear());
		// The only digits in the key are the week it names.
		expect(key.replace('2026-08-21', '')).not.toMatch(/\d/);
		expect(key.includes(year) ? key.indexOf(year) : -1).toBe(key.indexOf('2026-08-21'));
	});

	it('pairs with the week the nudge targets', () => {
		const current = '2026-08-21';
		const friday = dueNudge({ localHour: FRIDAY_REMINDER_HOUR, localDow: 5 })!;
		const monday = dueNudge({ localHour: REMINDER_HOUR, localDow: 1 })!;
		expect(reminderDedupeKey(shiftWeeks(current, friday.weekOffset), friday.kind)).toBe(
			'checkin-reminder:2026-08-21:friday',
		);
		expect(reminderDedupeKey(shiftWeeks(current, monday.weekOffset), monday.kind)).toBe(
			'checkin-reminder:2026-08-14:monday',
		);
	});
});

describe('reminderCopy', () => {
	it('states the fact for each nudge and never scolds', () => {
		const friday = reminderCopy('friday', 'Aug 15 – 21, 2026');
		expect(friday.title).toContain('due today');
		expect(friday.body).toContain('Aug 15 – 21, 2026');

		const monday = reminderCopy('monday', 'Aug 8 – 14, 2026');
		expect(monday.title).toContain('still missing');
		expect(monday.body).toContain('You can still fill it in.');
	});
});
