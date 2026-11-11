// Time Study vocabulary and slot math. No server imports so the client grid
// can use it. A slot is a 10-minute block: 0 = 00:00, 143 = 23:50.

export const SLOT_MINUTES = 10;
export const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
export const SLOTS_PER_DAY = 24 * SLOTS_PER_HOUR;
export const STUDY_DAYS = 14;

export type StudyStatus = 'draft' | 'open' | 'review' | 'closed';

export interface TimeStudy {
	id: string;
	name: string;
	starts_on: string;
	ends_on: string;
	status: StudyStatus;
	day_start_hour: number;
	day_end_hour: number;
	opened_at: string;
	closed_at: string | null;
}

export interface StudyCategory {
	slug: string;
	label: string;
	color: string | null;
	sort: number;
	is_active: boolean;
}

export interface StudyEntry {
	day: string;
	slot: number;
	category: string;
	source: 'manual' | 'calendar';
	note: string | null;
}

export const STATUS_LABELS: Record<StudyStatus, string> = {
	draft: 'Draft',
	open: 'Open for entry',
	review: 'In review',
	closed: 'Closed',
};

/** Every day of the study window, YYYY-MM-DD. */
export function studyDays(startsOn: string): string[] {
	const [y, m, d] = startsOn.split('-').map(Number);
	const out: string[] = [];
	for (let i = 0; i < STUDY_DAYS; i++) {
		const dt = new Date(Date.UTC(y, m - 1, d + i));
		out.push(dt.toISOString().slice(0, 10));
	}
	return out;
}

/** Slots rendered for a study: [day_start_hour*6, day_end_hour*6). */
export function studySlots(study: Pick<TimeStudy, 'day_start_hour' | 'day_end_hour'>): number[] {
	const out: number[] = [];
	for (let s = study.day_start_hour * SLOTS_PER_HOUR; s < study.day_end_hour * SLOTS_PER_HOUR; s++) out.push(s);
	return out;
}

export function slotLabel(slot: number): string {
	const h = Math.floor(slot / SLOTS_PER_HOUR);
	const m = (slot % SLOTS_PER_HOUR) * SLOT_MINUTES;
	const hh = ((h + 11) % 12) + 1;
	return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function dayLabel(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function isWeekend(day: string): boolean {
	const [y, m, d] = day.split('-').map(Number);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return dow === 0 || dow === 6;
}

/**
 * Map a calendar event to (day, slot) pairs in a timezone. Events are
 * clipped to the study window and rounded outward to 10-minute blocks so a
 * 25-minute call fills three slots, never two.
 */
export function eventToSlots(
	startsAt: string,
	endsAt: string | null,
	timeZone: string,
	days: Set<string>,
): { day: string; slot: number }[] {
	const start = new Date(startsAt);
	const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 30 * 60_000);
	if (!(end > start)) return [];
	const out: { day: string; slot: number }[] = [];
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
	});
	const seen = new Set<string>();
	// Walk in 10-minute steps from the start rounded down to the slot grid.
	const stepMs = SLOT_MINUTES * 60_000;
	const first = new Date(Math.floor(start.getTime() / stepMs) * stepMs);
	for (let t = first.getTime(); t < end.getTime(); t += stepMs) {
		const parts = fmt.formatToParts(new Date(t));
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
		const day = `${get('year')}-${get('month')}-${get('day')}`;
		if (!days.has(day)) continue;
		const hour = Number(get('hour')) % 24;
		const slot = hour * SLOTS_PER_HOUR + Math.floor(Number(get('minute')) / SLOT_MINUTES);
		const key = `${day}:${slot}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ day, slot });
	}
	return out;
}

/** Minutes per category from a flat entry list. */
export function totalsByCategory(entries: Pick<StudyEntry, 'category'>[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + SLOT_MINUTES);
	return m;
}

export function fmtMinutes(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
