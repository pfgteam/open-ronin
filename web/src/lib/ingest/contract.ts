// The ingest contract — what Beacon (or any feed) must send, pinned to a
// version. Property 2 of the ingest API: payloads carry contract_version and
// a mismatch is a 409, never a partial write.
//
// Bump CONTRACT_VERSION whenever a schema this API writes to changes shape
// (migration on these tables = new version). The sender pins the version it
// was built against; GET /api/contract-version says what this build expects.

import { z } from 'zod';

export const CONTRACT_VERSION = '2026-09-15.1'; // adds per-participant LARA scores (migration 0087)

export const MAX_BATCH_ROWS = 1000;

// ---------------------------------------------------------------- primitives

/** 'YYYY-MM-01' — metrics are monthly; the DB CHECK enforces first-of-month. */
const monthStart = z
	.string()
	.regex(/^\d{4}-\d{2}-01$/, 'period must be the first day of a month (YYYY-MM-01)');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoTimestamp = z.string().datetime({ offset: true });

/** How a row names its client. At least one key; resolution order as listed. */
const clientRef = z.object({
	client_id: z.string().uuid().optional(),             // clients_v2.id — preferred
	airtable_contract_id: z.string().min(1).optional(),  // contract-level key
});

// ---------------------------------------------------------------- feed rows

export const metricRow = z
	.object({
		subject_type: z.enum(['user', 'client', 'team']),
		subject_email: z.string().email().optional(),   // subject_type='user'
		subject_client: clientRef.optional(),           // subject_type='client'
		subject_ref: z.string().min(1).optional(),      // subject_type='team' (free key)
		metric_key: z.string().min(1),
		period: monthStart,
		value: z.number().nullable().optional(),
		goal: z.number().nullable().optional(),
		meta: z.record(z.unknown()).optional(),
	})
	.refine(
		(r) =>
			(r.subject_type === 'user' && !!r.subject_email) ||
			(r.subject_type === 'client' && !!r.subject_client) ||
			(r.subject_type === 'team' && !!r.subject_ref),
		{ message: 'subject key missing for subject_type' },
	);

export const engagementRow = z.object({
	airtable_contract_id: z.string().min(1),
	period_month: monthStart,
	calls_attended: z.number().int().min(0).optional(),
	calls_scheduled: z.number().int().min(0).optional(),
	emails_responded_to: z.number().int().min(0).optional(),
	emails_received: z.number().int().min(0).optional(),
	last_response_at: isoTimestamp.optional(),
	is_flagged: z.boolean().optional(),
	notes: z.string().optional(),
});

export const satisfactionRow = z.object({
	airtable_contract_id: z.string().min(1),
	captured_at: isoTimestamp,
	source: z.string().min(1).default('beacon'),
	nps: z.number().int().min(0).max(10).nullable().optional(),
	sentiment: z
		.enum(['very_positive', 'positive', 'neutral', 'negative', 'very_negative', 'ambiguous'])
		.optional(),
	qualitative_md: z.string().optional(), // MUST carry the quoted evidence span (property 3)
});

export const liveLinkRow = z.object({
	airtable_contract_id: z.string().min(1),
	url: z.string().url(),
	source_id: z.string().min(1),          // Beacon placement id — provenance
	outlet: z.string().optional(),
	headline: z.string().optional(),
	live_date: isoDate.optional(),
	reach: z.number().int().min(0).nullable().optional(),
	est_value_cents: z.number().int().min(0).nullable().optional(),
	tier: z.string().optional(),
	is_national: z.boolean().optional(),
	is_first: z.boolean().optional(),
	is_first_national: z.boolean().optional(),
	airtable_media_opp_id: z.string().optional(),
});

