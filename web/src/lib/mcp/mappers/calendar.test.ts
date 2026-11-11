import { describe, expect, it } from 'vitest';
import { CALENDAR_EVENT_STATUSES, mapCalendarEvent, mergeAttendees } from './calendar';

const raw = {
	id: 'ev1',
	user_id: 'u1',
	title: 'Discovery call — Acme',
	description_md: 'Agenda',
	starts_at: '2026-09-12T15:00:00Z',
	ends_at: '2026-09-12T15:30:00Z',
	all_day: false,
	location: 'Zoom',
	status: 'confirmed',
	category_key: 'sales_call',
	url: 'https://www.google.com/calendar/event?eid=abc',
	client_id: 'c1',
	project_id: null,
	task_id: null,
	attendee_user_ids: ['u2'],
	attendee_external: ['ceo@acme.com'],
	recurrence_parent_id: null,
	// sync plumbing / provider blobs that must never leak
	raw: { secret: 'provider payload' },
	attendees: [{ email: 'ceo@acme.com', responseStatus: 'accepted' }],
	external_id: 'goog-123',
	external_calendar_id: 'primary',
	source_ref: 'goog-123',
	last_synced_at: '2026-09-11T00:00:00Z',
	needs_outbound_sync: false,
	recurring_rule: 'RRULE:FREQ=WEEKLY',
};

const labels = { ownerName: 'Jamie Doe', ownerEmail: 'user-d53652@example.com', clientName: 'Acme', internalAttendeeEmails: ['user-8a8dee@example.com'] };

describe('CALENDAR_EVENT_STATUSES', () => {
	it('matches the three values the Google sync writes (google-cal/sync/route.ts mapGoogleEvent)', () => {
		expect(CALENDAR_EVENT_STATUSES).toEqual(['confirmed', 'tentative', 'cancelled']);
	});
});

describe('mapCalendarEvent', () => {
	it('exposes exactly the allowlist — no raw/attendees jsonb, external ids or sync fields', () => {
		const row = mapCalendarEvent(raw, labels);
		expect(Object.keys(row).sort()).toEqual(
			[
				'all_day', 'attendees', 'category', 'client_id', 'client_name', 'description_md', 'ends_at', 'id',
				'is_recurring_instance', 'location', 'owner_email', 'owner_name', 'project_id', 'starts_at', 'status', 'task_id', 'title', 'url',
			].sort(),
		);
		const text = JSON.stringify(row);
		expect(text).not.toContain('provider payload');
		expect(text).not.toContain('goog-123');
		expect(text).not.toContain('RRULE');
		expect(text).not.toContain('responseStatus');
	});

	it('flattens internal + external attendees into one email list and labels owner/client', () => {
		const row = mapCalendarEvent(raw, labels);
		expect(row.attendees).toEqual(['user-8a8dee@example.com', 'ceo@acme.com']);
		expect(row.owner_name).toBe('Jamie Doe');
		expect(row.owner_email).toBe('user-d53652@example.com');
		expect(row.client_name).toBe('Acme');
		expect(row.category).toBe('sales_call');
		expect(row.is_recurring_instance).toBe(false);
	});

	it('marks recurrence instances without exposing the parent id', () => {
		const row = mapCalendarEvent({ ...raw, recurrence_parent_id: 'parent-1' }, labels);
		expect(row.is_recurring_instance).toBe(true);
		expect(JSON.stringify(row)).not.toContain('parent-1');
	});

	it('tolerates null labels and null attendee arrays', () => {
		const row = mapCalendarEvent(
			{ ...raw, attendee_user_ids: null, attendee_external: null, client_id: null },
			{ ownerName: null, ownerEmail: null, clientName: null, internalAttendeeEmails: [] },
		);
		expect(row.attendees).toEqual([]);
		expect(row.owner_name).toBeNull();
		expect(row.client_name).toBeNull();
	});
});

describe('mergeAttendees', () => {
	it('dedupes case-insensitively, keeps first spelling, drops blanks', () => {
		expect(mergeAttendees(['A@x.com', ' '], ['a@x.com', 'b@y.com', '', 'b@y.com'])).toEqual(['A@x.com', 'b@y.com']);
	});
});
