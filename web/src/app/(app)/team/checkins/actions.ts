'use server';

// Server actions for the check-in review marks + thread (migration 0038).
// RLS is the authority — these actions validate shape (zod), let the database
// decide authorization, and surface its refusals as readable messages.
// Every write is audited (recordAudit), same as the admin actions.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

const uuid = z.string().uuid();
const bodySchema = z.string().trim().min(1, 'Write something first.').max(4000, 'Max 4000 characters.');
// Paths we re-render after a write: the team view and the subject's profile.
const pathSchema = z.string().regex(/^\/[a-z0-9\-/[\]]*$/i).max(200);

async function requireUser() {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');
	return { supabase, userId: auth.user.id };
}

function revalidate(paths: string[]) {
	revalidatePath('/team/checkins');
	for (const p of paths) revalidatePath(p);
}

/**
 * Tell the check-in's owner something happened on their check-in. The bell
 * existed since 0039 but only the cron ever wrote to it — a manager could
 * comment and the person would only find out by revisiting the page.
 *
 * Service role on purpose: notifications has no authenticated INSERT policy
 * (0039's design — writers are jobs). Authorization already happened on the
 * comment/review write itself via RLS; this is its side effect, fired only
 * after that write succeeded. Never notifies the actor about their own action.
 * dedupe_key keeps re-marks and double submits from stacking bell entries.
 */
async function notifyCheckinOwner(input: {
	checkinId: string;
	actorId: string;
	kind: 'checkin_comment' | 'checkin_reviewed';
	title: string;
	body: string;
	dedupeKey: string;
}): Promise<void> {
	try {
		const service = createServiceRoleClient();
		const { data: checkin } = await service
			.from('weekly_checkins')
			.select('user_id')
			.eq('id', input.checkinId)
			.maybeSingle();
		const ownerId = (checkin as { user_id: string } | null)?.user_id;
		if (!ownerId || ownerId === input.actorId) return;

		await service.from('notifications').upsert(
			{
				user_id: ownerId,
				kind: input.kind,
				title: input.title,
				body: input.body,
				href: `/team/${ownerId}?tab=checkins`,
				dedupe_key: input.dedupeKey,
			},
			{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
		);
	} catch (e) {
		// A failed bell must never fail the comment that triggered it.
		console.error('[checkins] notification failed:', e);
	}
}

/** Mark / un-mark a submitted check-in as reviewed by the caller. */
export async function toggleReview(formData: FormData): Promise<void> {
	const checkinId = uuid.parse(formData.get('checkin_id'));
	const reviewed = formData.get('reviewed') === '1';
	const extraPath = pathSchema.safeParse(formData.get('return_path'));
	const { supabase, userId } = await requireUser();

	if (reviewed) {
		// Un-mark: delete my row (RLS: delete own only).
		const { error } = await supabase
			.from('checkin_reviews')
			.delete()
			.eq('checkin_id', checkinId)
			.eq('reviewer_id', userId);
		if (error) throw new Error(error.message);
	} else {
		const { error } = await supabase
			.from('checkin_reviews')
			.insert({ checkin_id: checkinId, reviewer_id: userId });
		// A duplicate mark (double submit) is fine — the unique constraint holds.
		if (error && error.code !== '23505') {
			throw new Error(
				error.code === '42501'
					? 'You cannot review this check-in (own check-in, or not submitted yet).'
					: error.message,
			);
		}
	}

	void recordAudit({
		actor_id: userId,
		entity_kind: 'supabase',
		entity_ref: `checkin_reviews/${checkinId}`,
		action: reviewed ? 'checkin.review.unmark' : 'checkin.review.mark',
	});
	if (!reviewed) {
		// Keyed by checkin+reviewer: re-marking after an unmark stays one bell.
		// Awaited, not fire-and-forget: on Vercel the container can freeze once
		// the response streams, dropping the write. notifyCheckinOwner is
		// internally try/catch-wrapped, so awaiting cannot fail the review.
		await notifyCheckinOwner({
			checkinId,
			actorId: userId,
			kind: 'checkin_reviewed',
			title: 'Your check-in was reviewed',
			body: 'A manager marked your weekly check-in as reviewed.',
			dedupeKey: `checkin_reviewed:${checkinId}:${userId}`,
		});
	}
	revalidate(extraPath.success ? [extraPath.data] : []);
}

/** Add a comment to a submitted check-in's thread. */
export async function addComment(formData: FormData): Promise<void> {
	const checkinId = uuid.parse(formData.get('checkin_id'));
	const body = bodySchema.parse(formData.get('body'));
	const extraPath = pathSchema.safeParse(formData.get('return_path'));
	const { supabase, userId } = await requireUser();

	const { data, error } = await supabase
		.from('checkin_comments')
		.insert({ checkin_id: checkinId, author_id: userId, body })
		.select('id')
		.maybeSingle();
	if (error) {
		throw new Error(
			error.code === '42501'
				? 'Comments only attach to submitted check-ins you can see.'
				: error.message,
		);
	}

	void recordAudit({
		actor_id: userId,
		entity_kind: 'supabase',
		entity_ref: `checkin_comments/${data?.id ?? checkinId}`,
		action: 'checkin.comment.add',
	});
	// Keyed by comment id: every comment is a distinct event worth a bell.
	// Awaited for the same reason as markReviewed's notifier above.
	await notifyCheckinOwner({
		checkinId,
		actorId: userId,
		kind: 'checkin_comment',
		title: 'New comment on your check-in',
		body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
		dedupeKey: `checkin_comment:${data?.id ?? checkinId}`,
	});
	revalidate(extraPath.success ? [extraPath.data] : []);
}

/** Edit your own comment. The 0038 trigger snapshots the previous body into
 *  comment_edit_history before the change lands. */
export async function editComment(formData: FormData): Promise<void> {
	const commentId = uuid.parse(formData.get('comment_id'));
	const body = bodySchema.parse(formData.get('body'));
	const extraPath = pathSchema.safeParse(formData.get('return_path'));
	const { supabase, userId } = await requireUser();

	// RLS limits the update to the author; .eq is belt-and-suspenders so a
	// non-author gets 0 rows instead of a silent no-op on someone else's row.
	const { data, error } = await supabase
		.from('checkin_comments')
		.update({ body })
		.eq('id', commentId)
		.eq('author_id', userId)
		.select('id')
		.maybeSingle();
	if (error) throw new Error(error.message);
	if (!data) throw new Error('Only the author can edit a comment.');

	void recordAudit({
		actor_id: userId,
		entity_kind: 'supabase',
		entity_ref: `checkin_comments/${commentId}`,
		action: 'checkin.comment.edit',
	});
	revalidate(extraPath.success ? [extraPath.data] : []);
}
