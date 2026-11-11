'use server';

// Server actions for /the-work/calendar.
//
// Bidi sync model: every local mutation (create / update / delete) is
// followed by a push to Google Calendar if the user has a connection
// with bidirectional=true. When we bidi-create a manual event, we
// rewrite our row to source='google' + external_id=<google event id>
// so the next inbound sync recognizes it as the same row (no duplicates).
//
// Push failures are non-fatal — we set needs_outbound_sync=true so a
// future sync run picks them up. The user's edit still lands locally.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { createEvent, patchEvent, deleteEvent, type GoogleCalConnection, type UpsertEventPayload } from '@/lib/google/calendar';
import type { SupabaseClient } from '@supabase/supabase-js';
import { explainAndLog } from '@/lib/errors';

export interface UpsertEventInput {
	id?: string;                     // omit → create, include → update
	title: string;
	description_md?: string | null;
	starts_at: string;               // ISO
	ends_at: string;                 // ISO
	all_day?: boolean;
	category_key?: string | null;
	location?: string | null;
	url?: string | null;
	task_id?: string | null;         // link to a work_items row (any kind, but typically kind='task')
	project_id?: string | null;
	airtable_contract_id?: string | null;
	attendee_external?: string[];
	visibility?: 'default' | 'private' | null;
}

export async function upsertCalendarEvent(input: UpsertEventInput) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	const title = (input.title ?? '').trim();
	if (!title) return { ok: false as const, error: 'Title is required.' };

	const row: Record<string, unknown> = {
		user_id: auth.user.id,
		source: input.id ? undefined : 'manual',         // don't overwrite source on edit
		title,
		starts_at: input.starts_at,
		ends_at: input.ends_at,
		needs_outbound_sync: !input.id,                  // new manual events need Google push
		updated_at: new Date().toISOString(),
	};
	// undefined = leave untouched; null = explicit clear. The drawer doesn't
	// render url / task link / client link / external attendees — coalescing
	// them to null/[] here meant every edit of a Google-synced event wiped
	// its attendees and links (18/08 QA audit).
	const OPTIONAL_COLUMNS = [
		'description_md',
		'all_day',
		'category_key',
		'location',
		'url',
		'task_id',                                       // FK → work_items (was projects.tasks pre-merge)
		'project_id',
		'airtable_contract_id',
		'attendee_external',
		'visibility',
	] as const;
	for (const key of OPTIONAL_COLUMNS) {
		if (input[key] !== undefined) row[key] = input[key];
	}
	// Create-time defaults for fields the caller omitted.
	if (!input.id) {
		row.all_day ??= false;
		row.attendee_external ??= [];
		row.visibility ??= 'default';
	}
	// Drop undefined keys so update doesn't clear them
	Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);

	if (input.id) {
		const { error } = await supabase
			.from('calendar_events')
			.update(row)
			.eq('id', input.id)
			.eq('user_id', auth.user.id);
		if (error) return { ok: false as const, error: explainAndLog(error, 'calendar.actions') };
		// Bidi: push the update to Google (fire & forget — sets needs_outbound_sync on failure)
		void pushUpdateToGoogle(supabase, auth.user.id, input.id);
		revalidatePath('/the-work/calendar');
		return { ok: true as const, id: input.id };
	}

	const { data, error } = await supabase
		.from('calendar_events')
		.insert(row)
		.select('id')
		.single();
	if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed.' };
	// Bidi: push the create to Google (sets external_id + flips source to 'google' on success)
	void pushCreateToGoogle(supabase, auth.user.id, data.id);
	revalidatePath('/the-work/calendar');
	return { ok: true as const, id: data.id };
}

/** Quick resize / move — same as upsert but skips most fields. Used by
 *  the resize-drag handle + move-drag (future). Persists only times. */
export async function moveOrResizeEvent(input: {
	id: string;
	starts_at: string;
	ends_at: string;
}) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	if (new Date(input.ends_at) <= new Date(input.starts_at)) {
		return { ok: false as const, error: 'End must be after start.' };
	}

	const { error } = await supabase
		.from('calendar_events')
		.update({
			starts_at: input.starts_at,
			ends_at: input.ends_at,
			needs_outbound_sync: true,
			updated_at: new Date().toISOString(),
		})
		.eq('id', input.id)
		.eq('user_id', auth.user.id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'calendar.actions') };
	void pushUpdateToGoogle(supabase, auth.user.id, input.id);
	revalidatePath('/the-work/calendar');
	return { ok: true as const };
}

export async function deleteCalendarEvent(id: string) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	// Capture external_id BEFORE deleting so we can fan the delete out to Google.
	const { data: row } = await supabase
		.from('calendar_events')
		.select('source, external_id')
		.eq('id', id)
		.eq('user_id', auth.user.id)
		.maybeSingle();

	const { error } = await supabase
		.from('calendar_events')
		.delete()
		.eq('id', id)
		.eq('user_id', auth.user.id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'calendar.actions') };

	if (row?.source === 'google' && row.external_id) {
		void pushDeleteToGoogle(supabase, auth.user.id, row.external_id);
	}
	revalidatePath('/the-work/calendar');
	return { ok: true as const };
}

// ===========================================================================
// Bidi push helpers — call Google Calendar API after local mutations.
// All are fire-and-forget (no await in the caller). On failure they flip
// needs_outbound_sync=true so a future sync run retries the push.
// ===========================================================================

