// Hiring cron work (0129+). Service role. Runs from /api/cron/hiring.
//
//   advancePostings   expire postings whose expires_at passed (posted/live ->
//                     expired) and bell the hiring manager + recruiter 5 days
//                     before expiry ("repost or take down") — once per posting
//                     per expiry date (dedupe_key). Daily tick.
//   advanceInterviews (0132) reminders 24 h and 1 h before a scheduled
//                     interview: drafted from the reminder templates, auto
//                     APPROVED (the human already reviewed the schedule and
//                     the template; spec flow 8 says reminders go out
//                     automatically) and sent on the same tick; SMS to the
//                     candidate's phone when present, email otherwise. 30 min
//                     after start with no scorecard submitted and status still
//                     scheduled -> no_show + a bell to the owner (spec: no-shows
//                     auto-marked). The no-show follow-up email is DRAFTED for
//                     review, not sent.
//   sendDue           approved messages whose scheduled_for passed.

import type { SupabaseClient } from '@supabase/supabase-js';
import { draftMessage, messageVars, sendDue, sendMessage } from './comms';

type Db = SupabaseClient;

export async function advancePostings(db: Db): Promise<{ expired: number; reminded: number }> {
	const nowIso = new Date().toISOString();
	const { data: expiredRows } = await db.from('hire_postings').update({ status: 'expired' }).in('status', ['posted', 'live']).lt('expires_at', nowIso).select('id');
	const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
	const { data: due } = await db
		.from('hire_postings')
		.select('id, position_id, board_key, expires_at, position:hire_positions!hire_postings_position_id_fkey(title, hiring_manager_id, recruiter_id)')
		.in('status', ['posted', 'live'])
		.lt('expires_at', soon)
		.is('reminder_sent_at', null)
		.limit(100);
	let reminded = 0;
	for (const row of (due ?? []) as unknown as { id: string; position_id: string; board_key: string; expires_at: string; position: { title: string; hiring_manager_id: string | null; recruiter_id: string | null } | null }[]) {
		const targets = [row.position?.hiring_manager_id, row.position?.recruiter_id].filter((x): x is string => !!x);
		for (const uid of new Set(targets)) {
			await db.from('notifications').upsert(
				{ user_id: uid, kind: 'hiring', title: `Posting expires soon: ${row.position?.title ?? 'role'} on ${row.board_key}`, body: `Expires ${row.expires_at.slice(0, 10)}. Repost it or mark it taken down in the post kit.`, href: `/hiring/positions/${row.position_id}?tab=postkit`, dedupe_key: `hire:posting-expiry:${row.id}:${row.expires_at.slice(0, 10)}` },
				{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
			);
		}
		await db.from('hire_postings').update({ reminder_sent_at: nowIso }).eq('id', row.id);
		reminded++;
	}
	return { expired: (expiredRows ?? []).length, reminded };
}

/** H7 (0134) daily: overdue onboarding bells, phase stamps, calibration enrolment after day 60. Service role RPC. */
export async function advanceOnboarding(db: Db): Promise<Record<string, unknown> | { error: string }> {
	const { data, error } = await db.rpc('hire_onboarding_tick');
	if (error) return { error: error.message };
	return (data ?? {}) as Record<string, unknown>;
}

interface Iv {
	id: string;
	application_id: string;
	position_id: string;
	kind: string;
	scheduled_at: string;
	timezone: string | null;
	location_text: string | null;
	booking_url: string | null;
	owner_id: string | null;
	interviewer_ids: string[];
	reminder_24h_at: string | null;
	reminder_1h_at: string | null;
}

async function remind(db: Db, iv: Iv, which: '24h' | '1h'): Promise<boolean> {
	const ctx = await messageVars(db, iv.application_id, iv.owner_id);
	if (!ctx) return false;
	const when = new Date(iv.scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: iv.timezone ?? 'America/Chicago' });
	const channel = ctx.candidate.phone_e164 ? 'sms' : 'email';
	const r = await draftMessage(db, {
		application_id: iv.application_id,
		candidate_id: ctx.candidate.id,
		interview_id: iv.id,
		template_key: which === '24h' ? 'reminder_24h' : 'reminder_1h',
		channel,
		vars: { ...ctx.vars, interview_kind: iv.kind.replace('_', ' '), when, timezone: iv.timezone ?? 'CST', location: iv.location_text ?? iv.booking_url ?? 'see your email', booking_url: iv.booking_url ?? '' },
		to: channel === 'sms' ? ctx.candidate.phone_e164! : ctx.candidate.email,
		subject: channel === 'email' ? `Reminder: your ${iv.kind.replace('_', ' ')} interview ${which === '24h' ? 'tomorrow' : 'in 1 hour'}` : null,
		drafted_by: null,
	});
	if (!r.ok) return false;
	// reminders are pre-approved: the schedule and the template were both reviewed by a person
	await db.from('hire_messages').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', r.id);
	const s = await sendMessage(db, r.id);
	return s.ok;
}

