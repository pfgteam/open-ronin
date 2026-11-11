'use server';

// Server actions for work-item "social" features (migration 0052): comments,
// followers, and URL deliverables. RLS is the authority — these actions
// validate shape (zod), let the database decide authorization, and surface
// its refusals as readable messages. Every write is audited (recordAudit),
// same pattern as web/src/app/team/checkins/actions.ts.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

const uuid = z.string().uuid();
const commentBodySchema = z
	.string()
	.trim()
	.min(1, 'Write something first.')
	.max(4000, 'Max 4000 characters.');
const pathSchema = z.string().regex(/^\/[a-z0-9\-/[\]]*$/i).max(200);
const urlSchema = z.string().refine((val) => {
	try {
		const u = new URL(val);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}, 'Enter a valid http(s) URL.');

async function requireUser() {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');
	return { supabase, userId: auth.user.id };
}

function revalidate(workItemId: string, extra?: string[]) {
	revalidatePath('/the-work/[id]', 'page');
	revalidatePath(`/the-work/${workItemId}`);
	for (const p of extra ?? []) revalidatePath(p);
}

// ---------------------------------------------------------------------------
// @mentions (v1, server-side only — no autocomplete UI yet, see spec).
//
// Matching rule, kept deliberately conservative:
//   1. A candidate token only starts where an '@' is preceded by whitespace
//      or the start of the string. This alone rules out an email address
//      sitting in prose ("reach me at foo@example.com") — there's no space
//      before that '@', so it never becomes a token.
//   2. A token is either "@First Last" (two words, both starting upper-case
//      — matched case-insensitively but requires BOTH first and last name to
//      match a real profile exactly) or a single bare word (matched, exactly
//      and case-insensitively, against the part of a profile's email before
//      the '@' — never a substring/partial match).
//   3. A token that matches no profile under either rule is left alone as
//      plain text — it is not an error, just not a mention. This is what
//      keeps "@here" or a made-up handle from ever pulling in a random
//      person: it only resolves if some profile's email literally starts
//      with "here@".
// ---------------------------------------------------------------------------

interface MentionableProfile {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

function extractMentionTokens(body: string): string[] {
	// Unicode-aware ('u' flag + \p{L}/\p{M}/\p{N} classes) so accented names
	// (Taylor Silvério, José, Ana-Clara) survive as a whole token instead of
	// truncating at the first non-ASCII letter — this team is Brazilian.
	const re = /(?:^|\s)@([\p{L}][\p{L}\p{M}\p{N}_'-]*(?:\s[\p{Lu}][\p{L}\p{M}\p{N}_'-]*)?)/gu;
	const tokens = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		tokens.add(m[1].trim());
	}
	return [...tokens];
}

function resolveMentions(body: string, profiles: MentionableProfile[]): string[] {
	const tokens = extractMentionTokens(body);
	if (tokens.length === 0) return [];
	const matched = new Set<string>();
	for (const token of tokens) {
		const parts = token.split(/\s+/);
		if (parts.length === 2) {
			const [first, last] = parts;
			const hit = profiles.find(
				(p) =>
					(p.first_name ?? '').toLowerCase() === first.toLowerCase() &&
					(p.last_name ?? '').toLowerCase() === last.toLowerCase(),
			);
			if (hit) matched.add(hit.id);
		} else {
			const prefix = token.toLowerCase();
			const hit = profiles.find((p) => p.email.split('@')[0]?.toLowerCase() === prefix);
			if (hit) matched.add(hit.id);
		}
	}
	return [...matched];
}

// ---------------------------------------------------------------------------
// Notifications — service-role writes only, never notify the actor about
// their own action, dedupe_key + ignoreDuplicates so re-marks/double submits
// never stack bell entries. A failed bell must never fail the write that
// triggered it. Structure copied from notifyCheckinOwner in
// web/src/app/team/checkins/actions.ts.
// ---------------------------------------------------------------------------

