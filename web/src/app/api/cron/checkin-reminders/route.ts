// GET /api/cron/checkin-reminders — Vercel Cron, hourly (see web/vercel.json).
//
// Sends the in-app check-in nudge: Friday morning for the week closing that
// day, Monday morning for the week that just closed. Every other hour exits
// immediately, which is why an hourly UTC schedule can serve a company that
// lives in America/Chicago through DST — company_local_parts() (0039) says
// what time it actually is there, and dueNudge() decides.
//
// Idempotency: each notification carries a DETERMINISTIC dedupe_key
// (checkin-reminder:<week>:<nudge>) and the insert conflicts on
// (user_id, dedupe_key). A retry, an overlapping run, or the next 23 hourly
// invocations insert nothing. That also makes the job self-healing: if the
// 9am run dies halfway, the 10am run finishes the list and skips whoever was
// already told.
//
// Service role is used ON PURPOSE and only here: the job writes notifications
// for OTHER people, which no authenticated policy allows (0039). The route is
// gated by CRON_SECRET, which fails closed.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { dueNudge, reminderCopy, reminderDedupeKey } from '@/lib/people/reminders';
import { formatWeekRange, shiftWeeks } from '@/lib/people/checkinWeeks';

export const dynamic = 'force-dynamic';
// Fans out over every profile due a nudge. The hourly self-healing retry
// hides a timeout, so pin the ceiling rather than inheriting the default.
export const maxDuration = 300;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/checkin-reminders', async () => {

		const supabase = createServiceRoleClient();

		// What time is it where the company lives? (DST included — SQL owns this.)
		const { data: partsRows, error: partsError } = await supabase.rpc('company_local_parts');
		if (partsError) {
			console.error('[cron/checkin-reminders] company_local_parts failed:', partsError.message);
			return NextResponse.json({ error: 'Could not read company time.' }, { status: 500 });
		}
		const parts = Array.isArray(partsRows) ? partsRows[0] : partsRows;
		const localHour = parts?.local_hour as number | undefined;
		const localDow = parts?.local_dow as number | undefined;
		if (localHour == null || localDow == null) {
			console.error('[cron/checkin-reminders] company_local_parts returned nothing usable');
			return NextResponse.json({ error: 'Could not read company time.' }, { status: 500 });
		}

		const nudge = dueNudge({ localHour, localDow });
		if (!nudge) {
			// The expected outcome for 166 of the week's 168 invocations.
			return NextResponse.json({ skipped: 'not a nudge hour', localHour, localDow });
		}

		const { data: currentWeekRaw, error: weekError } = await supabase.rpc('checkin_current_week_end');
		if (weekError || typeof currentWeekRaw !== 'string') {
			console.error('[cron/checkin-reminders] checkin_current_week_end failed:', weekError?.message);
			return NextResponse.json({ error: 'Could not resolve the reporting week.' }, { status: 500 });
		}
		const weekEnd = shiftWeeks(currentWeekRaw, nudge.weekOffset);

		// Who is expected and has not submitted (SQL owns the rule, incl. the
		// checkin_audience restriction list and "a draft is not a submit").
		const { data: missingRows, error: missingError } = await supabase.rpc('checkin_missing_for_week', {
			week: weekEnd,
		});
		if (missingError) {
			console.error('[cron/checkin-reminders] checkin_missing_for_week failed:', missingError.message);
			return NextResponse.json({ error: 'Could not resolve who is missing.' }, { status: 500 });
		}
		const userIds = (missingRows ?? []).map((r: unknown) =>
			typeof r === 'string' ? r : ((r as { checkin_missing_for_week?: string })?.checkin_missing_for_week ?? ''),
		).filter(Boolean) as string[];

		if (userIds.length === 0) {
			return NextResponse.json({ nudge: nudge.kind, weekEnd, sent: 0, note: 'nobody missing' });
		}

		const dedupeKey = reminderDedupeKey(weekEnd, nudge.kind);
		const { title, body } = reminderCopy(nudge.kind, formatWeekRange(weekEnd));

		// One statement, one conflict target. `ignoreDuplicates` is what turns the
		// unique index into the "already told them" check — no read-then-write
		// race between two concurrent runs.
		const { data: inserted, error: insertError } = await supabase
			.from('notifications')
			.upsert(
				userIds.map((user_id) => ({
					user_id,
					kind: 'checkin_reminder',
					title,
					body,
					href: `/team/${user_id}?tab=checkins`,
					dedupe_key: dedupeKey,
				})),
				{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
			)
			.select('id');

		if (insertError) {
			console.error('[cron/checkin-reminders] insert failed:', insertError.message);
			return NextResponse.json({ error: 'Could not write notifications.' }, { status: 500 });
		}

		const sent = inserted?.length ?? 0;
		console.log(
			`[cron/checkin-reminders] nudge=${nudge.kind} week=${weekEnd} missing=${userIds.length} sent=${sent} (${userIds.length - sent} already told)`,
		);
		return NextResponse.json({ nudge: nudge.kind, weekEnd, missing: userIds.length, sent });
	});
}