export async function advanceInterviews(db: Db): Promise<{ reminded_24h: number; reminded_1h: number; no_shows: number; sent: number; failed: string[] }> {
	const now = Date.now();
	const out = { reminded_24h: 0, reminded_1h: 0, no_shows: 0, sent: 0, failed: [] as string[] };
	const { data } = await db.from('hire_interviews').select('id, application_id, position_id, kind, scheduled_at, timezone, location_text, booking_url, owner_id, interviewer_ids, reminder_24h_at, reminder_1h_at').eq('status', 'scheduled').not('scheduled_at', 'is', null).gte('scheduled_at', new Date(now - 6 * 3_600_000).toISOString()).lte('scheduled_at', new Date(now + 25 * 3_600_000).toISOString()).limit(200);
	for (const iv of (data ?? []) as Iv[]) {
		const start = new Date(iv.scheduled_at).getTime();
		const hoursAway = (start - now) / 3_600_000;
		if (!iv.reminder_24h_at && hoursAway <= 24 && hoursAway > 2) {
			if (await remind(db, iv, '24h')) out.reminded_24h++;
			await db.from('hire_interviews').update({ reminder_24h_at: new Date().toISOString() }).eq('id', iv.id);
		}
		if (!iv.reminder_1h_at && hoursAway <= 1.1 && hoursAway > 0.1) {
			if (await remind(db, iv, '1h')) out.reminded_1h++;
			await db.from('hire_interviews').update({ reminder_1h_at: new Date().toISOString() }).eq('id', iv.id);
		}
		// no-show: 30 min past start, still scheduled, no human scorecard submitted
		if (hoursAway < -0.5) {
			const { count } = await db.from('hire_scorecards').select('id', { count: 'exact', head: true }).eq('interview_id', iv.id).eq('is_ai', false).not('submitted_at', 'is', null);
			if ((count ?? 0) === 0) {
				await db.from('hire_interviews').update({ status: 'no_show', no_show_marked_at: new Date().toISOString() }).eq('id', iv.id);
				out.no_shows++;
				const ctx = await messageVars(db, iv.application_id, iv.owner_id);
				if (ctx) {
					await draftMessage(db, { application_id: iv.application_id, candidate_id: ctx.candidate.id, interview_id: iv.id, template_key: 'no_show', channel: 'email', vars: { ...ctx.vars, interview_kind: iv.kind.replace('_', ' '), when: new Date(iv.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: iv.timezone ?? 'America/Chicago' }), booking_url: iv.booking_url ?? '' }, to: ctx.candidate.email, drafted_by: null });
					for (const uid of new Set([iv.owner_id, ...iv.interviewer_ids].filter((x): x is string => !!x))) {
						await db.from('notifications').upsert({ user_id: uid, kind: 'hiring', title: `No-show: ${ctx.candidate.full_name}`, body: `${iv.kind.replace('_', ' ')} interview auto-marked no-show. A follow-up email is drafted for your review. If the interview did happen, mark it completed and submit your scorecard.`, href: `/hiring/positions/${iv.position_id}/applications/${iv.application_id}`, dedupe_key: `hire:noshow:${iv.id}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
					}
				}
			}
		}
	}
	const due = await sendDue(db, 20);
	out.sent = due.sent;
	out.failed = due.failed;
	return out;
}