async function getActiveConnection(supabase: SupabaseClient, userId: string): Promise<GoogleCalConnection | null> {
	// Don't filter by sync_status: a stuck 'syncing' state (interrupted sync)
	// or a 'error' state on a previous pull shouldn't block outbound writes.
	// We just need bidirectional=true + a refresh token.
	const { data } = await supabase
		.from('google_calendar_connections')
		.select('*')
		.eq('user_id', userId)
		.eq('bidirectional', true)
		.not('encrypted_refresh_token', 'is', null)
		.maybeSingle();
	return (data as GoogleCalConnection | null);
}

function toGooglePayload(row: {
	title: string;
	description_md: string | null;
	location: string | null;
	starts_at: string;
	ends_at: string | null;
	attendee_external: string[] | null;
}): UpsertEventPayload {
	const end = row.ends_at ?? new Date(new Date(row.starts_at).getTime() + 60 * 60_000).toISOString();
	return {
		summary: row.title,
		description: row.description_md ?? undefined,
		location: row.location ?? undefined,
		start: { dateTime: row.starts_at },
		end: { dateTime: end },
		attendees: (row.attendee_external ?? []).map((email) => ({ email })),
	};
}

async function pushCreateToGoogle(supabase: SupabaseClient, userId: string, ourEventId: string) {
	const conn = await getActiveConnection(supabase, userId);
	if (!conn) return;
	const { data: row } = await supabase
		.from('calendar_events')
		.select('title, description_md, location, starts_at, ends_at, attendee_external, source, external_id')
		.eq('id', ourEventId)
		.maybeSingle();
	if (!row || row.source === 'google' || row.external_id) return;     // already synced or not eligible
	try {
		const created = await createEvent(conn, toGooglePayload(row));
		// Rewrite our row to match what an inbound sync would write so we
		// don't double-create on the next pull.
		await supabase
			.from('calendar_events')
			.update({
				source: 'google',
				external_id: created.id,
				external_calendar_id: conn.google_calendar_id,
				needs_outbound_sync: false,
				last_synced_at: new Date().toISOString(),
			})
			.eq('id', ourEventId);
	} catch (e) {
		await supabase
			.from('calendar_events')
			.update({ needs_outbound_sync: true })
			.eq('id', ourEventId);
		console.error('pushCreateToGoogle failed:', e instanceof Error ? e.message : e);
	}
}

async function pushUpdateToGoogle(supabase: SupabaseClient, userId: string, ourEventId: string) {
	const conn = await getActiveConnection(supabase, userId);
	if (!conn) return;
	const { data: row } = await supabase
		.from('calendar_events')
		.select('title, description_md, location, starts_at, ends_at, attendee_external, source, external_id')
		.eq('id', ourEventId)
		.maybeSingle();
	if (!row) return;
	try {
		if (row.source === 'google' && row.external_id) {
			await patchEvent(conn, row.external_id, toGooglePayload(row));
		} else if (!row.external_id) {
			// Was manual; create on Google now and re-link the row
			const created = await createEvent(conn, toGooglePayload(row));
			await supabase
				.from('calendar_events')
				.update({
					source: 'google',
					external_id: created.id,
					external_calendar_id: conn.google_calendar_id,
				})
				.eq('id', ourEventId);
		}
		await supabase
			.from('calendar_events')
			.update({ needs_outbound_sync: false, last_synced_at: new Date().toISOString() })
			.eq('id', ourEventId);
	} catch (e) {
		await supabase
			.from('calendar_events')
			.update({ needs_outbound_sync: true })
			.eq('id', ourEventId);
		console.error('pushUpdateToGoogle failed:', e instanceof Error ? e.message : e);
	}
}

async function pushDeleteToGoogle(supabase: SupabaseClient, userId: string, googleEventId: string) {
	const conn = await getActiveConnection(supabase, userId);
	if (!conn) return;
	try {
		await deleteEvent(conn, googleEventId);
	} catch (e) {
		console.error('pushDeleteToGoogle failed:', e instanceof Error ? e.message : e);
		// nothing to retry — the row is already gone locally
	}
}

/** Schedule an unscheduled task: creates a calendar_event linked to the task.
 *  Used by the drag-from-sidebar handler. Default duration = 1 hour. */
export async function scheduleTaskAt(input: {
	work_item_id: string;
	starts_at: string;
	duration_minutes?: number;
}) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	// Pull the work_item to copy its title + bring its project ownership over
	const { data: wi } = await supabase
		.from('projects')
		.select('id, name, parent_id, owner_id, kind')
		.eq('id', input.work_item_id)
		.single();
	if (!wi) return { ok: false as const, error: 'Task not found.' };

	const starts = new Date(input.starts_at);
	const ends = new Date(starts.getTime() + (input.duration_minutes ?? 60) * 60_000);

	// After 0009, tasks live in `projects` with kind='task'. Use project_id
	// (FK → projects) to link the event. If the task has a parent project,
	// we still record THE TASK ID as project_id — analytics roll up via
	// parent_id traversal at query time.
	return upsertCalendarEvent({
		title: wi.name,
		starts_at: starts.toISOString(),
		ends_at: ends.toISOString(),
		all_day: false,
		category_key: 'focus_block',
		project_id: wi.id,
	});
}
