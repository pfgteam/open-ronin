'use server';

// Time Study server actions (0083). RLS + the guard triggers are the real
// rules (own rows only, study must be open, submitted entries lock); these
// validate shape, pass through, and return { ok, error } for the client grid.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { BUSINESS_TZ } from '@/lib/format';
import { eventToSlots, studyDays } from '@/lib/timeStudy/shared';
import { explainAndLog } from '@/lib/errors';

const PATH = '/social/time-study';

type Result = { ok: true } | { ok: false; error: string };

const Cell = z.object({
	day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	slot: z.number().int().min(0).max(143),
	category: z.string().min(1).max(64).nullable(),
	note: z.string().max(500).nullable().optional(),
});

/** Progressive save: a batch of cells; category null clears the slot. */
export async function saveTimeStudyCells(studyId: string, cells: unknown): Promise<Result> {
	if (!z.string().uuid().safeParse(studyId).success) return { ok: false, error: 'Invalid study.' };
	const parsed = z.array(Cell).max(2000).safeParse(cells);
	if (!parsed.success) return { ok: false, error: 'Invalid cells.' };

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false, error: 'You are signed out — sign in again and retry.' };

	const clears = parsed.data.filter((c) => c.category === null);
	const writes = parsed.data.filter((c) => c.category !== null);

	for (const c of clears) {
		const { error } = await supabase
			.from('time_study_entries')
			.delete()
			.eq('study_id', studyId)
			.eq('user_id', auth.user.id)
			.eq('day', c.day)
			.eq('slot', c.slot);
		if (error) return { ok: false, error: explainAndLog(error, 'time-study.actions') };
	}
	if (writes.length) {
		const { error } = await supabase.from('time_study_entries').upsert(
			writes.map((c) => ({
				study_id: studyId,
				user_id: auth.user.id,
				day: c.day,
				slot: c.slot,
				category: c.category as string,
				note: c.note ?? null,
				source: 'manual',
			})),
			{ onConflict: 'study_id,user_id,day,slot' },
		);
		if (error) return { ok: false, error: explainAndLog(error, 'time-study.actions') };
	}
	return { ok: true };
}

/**
 * Pull the person's own calendar events for the study window into slots
 * they have not filled yet. Manual entries always win; calendar rows are
 * re-pulled idempotently (same calendar_event_id -> same slots).
 */
export async function pullCalendarIntoStudy(studyId: string, defaultCategory: string): Promise<Result & { added?: number }> {
	if (!z.string().uuid().safeParse(studyId).success) return { ok: false, error: 'Invalid study.' };
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false, error: 'You are signed out — sign in again and retry.' };

	const { data: study } = await supabase.from('time_studies').select('starts_on, ends_on, status').eq('id', studyId).maybeSingle();
	if (!study) return { ok: false, error: 'Study not found.' };
	if (study.status !== 'open') return { ok: false, error: 'This study is not open for entry.' };

	const days = new Set(studyDays(study.starts_on as string));
	const { data: events, error: evError } = await supabase
		.from('calendar_events')
		.select('id, title, starts_at, ends_at, all_day, category_key, status')
		.eq('user_id', auth.user.id)
		.neq('status', 'cancelled')
		.eq('all_day', false)
		.gte('starts_at', `${study.starts_on}T00:00:00Z`)
		.lt('starts_at', `${study.ends_on}T23:59:59Z`)
		.order('starts_at');
	if (evError) return { ok: false, error: evError.message };

	const { data: existing } = await supabase
		.from('time_study_entries')
		.select('day, slot, source')
		.eq('study_id', studyId)
		.eq('user_id', auth.user.id);
	const manual = new Set((existing ?? []).filter((e) => e.source === 'manual').map((e) => `${e.day}:${e.slot}`));

	const rows: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	for (const ev of events ?? []) {
		// A meeting-ish category on the event maps to the meeting bucket; the
		// rest take the default the person chose.
		const cat = /client/i.test(ev.category_key ?? '') || /client/i.test(ev.title ?? '')
			? 'client_meeting'
			: /meeting|sync|standup|1:1|call/i.test(`${ev.category_key ?? ''} ${ev.title ?? ''}`)
				? 'internal_meeting'
				: defaultCategory;
		for (const { day, slot } of eventToSlots(ev.starts_at as string, (ev.ends_at as string | null) ?? null, BUSINESS_TZ, days)) {
			const key = `${day}:${slot}`;
			if (manual.has(key) || seen.has(key)) continue;
			seen.add(key);
			rows.push({
				study_id: studyId,
				user_id: auth.user.id,
				day,
				slot,
				category: cat,
				note: ev.title,
				source: 'calendar',
				calendar_event_id: ev.id,
			});
		}
	}
	if (rows.length) {
		const { error } = await supabase.from('time_study_entries').upsert(rows, { onConflict: 'study_id,user_id,day,slot' });
		if (error) return { ok: false, error: explainAndLog(error, 'time-study.actions') };
	}
	revalidatePath(PATH);
	return { ok: true, added: rows.length };
}

export async function submitTimeStudy(studyId: string): Promise<Result> {
	if (!z.string().uuid().safeParse(studyId).success) return { ok: false, error: 'Invalid study.' };
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const { error } = await supabase.from('time_study_submissions').insert({ study_id: studyId, user_id: auth.user.id });
	if (error) return { ok: false, error: explainAndLog(error, 'time-study.actions') };
	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `time_studies/${studyId}`,
		action: 'time_study.submit',
	});
	revalidatePath(PATH);
	return { ok: true };
}

export async function reviewTimeStudySubmission(studyId: string, userId: string, note: string | null): Promise<Result> {
	if (!z.string().uuid().safeParse(studyId).success || !z.string().uuid().safeParse(userId).success) return { ok: false, error: 'Invalid submission.' };
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	if (!canManagePeople(ctx)) return { ok: false, error: 'Only people-managers, exec or admin review submissions.' };
	const supabase = await createClient();
	const { error } = await supabase
		.from('time_study_submissions')
		.update({ reviewed_at: new Date().toISOString(), review_note: note })
		.eq('study_id', studyId)
		.eq('user_id', userId);
	if (error) return { ok: false, error: explainAndLog(error, 'time-study.actions') };
	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `time_studies/${studyId}/${userId}`,
		action: 'time_study.review',
	});
	revalidatePath(PATH);
	return { ok: true };
}

/** Admin: reopen one person's entry (deletes their submission row). */
export async function reopenTimeStudySubmission(studyId: string, userId: string): Promise<Result> {
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const supabase = await createClient();
	const { error } = await supabase.from('time_study_submissions').delete().eq('study_id', studyId).eq('user_id', userId);
	if (error) return { ok: false, error: explainAndLog(error, 'time-study.actions') };
	await recordAudit({ actor_id: ctx.viewerId, entity_kind: 'supabase', entity_ref: `time_studies/${studyId}/${userId}`, action: 'time_study.reopen' });
	revalidatePath(PATH);
	return { ok: true };
}
