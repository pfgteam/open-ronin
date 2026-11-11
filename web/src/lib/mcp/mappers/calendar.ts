// Pure allowlist mapper for the calendar:read tool. `calendar_events`
// carries sync plumbing (external_id, external_calendar_id, source_ref,
// last_synced_at, needs_outbound_sync, recurring_rule, recurrence_parent_id)
// and a raw provider blob (`raw`, `attendees` jsonb) that must never leave
// the server — only the fields named here are ever emitted.

export type CalendarEventRow = {
	id: string;
	user_id: string;
	title: string;
	description_md: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: boolean;
	location: string | null;
	status: string;
	category_key: string | null;
	url: string | null;
	client_id: string | null;
	project_id: string | null;
	task_id: string | null;
	attendee_user_ids: string[] | null;
	attendee_external: string[] | null;
	recurrence_parent_id: string | null;
};

export type CalendarEventOut = {
	id: string;
	title: string;
	description_md: string | null;
	starts_at: string;
	ends_at: string | null;
	all_day: boolean;
	location: string | null;
	status: string;
	category: string | null;
	owner_name: string | null;
	owner_email: string | null;
	client_id: string | null;
	client_name: string | null;
	project_id: string | null;
	task_id: string | null;
	attendees: string[];
	is_recurring_instance: boolean;
	url: string | null;
};

export type CalendarEventLabels = {
	ownerName: string | null;
	ownerEmail: string | null;
	clientName: string | null;
	/** Emails of internal attendees, resolved from attendee_user_ids. */
	internalAttendeeEmails: string[];
};

export const CALENDAR_EVENT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

/** Internal attendees (resolved to emails) first, then external emails, deduped, order preserved. */
export function mergeAttendees(internalEmails: string[], external: string[] | null): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const e of [...internalEmails, ...(external ?? [])]) {
		const key = e.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(e.trim());
	}
	return out;
}

export function mapCalendarEvent(raw: CalendarEventRow, labels: CalendarEventLabels): CalendarEventOut {
	return {
		id: raw.id,
		title: raw.title,
		description_md: raw.description_md,
		starts_at: raw.starts_at,
		ends_at: raw.ends_at,
		all_day: raw.all_day,
		location: raw.location,
		status: raw.status,
		category: raw.category_key,
		owner_name: labels.ownerName,
		owner_email: labels.ownerEmail,
		client_id: raw.client_id,
		client_name: labels.clientName,
		project_id: raw.project_id,
		task_id: raw.task_id,
		attendees: mergeAttendees(labels.internalAttendeeEmails, raw.attendee_external),
		is_recurring_instance: raw.recurrence_parent_id !== null,
		url: raw.url,
	};
}