async function notifyWorkItemComment(input: {
	workItemId: string;
	commentId: string;
	actorId: string;
	body: string;
}): Promise<void> {
	try {
		const service = createServiceRoleClient();

		const { data: item } = await service
			.from('projects')
			.select('name, owner_id')
			.eq('id', input.workItemId)
			.maybeSingle();
		if (!item) return;

		const { data: followerRows } = await service
			.from('work_item_followers')
			.select('user_id')
			.eq('work_item_id', input.workItemId);

		const { data: profiles } = await service
			.from('profiles')
			.select('id, first_name, last_name, email');

		const mentionIds = resolveMentions(input.body, (profiles as MentionableProfile[] | null) ?? []);

		// @mention = follow (Work Revamp spec §5.4): the person mentioned keeps
		// getting this item's updates, not just this one comment.
		if (mentionIds.length) {
			await service
				.from('work_item_followers')
				.upsert(mentionIds.map((user_id) => ({ work_item_id: input.workItemId, user_id })), {
					onConflict: 'work_item_id,user_id',
					ignoreDuplicates: true,
				});
		}

		const recipients = new Set<string>();
		const ownerId = (item as { owner_id: string | null }).owner_id;
		if (ownerId) recipients.add(ownerId);
		for (const f of followerRows ?? []) recipients.add(f.user_id as string);
		for (const id of mentionIds) recipients.add(id);
		recipients.delete(input.actorId); // never notify the actor about their own comment

		if (recipients.size === 0) return;

		const itemName = (item as { name: string }).name;
		const title = `New comment on ${itemName}`;
		const body = input.body.length > 140 ? `${input.body.slice(0, 140)}…` : input.body;
		const rows = [...recipients].map((userId) => ({
			user_id: userId,
			kind: 'work_item_comment' as const,
			title,
			body,
			href: `/the-work/${input.workItemId}`,
			dedupe_key: `wi_comment:${input.commentId}:${userId}`,
		}));
		await service
			.from('notifications')
			.upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	} catch (e) {
		// A failed bell must never fail the comment that triggered it.
		console.error('[the-work/social] comment notification failed:', e);
	}
}