export const clientCommRow = z.object({
	airtable_contract_id: z.string().min(1),
	source_id: z.string().min(1),          // idempotency + provenance key
	occurred_at: isoTimestamp,
	channel: z.string().min(1),            // start with calls only (integration plan §5.9)
	from_party: z.string().optional(),
	to_party: z.string().optional(),
	subject: z.string().optional(),
	body_md: z.string().optional(),
	sentiment: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export const CALL_TYPES = [
	'sales_consult', 'client_followup', 'onboarding', 'discovery', 'calendar_review',
	'client_recurring', 'internal_standup', 'internal_project', 'hiring', 'next_steps',
	'strategy', 'media_training', 'personal_room', 'untyped',
] as const;

export const callRow = z.object({
	external_call_id: z.string().min(1),
	client: clientRef.optional(),          // omit for internal calls
	call_type: z.enum(CALL_TYPES).default('untyped'), // never guess: bare-name titles stay untyped
	occurred_at: isoTimestamp,
	duration_minutes: z.number().int().min(0).nullable().optional(),
	recording_url: z.string().url().optional(),
	transcript_url: z.string().url().optional(),
	attendee_emails: z.array(z.string().email()).optional(),
});

export const todoRow = z.object({
	airtable_contract_id: z.string().min(1),
	source_id: z.string().min(1),          // Zoom summary item id — idempotency + provenance
	title: z.string().min(1),
	description_md: z.string().optional(),
	assignee_email: z.string().email().optional(), // internal -> profiles; external stays as email
	due_at: isoTimestamp.optional(),
	priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

/** POST /api/ingest/trips (0111, Tier B #13). Additive endpoint: no
 *  CONTRACT_VERSION bump, existing senders keep their pin. */
export const TRIP_STATUSES = ['planned', 'booked', 'in_progress', 'completed', 'cancelled'] as const;
export const tripRow = z
	.object({
		source_id: z.string().min(1),          // sender's id (itinerary/booking ref) — idempotency
		traveler_email: z.string().email(),    // must resolve to a profile or the row is unmatched
		purpose: z.string().min(1).max(300),
		destination: z.string().min(1).max(200),
		depart_on: isoDate,
		return_on: isoDate,
		client: clientRef.optional(),
		status: z.enum(TRIP_STATUSES).default('planned'),
		cost_usd: z.number().min(0).optional(),
		notes_md: z.string().max(5000).optional(),
	})
	.refine((r) => r.return_on >= r.depart_on, { message: 'return_on must be on or after depart_on' });

const scoreTen = z.number().min(0).max(10);

export const sessionRow = z.object({
	zoom_meeting_id: z.string().min(1),
	call_type: z.enum(CALL_TYPES).default('untyped'),
	occurred_at: isoTimestamp,
	duration_minutes: z.number().int().min(0).nullable().optional(),
	client: clientRef.optional(),          // absent = internal call
	attendee_emails: z.array(z.string().email()).min(1),
	recording_url: z.string().url().optional(),
	transcript: z.object({
		content: z.string().min(1),
		language: z.string().optional(),
		word_count: z.number().int().min(0).optional(),
	}),
	analysis: z.object({
		analyzer: z.string().min(1),
		prompt_version: z.string().optional(),
		overall_score: scoreTen,
		summary_md: z.string().min(1),
		dimensions: z.array(z.object({
			dimension: z.string().min(1),
			score: scoreTen,
			note: z.string(),
		})).min(1),
		attention_points: z.array(z.object({
			severity: z.enum(['info', 'warning', 'critical']),
			point: z.string().min(1),
		})).default([]),
		suggested_tasks: z.array(z.object({
			title: z.string().min(1).max(200),
			detail_md: z.string().optional(),
			suggested_owner_email: z.string().email().optional(),
		})).default([]),
		// Per-participant LARA scores (migration 0087). .default([]) keeps every
		// pre-2026-09-15 payload valid: a call without this key simply has no
		// individual scores and the app shows "no individual score".
		//
		// Only INTERNAL participants get a row. An email here that has no
		// profile is dropped silently by the route (same treatment the call's
		// own external attendees already get) — the gap shows in the UI as
		// "N without a score", not as an ingest failure.
		participants: z.array(z.object({
			email: z.string().email(),
			listening: scoreTen,
			affirming: scoreTen,
			responding: scoreTen,
			asking: scoreTen,
			overall: scoreTen, // from the pipeline, never recomputed in the DB
			notes_md: z.string().optional(),
		})).default([]),
	}),
}).superRefine((row, ctx) => {
	// Cross-field: a scored participant must be an attendee of the call. A
	// participant outside attendee_emails is a malformed payload from the
	// pipeline (a name the model matched to nobody in the meeting), not
	// legitimate data — so it fails the row loudly rather than writing a
	// score onto a call the person never sat in.
	const attendees = new Set(row.attendee_emails.map((e) => e.toLowerCase()));
	row.analysis.participants.forEach((p, i) => {
		if (!attendees.has(p.email.toLowerCase())) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['analysis', 'participants', i, 'email'],
				message: `${p.email} is not in attendee_emails`,
			});
		}
	});
});

// Meeting-prep source emails (0150). One raw Gmail message per row, pushed by
// the inbox poller (scripts/meeting_emails_push.py); Open Ronin parses it so a
// parser fix can re-run over the stored history. Adding this row type does NOT
// bump CONTRACT_VERSION: no existing endpoint's payload changed, and a bump
// would 409 every other sender (the n8n Zoom pipeline) for nothing.
export const meetingEmailRow = z.object({
	message_id: z.string().min(1).max(200),       // Gmail message id (natural key)
	mailbox: z.string().email(),                   // whose inbox, e.g. owner@example.com
	received_at: isoTimestamp,
	from: z.string().min(3).max(320),              // raw From header; the sender decides the source
	subject: z.string().max(1000).default(''),
	html: z.string().max(2_000_000).optional(),
	text: z.string().max(2_000_000).optional(),
}).refine((r) => !!(r.html || r.text), { message: 'html or text body required' });

/** The envelope every POST body must match. */
export function batchSchema<R extends z.ZodTypeAny>(row: R) {
	return z.object({
		contract_version: z.string(),
		source_run: z.string().optional(), // sender's own run/job id, echoed into batch logs
		rows: z.array(row).min(1).max(MAX_BATCH_ROWS),
	});
}
