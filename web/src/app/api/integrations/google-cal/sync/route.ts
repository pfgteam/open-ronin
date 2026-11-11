// POST /api/integrations/google-cal/sync
//
// Triggered: (a) inline from the OAuth callback, (b) the Sync button on
// /the-work/calendar, (c) future cron. Pulls events from each of the
// caller's google_calendar_connections rows, upserts to calendar_events.
//
// Uses Google's incremental sync via sync_token — first call fetches a
// 4-month window and persists the next sync_token; subsequent calls only
// fetch deltas. If the sync_token expires (410), we reset and refetch.
//
// After read sync, runs the AI attribution job (rules-first w/ Claude
// fallback) — see attribute.ts — and writes time_entries for events that
// match a project / task / client.

import { isInternalEmail } from '@/lib/tenant/domains';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listEvents, type GoogleEvent, type GoogleCalConnection } from '@/lib/google/calendar';
import { attributeEventsToWork } from '@/lib/google/attribute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;     // server action; Google sync can take >10s on first run

export async function POST(request: NextRequest) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	// ?full=1 → clear the stored sync_token first so we refetch the whole
	// window. Use this when Google's incremental delta has been slow to
	// surface a change you just made on the other side (e.g. resized an
	// event in google's web UI seconds before clicking Sync Now).
	const url = new URL(request.url);
	const forceFull = url.searchParams.get('full') === '1';

	const { data: conns } = await supabase
		.from('google_calendar_connections')
		.select('*')
		.eq('user_id', auth.user.id);

	if (!conns || conns.length === 0) {
		return NextResponse.json({ ok: true, message: 'No active connections.' });
	}

	if (forceFull) {
		await supabase
			.from('google_calendar_connections')
			.update({ sync_token: null })
			.eq('user_id', auth.user.id);
		conns.forEach((c) => { c.sync_token = null; });
	}

	let totalUpserted = 0;
	let totalAttributed = 0;
	const errors: string[] = [];

	for (const conn of conns as GoogleCalConnection[]) {
		try {
			const upserted = await syncOne(conn, supabase);
			totalUpserted += upserted.length;
			const attributed = await attributeEventsToWork(supabase, auth.user.id, upserted);
			totalAttributed += attributed;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`${conn.google_calendar_id}: ${msg}`);
			await supabase
				.from('google_calendar_connections')
				.update({ sync_status: 'error', sync_error: msg })
				.eq('id', conn.id);
		}
	}

	return NextResponse.json({
		ok: errors.length === 0,
		upserted: totalUpserted,
		attributed: totalAttributed,
		errors: errors.length > 0 ? errors : undefined,
	});
}

async function syncOne(conn: GoogleCalConnection, supabase: Awaited<ReturnType<typeof createClient>>): Promise<string[]> {
	let pageToken: string | undefined;
	let nextSyncToken: string | undefined;
	const upsertedIds: string[] = [];

	// Mark syncing — wrapped in try/finally so a crash doesn't leave the
	// row stuck at 'syncing' (which would block bidi pushes if we ever
	// re-add the sync_status='ok' filter on getActiveConnection).
	await supabase.from('google_calendar_connections').update({ sync_status: 'syncing', sync_error: null }).eq('id', conn.id);

	try {

	do {
		let page: Awaited<ReturnType<typeof listEvents>>;
		try {
			page = await listEvents(conn, { pageToken });
		} catch (e) {
			if (e instanceof Error && e.message === 'SYNC_TOKEN_EXPIRED') {
				// Reset and retry from scratch
				await supabase.from('google_calendar_connections').update({ sync_token: null }).eq('id', conn.id);
				conn.sync_token = null;
				page = await listEvents(conn, { pageToken });
			} else {
				throw e;
			}
		}

		// One upsert per page, not per event. The per-row version cost a
		// Supabase round trip per event; a 1,300-event first sync took longer
		// than maxDuration, the function was killed mid-loop, and the row sat
		// at 'syncing' forever (observed: two connections stuck since Sept 10-11).
		// Dedupe within the page so ON CONFLICT never sees the same key twice.
		const rowsById = new Map<string, NonNullable<ReturnType<typeof mapGoogleEvent>>>();
		for (const ev of page.items ?? []) {
			const row = mapGoogleEvent(ev, conn);
			if (row) rowsById.set(row.external_id, row);
		}
		const rows = [...rowsById.values()];
		if (rows.length > 0) {
			const { data, error } = await supabase
				.from('calendar_events')
				.upsert(rows, { onConflict: 'user_id,source,external_id' })
				.select('id');
			if (error) throw new Error(`upsert ${rows.length} events: ${error.message}`);
			for (const d of data ?? []) if (d?.id) upsertedIds.push(d.id);
		}

		pageToken = page.nextPageToken;
		if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
	} while (pageToken);

	await supabase.from('google_calendar_connections')
		.update({
			sync_token: nextSyncToken ?? null,
			last_synced_at: new Date().toISOString(),
			sync_status: 'ok',
			sync_error: null,
		})
		.eq('id', conn.id);

	return upsertedIds;
	} catch (e) {
		// On any failure, reset status away from 'syncing' so subsequent
		// runs (or bidi pushes) aren't blocked by stale state.
		await supabase
			.from('google_calendar_connections')
			.update({ sync_status: 'error', sync_error: e instanceof Error ? e.message : String(e) })
			.eq('id', conn.id);
		throw e;
	}
}