async function notifyWorkItemDeliverable(input: {
	workItemId: string;
	attachmentId: string;
	actorId: string;
	label: string;
}): Promise<void> {
	try {
		const service = createServiceRoleClient();

		const { data: item } = await service
			.from('projects')
			.select('name, owner_id')
			.eq('id', input.workItemId)
			.maybeSingle();
		if (!item) return;

		const { data: followerRows } = await service
			.from('work_item_followers')
			.select('user_id')
			.eq('work_item_id', input.workItemId);

		const recipients = new Set<string>();
		const ownerId = (item as { owner_id: string | null }).owner_id;
		if (ownerId) recipients.add(ownerId);
		for (const f of followerRows ?? []) recipients.add(f.user_id as string);
		recipients.delete(input.actorId); // never notify the actor about their own upload

		if (recipients.size === 0) return;

		const itemName = (item as { name: string }).name;
		const rows = [...recipients].map((userId) => ({
			user_id: userId,
			kind: 'work_item_deliverable' as const,
			title: `New deliverable on ${itemName}`,
			body: `A link was added: ${input.label}`,
			href: `/the-work/${input.workItemId}`,
			dedupe_key: `wi_deliverable:${input.attachmentId}:${userId}`,
		}));
		await service
			.from('notifications')
			.upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	} catch (e) {
		console.error('[the-work/social] deliverable notification failed:', e);
	}
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Add a comment to a work item's thread. Auto-follows the author, resolves
 *  @mentions, and bells the owner + every follower except the author. */
export async function addWorkItemComment(input: {
	workItemId: string;
	body: string;
	revalidate?: string[];
}): Promise<{ id: string }> {
	const workItemId = uuid.parse(input.workItemId);
	const body = commentBodySchema.parse(input.body);
	const extraPaths = (input.revalidate ?? []).filter((p) => pathSchema.safeParse(p).success);

	const { supabase, userId } = await requireUser();

	const { data, error } = await supabase
		.from('work_item_comments')
		.insert({ work_item_id: workItemId, author_id: userId, body })
		.select('id')
		.single();
	if (error || !data) throw new Error(error?.message ?? 'Insert failed.');
	const commentId = data.id as string;

	// Awaited, not fire-and-forget: on Vercel the container can freeze once the
	// response streams, dropping the audit write. Same reasoning as the
	// notifiers below.
	await recordAudit({
		actor_id: userId,
		entity_kind: 'supabase',
		entity_ref: `work_item_comments/${commentId}`,
		action: 'work_item.comment.add',
	});

	// Auto-follow: commenting implies interest. ignoreDuplicates means a
	// repeat comment never errors on the follower row that's already there.
	await supabase
		.from('work_item_followers')
		.upsert({ work_item_id: workItemId, user_id: userId }, { onConflict: 'work_item_id,user_id', ignoreDuplicates: true });

	// Awaited (not fire-and-forget): on Vercel serverless the container can be
	// frozen once the response streams back, dropping an un-awaited write.
	// The try/catch inside the notifier already isolates failure, so awaiting
	// cannot make the comment write fail — it only waits for the bell to land.
	await notifyWorkItemComment({ workItemId, commentId, actorId: userId, body });

	revalidate(workItemId, extraPaths);
	return { id: commentId };
}

/** Follow / unfollow a work item. No notification — following is silent. */
export async function toggleFollow(workItemId: string, follow: boolean): Promise<void> {
	const id = uuid.parse(workItemId);
	const { supabase, userId } = await requireUser();

	if (follow) {
		const { error } = await supabase
			.from('work_item_followers')
			.upsert({ work_item_id: id, user_id: userId }, { onConflict: 'work_item_id,user_id', ignoreDuplicates: true });
		if (error) throw new Error(error.message);
	} else {
		const { error } = await supabase
			.from('work_item_followers')
			.delete()
			.eq('work_item_id', id)
			.eq('user_id', userId);
		if (error) throw new Error(error.message);
	}

	// Awaited for the same reason as addWorkItemComment's audit write.
	await recordAudit({
		actor_id: userId,
		entity_kind: 'supabase',
		entity_ref: `work_item_followers/${id}/${userId}`,
		action: follow ? 'work_item.follow' : 'work_item.unfollow',
	});
	revalidate(id);
}

/** Attach a URL (link) deliverable to a work item — the non-upload sibling of
 *  attachments-actions.ts's file uploads. Real column names come straight
 *  from 0022 (file_name/storage_path/file_size/content_type/uploaded_by);
 *  0052 added url + is_deliverable and made storage_path nullable so a row
 *  is either a stored file or a link, never both. */
export async function addUrlAttachment(input: {
	workItemId: string;
	url: string;
	isDeliverable?: boolean;
	label?: string;
}): Promise<void> {
	const workItemId = uuid.parse(input.workItemId);
	const url = urlSchema.parse(input.url);
	const isDeliverable = input.isDeliverable ?? false;

	const { supabase, userId } = await requireUser();

	const fileName = input.label?.trim() || new URL(url).hostname;

	const { data, error } = await supabase
		.from('work_item_attachments')
		.insert({
			work_item_id: workItemId,
			url,
			is_deliverable: isDeliverable,
			file_name: fileName,
			uploaded_by: userId,
		})
		.select('id')
		.single();
	if (error || !data) throw new Error(error?.message ?? 'Insert failed.');

	// Awaited for the same reason as addWorkItemComment's audit write.
	await recordAudit({
		actor_id: userId,
		entity_kind: 'supabase',
		entity_ref: `work_item_attachments/${data.id}`,
		action: 'work_item.attachment.add_url',
	});

	if (isDeliverable) {
		// Awaited for the same reason as notifyWorkItemComment above.
		await notifyWorkItemDeliverable({ workItemId, attachmentId: data.id as string, actorId: userId, label: fileName });
	}

	revalidate(workItemId);
}
