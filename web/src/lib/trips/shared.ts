// Trips (0111, Tier B #13) — vocabulary + pure helpers. No server imports so
// the calendar client shell and the server page can both read from here.

import { TRIP_STATUSES } from '@/lib/ingest/contract';

export { TRIP_STATUSES };
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
	planned: 'Planned',
	booked: 'Booked',
	in_progress: 'Travelling',
	completed: 'Completed',
	cancelled: 'Cancelled',
};

export const TRIP_STATUS_COLORS: Record<TripStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
	planned: 'default',
	booked: 'primary',
	in_progress: 'warning',
	completed: 'success',
	cancelled: 'danger',
};

export const TRIPS_PATH = '/the-work/calendar/trips';

export interface TripRow {
	id: string;
	traveler_id: string;
	purpose: string;
	client_id: string | null;
	depart_on: string;
	return_on: string;
	destination: string;
	status: string;
	cost_usd: number | string | null;
	notes_md: string | null;
	source: string;
	created_at: string;
}

/** Calendar shape the shell already renders (CalendarShell CalEvent). */
export interface TripCalendarEvent {
	id: string;
	user_id: string | null;
	title: string;
	starts_at: string;
	ends_at: string | null;
	all_day: boolean;
	category_key: string;
	source: string;
	location: string | null;
	url: string | null;
	attendee_external: string[] | null;
	description_md: string | null;
	project_id: string | null;
	visibility: string | null;
}

/** Inclusive list of YYYY-MM-DD between two dates (bounded to 60 days). */
export function tripDays(departOn: string, returnOn: string): string[] {
	const out: string[] = [];
	const start = new Date(departOn + 'T00:00:00');
	const end = new Date(returnOn + 'T00:00:00');
	for (let d = new Date(start), i = 0; d <= end && i < 60; d.setDate(d.getDate() + 1), i++) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		out.push(`${y}-${m}-${day}`);
	}
	return out;
}

/**
 * One all-day calendar chip per trip day, clipped to [windowStart, windowEnd).
 * The shell buckets events by the local day of starts_at, so a three-day trip
 * needs three chips; ids are `trip:<id>:<day>` and source 'trip' so the click
 * handler can route to the trips page instead of the event drawer.
 */
export function tripsToCalendarEvents(
	trips: TripRow[],
	travelerName: (id: string) => string | null,
	windowStart: string,
	windowEnd: string,
): TripCalendarEvent[] {
	const ws = windowStart.slice(0, 10);
	const we = windowEnd.slice(0, 10);
	const out: TripCalendarEvent[] = [];
	for (const t of trips) {
		if (t.status === 'cancelled') continue;
		const who = travelerName(t.traveler_id);
		for (const day of tripDays(t.depart_on, t.return_on)) {
			if (day < ws || day >= we) continue;
			out.push({
				id: `trip:${t.id}:${day}`,
				user_id: t.traveler_id,
				title: `✈ ${t.destination}${who ? ` · ${who}` : ''}`,
				starts_at: `${day}T00:00:00`,
				ends_at: `${day}T23:59:59`,
				all_day: true,
				category_key: 'travel',
				source: 'trip',
				location: t.destination,
				url: `${TRIPS_PATH}?focus=${t.id}`,
				attendee_external: null,
				description_md: t.purpose,
				project_id: null,
				visibility: 'default',
			});
		}
	}
	return out;
}

export function formatUsd(v: number | string | null): string | null {
	if (v === null || v === undefined || v === '') return null;
	const n = typeof v === 'string' ? Number(v) : v;
	if (!Number.isFinite(n)) return null;
	return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