/** Google event → calendar_events row. Returns null for cancelled events
 *  (we delete instead — see below) or events with no start time. */
function mapGoogleEvent(ev: GoogleEvent, conn: GoogleCalConnection) {
	if (!ev.id) return null;
	const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
	if (!start) return null;
	const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);

	const allDay = !!ev.start?.date && !ev.start?.dateTime;
	const status = ev.status === 'cancelled' ? 'cancelled' : (ev.status === 'tentative' ? 'tentative' : 'confirmed');

	return {
		user_id: conn.user_id,
		source: 'google' as const,
		external_id: ev.id,
		external_calendar_id: conn.google_calendar_id,
		category_key: guessCategory(ev),
		title: ev.summary ?? '(untitled)',
		description_md: ev.description ?? null,
		location: ev.location ?? null,
		url: ev.htmlLink ?? null,
		starts_at: start,
		ends_at: end,
		all_day: allDay,
		recurring_rule: ev.recurrence?.[0] ?? null,
		attendee_external: (ev.attendees ?? []).map((a) => a.email).filter((e): e is string => !!e),
		status,
		last_synced_at: new Date().toISOString(),
	};
}

/** Lightweight heuristic to bucket events into our calendar_event_categories.
 *  AI attribution refines this later for unmatched/internal events. */
function guessCategory(ev: GoogleEvent): string {
	// Google's own classification first — authoritative, no guessing.
	if (ev.eventType === 'outOfOffice') return 'time_off';
	if (ev.eventType === 'focusTime') return 'focus_block';
	const t = (ev.summary ?? '').toLowerCase();
	if (t.includes('1:1') || t.includes('1-on-1') || t.includes('one on one')) return '1on1';
	if (t.includes('l10') || t.includes('level 10') || t.includes('weekly')) return 'l10';
	if (t.includes('podcast') || t.includes('interview')) return 'podcast';
	if (t.includes('sales') || t.includes('discovery') || t.includes('prospect')) return 'sales_call';
	if (t.includes('focus') || t.includes('deep work')) return 'focus_block';
	if (t.includes('travel') || t.includes('flight')) return 'travel';
	// WORD-boundary match for the acronyms: a bare includes('pto') put every
	// "Beacon …" meeting into time_off (ra-PTO-r), which polluted the category
	// on 99 of 196 rows before 2026-08-23. includes('ooo') had the same shape
	// of bug waiting ("cooool").
	if (/\b(?:pto|ooo)\b/.test(t) || t.includes('out of office')) return 'time_off';
	// External attendees → likely client call
	const externalAttendees = (ev.attendees ?? []).filter((a) => {
		const email = (a.email ?? '').toLowerCase();
		return email && !isInternalEmail(email);
	});
	if (externalAttendees.length > 0) return 'client_call';
	if ((ev.attendees ?? []).length > 1) return 'internal_meet';
	return 'other';
}
