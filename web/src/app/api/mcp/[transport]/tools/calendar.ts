import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError, MAX_SCAN } from '@/lib/mcp/tooling';
import { CALENDAR_EVENT_STATUSES, mapCalendarEvent, type CalendarEventRow } from '@/lib/mcp/mappers/calendar';

const LIMIT = z.number().int().min(1).max(200).default(50);

// Allowlist only — never `raw`, `attendees` (provider jsonb), `external_id`,
// `external_calendar_id`, `source_ref`, `last_synced_at`, `needs_outbound_sync`,
// `recurring_rule`. See mappers/calendar.ts.
const EVENT_COLUMNS =
	'id, user_id, title, description_md, starts_at, ends_at, all_day, location, status, category_key, url, client_id, project_id, task_id, attendee_user_ids, attendee_external, recurrence_parent_id';

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; email: string };

function displayName(p: ProfileLite): string {
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

/** Default window when the caller gives no range: today → +14 days. Keeps a bare call useful (availability) instead of a 2000-row scan. */
export function defaultWindow(now: Date): { after: string; before: string } {
	const after = new Date(now);
	after.setUTCHours(0, 0, 0, 0);
	const before = new Date(after);
	before.setUTCDate(before.getUTCDate() + 14);
	return { after: after.toISOString(), before: before.toISOString() };
}

export function registerCalendarTools(server: McpServer): void {
	server.registerTool(
		'list_calendar_events',
		{
			title: 'List calendar events',
			description:
				'Calendar events (calendar_events table — Google Calendar synced per team member, plus manual entries) ordered by start time. Filter by owner email (the team member whose calendar it is), a starts_at window (starts_after / starts_before, ISO 8601; defaults to today → +14 days when neither is given), client id, or status (defaults to excluding cancelled). Use it to check a person\'s availability: anything returned in the window is busy time. Read-only — this cannot create, move or cancel events; booking must go through a human-approved proposed action. Never returns the raw provider payload or sync fields.',
			inputSchema: {
				owner_email: z.string().email().optional(),
				starts_after: z.string().datetime({ offset: true }).optional(),
				starts_before: z.string().datetime({ offset: true }).optional(),
				client_id: z.string().uuid().optional(),
				status: z.enum(CALENDAR_EVENT_STATUSES).optional(),
				limit: LIMIT,
			},
		},
		async ({ owner_email, starts_after, starts_before, client_id, status, limit }, extra) =>
			audited(
				'list_calendar_events',
				'calendar:read',
				extra.authInfo,
				{ owner_email, starts_after, starts_before, client_id, status, limit },
				'calendar events',
				async () => {
					const supabase = createServiceRoleClient();

					let ownerId: string | null = null;
					if (owner_email) {
						const { data: owner } = await supabase.from('profiles').select('id').eq('email', owner_email).maybeSingle<{ id: string }>();
						if (!owner) throw userError(`No team member found with email ${owner_email}.`);
						ownerId = owner.id;
					}

					let after = starts_after ?? null;
					let before = starts_before ?? null;
					if (!after && !before) ({ after, before } = defaultWindow(new Date()));
					if (after && before && Date.parse(after) >= Date.parse(before)) {
						throw userError('starts_after must be earlier than starts_before.');
					}

					let query = supabase.from('calendar_events').select(EVENT_COLUMNS).limit(MAX_SCAN);
					if (ownerId) query = query.eq('user_id', ownerId);
					if (after) query = query.gte('starts_at', after);
					if (before) query = query.lt('starts_at', before);
					if (client_id) query = query.eq('client_id', client_id);
					if (status) query = query.eq('status', status);
					else query = query.neq('status', 'cancelled');
					query = query.order('starts_at', { ascending: true }).order('id', { ascending: true });

					const { data: events, error } = await query.returns<CalendarEventRow[]>();
					if (error) throw error;

					const rows = events ?? [];
					const truncated = rows.length > limit || rows.length >= MAX_SCAN;
					const page = rows.slice(0, limit);

					const profileIds = new Set<string>();
					for (const e of page) {
						profileIds.add(e.user_id);
						for (const id of e.attendee_user_ids ?? []) profileIds.add(id);
					}
					const clientIds = [...new Set(page.map((e) => e.client_id).filter((v): v is string => !!v))];

					const [{ data: profiles }, { data: clients }] = await Promise.all([
						profileIds.size
							? supabase.from('profiles').select('id, first_name, last_name, email').in('id', [...profileIds]).returns<ProfileLite[]>()
							: Promise.resolve({ data: [] as ProfileLite[] }),
						clientIds.length
							? supabase.from('clients').select('id, name').in('id', clientIds).returns<{ id: string; name: string }[]>()
							: Promise.resolve({ data: [] as { id: string; name: string }[] }),
					]);
					const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
					const clientById = new Map((clients ?? []).map((c) => [c.id, c.name]));

					const mapped = page.map((e) => {
						const owner = profileById.get(e.user_id);
						return mapCalendarEvent(e, {
							ownerName: owner ? displayName(owner) : null,
							ownerEmail: owner?.email ?? null,
							clientName: e.client_id ? (clientById.get(e.client_id) ?? null) : null,
							internalAttendeeEmails: (e.attendee_user_ids ?? [])
								.map((id) => profileById.get(id)?.email)
								.filter((v): v is string => !!v),
						});
					});

					return {
						payload: { rows: mapped, count: rows.length, truncated, window: { starts_after: after, starts_before: before } },
						rows: mapped.length,
					};
				},
			),
	);
}
