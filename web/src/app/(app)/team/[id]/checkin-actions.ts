'use server';

// Weekly check-in writes (migrations 0035 + 0065, PEOPLE_PLAN §9).
//
// Only the person themselves writes their own check-in — a manager reading it
// is read-only, enforced by RLS (weekly_checkins_insert_own / _update_own) and
// re-checked here.
//
// A week is WRITABLE while it is open (0065): from its Friday 09:15 company
// time until OPEN_PRIOR_WEEKS more Fridays have opened. Inside that window a
// submitted check-in can be edited and re-submitted — it keeps its original
// submitted_at, never goes back to draft. Outside it the DB trigger
// guard_checkin_write rejects the write, so a stale form gets an honest error
// instead of silently winning.
//
// Write ORDER matters: the check-in row is written first (a new one as a
// draft), then the responses, and the flip to 'submitted' comes LAST. Supabase
// has no client-side transaction, so a mid-way failure leaves a draft with
// partial responses — recoverable by re-submitting, never a corrupt record.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentWeekNotOpenYet, formatFridayAtOpening, openWeeks } from '@/lib/people/checkinWeeks';
import { loadCheckinWindow } from '@/lib/people/checkinWindow';

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CategoryRow {
	id: string;
	key: string;
	label: string;
	prompt: string;
	is_required: boolean;
	score_labels: string[];
}

const TextInput = z.object({
	weekly_high: z.string().max(4000).nullable(),
	weekly_low: z.string().max(4000).nullable(),
	extra_comments: z.string().max(4000).nullable(),
});

function fail(subjectId: string, week: string, message: string): never {
	redirect(
		`/team/${subjectId}?tab=checkins&week=${encodeURIComponent(week)}&checkinError=${encodeURIComponent(message)}`,
	);
}

/**
 * Saves the check-in for `weekEnd`. `submit = true` flips it to submitted,
 * which requires every required category plus the weekly high and low.
 * Saving an already-submitted week keeps it submitted (an edit), and the
 * same completeness rule applies — history is never left half-filled.
 */
