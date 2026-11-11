import { describe, expect, it } from 'vitest';
import { eventToSlots, fmtMinutes, slotLabel, studyDays, studySlots, totalsByCategory } from './shared';

describe('time study slot math', () => {
	it('enumerates 14 days from the start', () => {
		const days = studyDays('2026-09-14');
		expect(days).toHaveLength(14);
		expect(days[0]).toBe('2026-09-14');
		expect(days[13]).toBe('2026-09-27');
	});

	it('renders only the study hours', () => {
		const slots = studySlots({ day_start_hour: 6, day_end_hour: 20 });
		expect(slots[0]).toBe(36);
		expect(slots[slots.length - 1]).toBe(119);
		expect(slots).toHaveLength(14 * 6);
	});

	it('labels slots as clock times', () => {
		expect(slotLabel(0)).toBe('12:00 AM');
		expect(slotLabel(36)).toBe('6:00 AM');
		expect(slotLabel(79)).toBe('1:10 PM');
	});

	it('maps a calendar event to outward-rounded 10-minute slots in the company timezone', () => {
		// 09:05-09:30 CDT (UTC-5) on 2026-09-15 = 14:05Z-14:30Z
		const days = new Set(studyDays('2026-09-14'));
		const slots = eventToSlots('2026-09-15T14:05:00Z', '2026-09-15T14:30:00Z', 'America/Chicago', days);
		expect(slots).toEqual([
			{ day: '2026-09-15', slot: 54 },
			{ day: '2026-09-15', slot: 55 },
			{ day: '2026-09-15', slot: 56 },
		]);
	});

	it('drops events outside the window and defaults a missing end to 30 minutes', () => {
		const days = new Set(studyDays('2026-09-14'));
		expect(eventToSlots('2026-10-15T14:05:00Z', null, 'America/Chicago', days)).toEqual([]);
		expect(eventToSlots('2026-09-15T14:00:00Z', null, 'America/Chicago', days)).toHaveLength(3);
	});

	it('totals minutes per category and formats them', () => {
		const totals = totalsByCategory([{ category: 'a' }, { category: 'a' }, { category: 'b' }]);
		expect(totals.get('a')).toBe(20);
		expect(fmtMinutes(20)).toBe('20m');
		expect(fmtMinutes(120)).toBe('2h');
		expect(fmtMinutes(130)).toBe('2h 10m');
	});
});
