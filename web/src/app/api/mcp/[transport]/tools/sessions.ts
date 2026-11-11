import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError } from '@/lib/mcp/tooling';
import { requireScope } from '@/lib/mcp/scopes';
import { latestAnalysisPerCall } from '@/lib/sessions/analysis';
import { mapCallDetail, mapCallRow } from '@/lib/mcp/mappers/calls';
import { CALL_TYPES } from '@/lib/ingest/contract';

const LIMIT = z.number().int().min(1).max(200).default(50);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

type CallListRow = {
	id: string;
	client_id: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	attendee_user_ids: string[];
	attendee_external: string[];
};

type AnalysisRow = {
	call_id: string;
	overall_score: number;
	attention_points: { severity: 'info' | 'warning' | 'critical'; point: string }[];
	created_at: string;
};

type SuggestedTaskCountRow = { call_id: string; status: string };
type ClientRow = { id: string; display_name: string };
type ProfileNameRow = { id: string; first_name: string | null; last_name: string | null };

export function registerSessionTools(server: McpServer): void {
	server.registerTool(
		'list_calls',
		{
			title: 'List calls',
			description:
				'Recorded calls (Sessions), newest first. Filter by client name, call type, attendee email, or an occurred_at date range. Each row carries the latest analysis score/band, attention-point counts, pending suggested-task count and attendee names. Transcripts are never returned.',
			inputSchema: {
				client: z.string().min(2).optional(),
				call_type: z.enum(CALL_TYPES).optional(),
				attendee_email: z.string().email().optional(),
				from: ISO_DATE.optional(),
				to: ISO_DATE.optional(),
				limit: LIMIT,
			},
		},
		async ({ client, call_type, attendee_email, from, to, limit }, extra) =>
			audited(
				'list_calls',
				'sessions:read',
				extra.authInfo,
				{ client, call_type, attendee_email, from, to, limit },
				'calls',
				async () => {
					const supabase = createServiceRoleClient();

					let clientIds: string[] | null = null;
					if (client) {
						const { data: matches } = await supabase
							.from('clients_v2')
							.select('id')
							.ilike('display_name', `%${client}%`)
							.returns<{ id: string }[]>();
						clientIds = (matches ?? []).map((c) => c.id);
						if (clientIds.length === 0) return { payload: { rows: [], count: 0, truncated: false }, rows: 0 };
					}

					let attendeeUserId: string | null = null;
					if (attendee_email) {
						const { data: profile } = await supabase
							.from('profiles')
							.select('id')
							.eq('email', attendee_email)
							.maybeSingle<{ id: string }>();
						if (!profile) return { payload: { rows: [], count: 0, truncated: false }, rows: 0 };
						attendeeUserId = profile.id;
					}

					let query = supabase
						.from('calls')
						.select('id, client_id, call_type, occurred_at, duration_minutes, attendee_user_ids, attendee_external')
						.order('occurred_at', { ascending: false })
						.limit(limit + 1);

					if (clientIds) query = query.in('client_id', clientIds);
					if (call_type) query = query.eq('call_type', call_type);
					if (attendeeUserId) query = query.contains('attendee_user_ids', [attendeeUserId]);
					if (from) query = query.gte('occurred_at', `${from}T00:00:00Z`);
					if (to) query = query.lte('occurred_at', `${to}T23:59:59.999Z`);

					const { data: callsData, error } = await query.returns<CallListRow[]>();
					if (error) throw error;

					const truncated = (callsData ?? []).length > limit;
					const calls = (callsData ?? []).slice(0, limit);

					const callIds = calls.map((c) => c.id);
					const clientIdsInPage = [...new Set(calls.map((c) => c.client_id).filter((v): v is string => !!v))];
					const attendeeIds = [...new Set(calls.flatMap((c) => c.attendee_user_ids ?? []))];

					const [analysesRes, tasksRes, clientsRes, profilesRes] = await Promise.all([
						callIds.length
							? supabase.from('call_analyses').select('call_id, overall_score, attention_points, created_at').in('call_id', callIds).returns<AnalysisRow[]>()
							: Promise.resolve({ data: [] as AnalysisRow[], error: null }),
						callIds.length
							? supabase.from('call_suggested_tasks').select('call_id, status').in('call_id', callIds).returns<SuggestedTaskCountRow[]>()
							: Promise.resolve({ data: [] as SuggestedTaskCountRow[], error: null }),
						clientIdsInPage.length
							? supabase.from('clients_v2').select('id, display_name').in('id', clientIdsInPage).returns<ClientRow[]>()
							: Promise.resolve({ data: [] as ClientRow[], error: null }),
						attendeeIds.length
							? supabase.from('profiles').select('id, first_name, last_name').in('id', attendeeIds).returns<ProfileNameRow[]>()
							: Promise.resolve({ data: [] as ProfileNameRow[], error: null }),
					]);

					const latestByCall = latestAnalysisPerCall(analysesRes.data ?? []);
					const pendingByCall = new Map<string, number>();
					for (const t of tasksRes.data ?? []) {
						if (t.status !== 'pending') continue;
						pendingByCall.set(t.call_id, (pendingByCall.get(t.call_id) ?? 0) + 1);
					}
					const clientById = new Map((clientsRes.data ?? []).map((c) => [c.id, c.display_name]));
					const profileById = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));

					const rows = calls.map((c) =>
						mapCallRow({
							call: c,
							analysis: latestByCall.get(c.id) ?? null,
							pendingSuggestions: pendingByCall.get(c.id) ?? 0,
							attendeeNames: (c.attendee_user_ids ?? [])
								.map((id) => profileById.get(id))
								.filter((p): p is ProfileNameRow => !!p)
								.map((p) => [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'),
							clientName: c.client_id ? (clientById.get(c.client_id) ?? null) : null,
						}),
					);

					return { payload: { rows, count: rows.length, truncated }, rows: rows.length };
				},
			),
	);

	server.registerTool(
		'get_call',
		{
			title: 'Get one call',
			description:
				'One call by id, with the full latest analysis (summary, rubric dimensions, attention points), suggested tasks, and attendees. Transcripts are never returned — use recording_url if present. Throws a tool error if no call has that id.',
			inputSchema: { id: z.string().uuid() },
		},
		async ({ id }, extra) =>
			audited('get_call', 'sessions:read', extra.authInfo, { id }, 'this call', async () => {
				const supabase = createServiceRoleClient();

				const { data: call, error: callError } = await supabase
					.from('calls')
					.select('id, client_id, call_type, occurred_at, duration_minutes, recording_url, attendee_user_ids, attendee_external')
					.eq('id', id)
					.maybeSingle();
				if (callError) throw callError;
				if (!call) throw userError('No call found with that id.');

				const [{ data: clientRow }, { data: attendeeProfiles }, { data: analysesMeta }] = await Promise.all([
					call.client_id
						? supabase.from('clients_v2').select('display_name').eq('id', call.client_id).maybeSingle<{ display_name: string }>()
						: Promise.resolve({ data: null as { display_name: string } | null }),
					(call.attendee_user_ids ?? []).length > 0
						? supabase.from('profiles').select('first_name, last_name, email').in('id', call.attendee_user_ids)
						: Promise.resolve({ data: [] as Array<{ first_name: string | null; last_name: string | null; email: string }> }),
					supabase
						.from('call_analyses')
						.select('id, analyzer, prompt_version, overall_score, created_at')
						.eq('call_id', call.id)
						.order('created_at', { ascending: false })
						.returns<Array<{ id: string; analyzer: string; prompt_version: string | null; overall_score: number; created_at: string }>>(),
				]);

				const allAnalysesMeta = analysesMeta ?? [];
				const latestMeta = allAnalysesMeta[0] ?? null;

				const [{ data: latestAnalysisFull }, { data: suggestedTasks }] = await Promise.all([
					latestMeta
						? supabase.from('call_analyses').select('summary_md, dimensions, attention_points').eq('id', latestMeta.id).maybeSingle()
						: Promise.resolve({ data: null }),
					supabase.from('call_suggested_tasks').select('title, detail_md, status, created_task_id').eq('call_id', call.id),
				]);

				const item = mapCallDetail({
					call,
					analysesMeta: allAnalysesMeta.map((a) => ({
						analyzer: a.analyzer,
						prompt_version: a.prompt_version,
						overall_score: a.overall_score,
						created_at: a.created_at,
					})),
					latestAnalysisFull: latestAnalysisFull ?? null,
					suggestedTasks: suggestedTasks ?? [],
					attendeeProfiles: attendeeProfiles ?? [],
					clientName: clientRow?.display_name ?? null,
				});

				return { payload: { item }, rows: 1 };
			}),
	);

	// ---------------------------------------------------------------- meeting prep (0150)
	// Read-only. Both tools call security-definer SQL (meeting_prep /
	// meeting_prep_for_day) that only the service role may execute; the shape
	// is documented in docs/MEETING_PREP.md.

	server.registerTool(
		'get_meeting_prep',
		{
			title: 'Meeting prep for one meeting',
			description:
				"Prep for one meeting: the previous meeting in the same recurring series (title, date, summary, recording link), that meeting's open action items with owners, and the user's open to-talk items for the series (things they said to raise next time). Identify the meeting by `event_ref` (Open Ronin calendar_events id OR the Google Calendar event id, e.g. 'abc123_20261005T200000Z'), or by `series_id` + `at` (the meeting's start). `meeting.is_sales` is true for sales calls; Alex skips prep for those. Sources: AlterCall session emails, Zoom recordings ingested by n8n, calendar. Read-only; transcripts are never returned.",
			inputSchema: {
				event_ref: z.string().min(1).max(200).optional(),
				series_id: z.string().uuid().optional(),
				at: z.string().datetime({ offset: true }).optional(),
				user_email: z.string().email().optional(), // default: the org owner (org_settings.owner_email)
				to_talk_days: z.number().int().min(1).max(365).default(60),
			},
		},
		async ({ event_ref, series_id, at, user_email, to_talk_days }, extra) =>
			audited(
				'get_meeting_prep',
				'sessions:read',
				extra.authInfo,
				{ event_ref, series_id, at, user_email, to_talk_days },
				'meeting prep',
				async () => {
					// The prep reads ANY user's calendar_events (user_email is free input)
					// through security-definer SQL: it is calendar data, so the calendar
					// scope is required on top of sessions:read (same as the calendar tool).
					const deniedCal = requireScope(extra.authInfo, 'calendar:read');
					if (deniedCal) throw userError(deniedCal);
					if (!event_ref && !series_id) throw userError('Pass event_ref (calendar event) or series_id + at.');
					const supabase = createServiceRoleClient();
					const { data, error } = await supabase.rpc('meeting_prep', {
						p_event_ref: event_ref ?? null,
						p_series_id: series_id ?? null,
						p_at: at ?? null,
						p_user_email: user_email,
						p_to_talk_days: to_talk_days,
					});
					if (error) throw error;
					const prep = data as { error?: string } | null;
					if (prep?.error === 'event_not_found') throw userError(`No calendar event matches ${event_ref}.`);
					if (prep?.error === 'series_not_found') throw userError(`No meeting series has id ${series_id}.`);
					return { payload: prep, rows: 1 };
				},
			),
	);

	server.registerTool(
		'meeting_prep_for_day',
		{
			title: "Meeting prep for a day's meetings",
			description:
				"get_meeting_prep for every meeting with at least one other invitee on the user's calendar on `date` (local date in `tz`), in start order. Sales calls are left out unless include_sales is true. Use this for the daily brief: one call returns every meeting's previous-meeting summary, open action items and to-talk items. Read-only.",
			inputSchema: {
				date: ISO_DATE,
				user_email: z.string().email().optional(), // default: the org owner (org_settings.owner_email)
				tz: z.string().min(1).max(64).default('America/Chicago'),
				include_sales: z.boolean().default(false),
			},
		},
		async ({ date, user_email, tz, include_sales }, extra) =>
			audited(
				'meeting_prep_for_day',
				'sessions:read',
				extra.authInfo,
				{ date, user_email, tz, include_sales },
				'meeting prep',
				async () => {
					const deniedCal = requireScope(extra.authInfo, 'calendar:read');
					if (deniedCal) throw userError(deniedCal);
					const supabase = createServiceRoleClient();
					const { data, error } = await supabase.rpc('meeting_prep_for_day', {
						p_date: date,
						p_user_email: user_email,
						p_tz: tz,
						p_include_sales: include_sales,
					});
					if (error) throw error;
					const day = data as { error?: string; meetings?: unknown[] } | null;
					if (day?.error === 'user_not_found') throw userError(`No team member found with email ${user_email}.`);
					return { payload: day, rows: day?.meetings?.length ?? 0 };
				},
			),
	);
}