export async function saveCheckin(
	subjectId: string,
	weekEnd: string,
	submit: boolean,
	formData: FormData,
): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	const viewerId = auth?.user?.id;

	if (!viewerId) fail(subjectId, weekEnd, 'You are signed out — sign in again and retry.');
	if (viewerId !== subjectId) {
		fail(subjectId, weekEnd, 'A check-in can only be written by the person it belongs to.');
	}
	if (!WEEK_RE.test(weekEnd)) fail(subjectId, weekEnd, 'Invalid week.');

	// The week must be open: the latest OPEN reporting week or one of the two
	// before it. Which Friday that is comes from the DB, so the app can never
	// disagree with the company timezone (checkin_window, 0065).
	const window = await loadCheckinWindow(supabase);
	if (!window) fail(subjectId, weekEnd, 'Could not read the current week.');
	if (!openWeeks(window.latestOpenWeekEnd).includes(weekEnd)) {
		if (weekEnd === window.currentWeekEnd && currentWeekNotOpenYet(window)) {
			fail(
				subjectId,
				weekEnd,
				`This week's check-in opens ${formatFridayAtOpening(window.currentWeekEnd)} — once the week has actually happened.`,
			);
		}
		fail(
			subjectId,
			weekEnd,
			'That week is closed — you can fill in or edit the latest open week or the two before it.',
		);
	}

	const str = (k: string) => {
		const v = formData.get(k);
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	};

	const parsed = TextInput.safeParse({
		weekly_high: str('weekly_high'),
		weekly_low: str('weekly_low'),
		extra_comments: str('extra_comments'),
	});
	if (!parsed.success) fail(subjectId, weekEnd, parsed.error.issues[0].message);
	const text = parsed.data;

	const { data: catRows } = await supabase
		.from('checkin_categories')
		.select('id, key, label, prompt, is_required, score_labels')
		.eq('is_active', true)
		.order('sort');
	const categories = (catRows ?? []) as CategoryRow[];
	if (categories.length === 0) {
		fail(subjectId, weekEnd, 'No check-in categories are configured yet.');
	}

	// Collect the scores present in the form.
	const scores = new Map<string, number>();
	for (const cat of categories) {
		const raw = formData.get(`score:${cat.key}`);
		if (typeof raw !== 'string' || raw === '') continue;
		const n = Number(raw);
		if (!Number.isInteger(n) || n < 1 || n > 5) {
			fail(subjectId, weekEnd, `Invalid score for ${cat.label}.`);
		}
		scores.set(cat.key, n);
	}

	// ----- 1. the check-in row ----------------------------------------------
	const { data: existing } = await supabase
		.from('weekly_checkins')
		.select('id, status')
		.eq('user_id', subjectId)
		.eq('week_end', weekEnd)
		.maybeSingle();

	const alreadySubmitted = existing?.status === 'submitted';
	// Editing a submitted week keeps it submitted: there is no "save draft" on
	// history, and the trigger would refuse a status downgrade anyway.
	const willBeSubmitted = submit || alreadySubmitted;

	if (willBeSubmitted) {
		const missing = categories.filter((c) => c.is_required && !scores.has(c.key));
		if (missing.length > 0) {
			fail(subjectId, weekEnd, `Still missing: ${missing.map((c) => c.label).join(', ')}.`);
		}
		if (!text.weekly_high || !text.weekly_low) {
			fail(subjectId, weekEnd, 'Your high and low for the week are both required to submit.');
		}
	}

	let checkinId = existing?.id as string | undefined;

	if (!checkinId) {
		const { data: created, error: insertError } = await supabase
			.from('weekly_checkins')
			.insert({
				user_id: subjectId,
				week_end: weekEnd,
				status: 'draft',
				weekly_high: text.weekly_high,
				weekly_low: text.weekly_low,
				extra_comments: text.extra_comments,
			})
			.select('id')
			.single();
		if (insertError || !created) {
			fail(subjectId, weekEnd, `Could not start the check-in: ${insertError?.message ?? 'unknown error'}`);
		}
		checkinId = created.id as string;
	} else {
		const { error: updateError } = await supabase
			.from('weekly_checkins')
			.update({
				weekly_high: text.weekly_high,
				weekly_low: text.weekly_low,
				extra_comments: text.extra_comments,
			})
			.eq('id', checkinId);
		if (updateError) fail(subjectId, weekEnd, `Could not save: ${updateError.message}`);
	}

	// ----- 2. responses, with the label snapshots ---------------------------
	const rows = categories
		.filter((c) => scores.has(c.key))
		.map((c) => {
			const score = scores.get(c.key)!;
			return {
				checkin_id: checkinId!,
				category_id: c.id,
				category_key: c.key,
				category_label: c.label,
				score,
				score_label: c.score_labels[score - 1] ?? String(score),
				comment: str(`comment:${c.key}`),
			};
		});

	if (rows.length > 0) {
		const { error: respError } = await supabase
			.from('checkin_responses')
			.upsert(rows, { onConflict: 'checkin_id,category_id' });
		if (respError) fail(subjectId, weekEnd, `Could not save your answers: ${respError.message}`);
	}

	// ----- 2b. Work Revamp extras (0140): help request + next-week focus --
	// Fail-soft: before 0140 is applied the column/table don't exist, and the
	// check-in must still save exactly as it did.
	const help = str('help_request');
	if (help && help.length > 1000) fail(subjectId, weekEnd, 'The help request is too long (1000 characters max).');
	if (formData.has('help_request')) {
		const { error: helpError } = await supabase.from('weekly_checkins').update({ help_request: help }).eq('id', checkinId);
		if (helpError && !/help_request|PGRST204|schema cache/i.test(`${helpError.code} ${helpError.message}`)) {
			fail(subjectId, weekEnd, `Could not save your help request: ${helpError.message}`);
		}
	}
	if (formData.has('focus_present')) {
		const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		const focus = [...new Set(formData.getAll('focus').map(String).filter((x) => UUID.test(x)))].slice(0, 3);
		const { error: delError } = await supabase.from('checkin_focus').delete().eq('checkin_id', checkinId);
		const missing = delError && /42P01|PGRST205|does not exist|schema cache/i.test(`${delError.code} ${delError.message}`);
		if (!missing) {
			if (delError) fail(subjectId, weekEnd, `Could not save your focus: ${delError.message}`);
			if (focus.length) {
				const { error: focusError } = await supabase
					.from('checkin_focus')
					.insert(focus.map((work_item_id, position) => ({ checkin_id: checkinId!, work_item_id, position })));
				if (focusError) fail(subjectId, weekEnd, `Could not save your focus: ${focusError.message}`);
			}
		}
	}

	// ----- 3. and only now, the flip to submitted --------------------------
	// A first submission stamps submitted_at; on an edit the trigger keeps the
	// original stamp, so re-sending it here is harmless.
	if (submit && !alreadySubmitted) {
		const { error: submitError } = await supabase
			.from('weekly_checkins')
			.update({ status: 'submitted', submitted_at: new Date().toISOString() })
			.eq('id', checkinId);
		if (submitError) fail(subjectId, weekEnd, `Could not submit: ${submitError.message}`);
	}

	revalidatePath(`/team/${subjectId}`);
	revalidatePath('/');
	const outcome = alreadySubmitted ? 'edited' : submit ? 'submitted' : 'draft';
	redirect(
		`/team/${subjectId}?tab=checkins&week=${encodeURIComponent(weekEnd)}&checkinSaved=${outcome}`,
	);
}
