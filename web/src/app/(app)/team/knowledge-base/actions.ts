'use server';

// Server actions for the Knowledge Base approval flow (migration 0074).
//
// Model: nothing writes wiki_pages directly except `publishRevision`. Every
// edit or new page is a wiki_revisions row with status = pending; an
// approver (canEditWiki: exec/admin/manager/people-managers) publishes or
// rejects it. RLS in 0074 enforces the same split, so these checks are the
// readable message in front of the database's refusal, not the only guard.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canEditWiki } from '@/lib/people/permissions';
import { recordAudit } from '@/lib/audit';
import { slugify } from '@/lib/wiki/wikilinks';
import { getRevision, WIKI_BASE } from '@/lib/wiki/_lib';
import { explainAndLog } from '@/lib/errors';

const uuid = z.string().uuid();
const title = z.string().trim().min(2, 'Title is too short.').max(160, 'Title is too long (160 max).');
const body = z.string().max(200_000, 'Page body is too large.');
const note = z.string().trim().max(500).optional();
// Static route segments under /[space]/ that a page slug must never shadow.
const RESERVED_SLUGS = new Set(['new', 'edit', 'history', 'changes']);

export type ActionResult = { ok: true; revisionId?: string; href?: string } | { ok: false; error: string };

async function requireViewer() {
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId || !ctx.viewerIsActive) throw new Error('Not signed in.');
	return ctx;
}

function revalidateWiki(spaceSlug?: string, pageSlug?: string) {
	revalidatePath(WIKI_BASE);
	revalidatePath(`${WIKI_BASE}/changes`);
	if (spaceSlug) revalidatePath(`${WIKI_BASE}/${spaceSlug}`);
	if (spaceSlug && pageSlug) revalidatePath(`${WIKI_BASE}/${spaceSlug}/${pageSlug}`);
}

/** Bell entry for the author when their change is decided, and for approvers when a change is proposed. Never throws. */
async function notify(rows: { user_id: string; kind: string; title: string; body: string; href: string; dedupe_key: string }[]) {
	if (rows.length === 0) return;
	try {
		const service = createServiceRoleClient();
		await service.from('notifications').upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	} catch (e) {
		console.error('[wiki] notification failed:', e);
	}
}

async function approverIds(excluding: string): Promise<string[]> {
	const service = createServiceRoleClient();
	const [{ data: roles }, { data: pms }] = await Promise.all([
		service.from('profiles').select('id').in('role', ['exec', 'admin', 'manager']).eq('is_active', true),
		service.from('people_managers').select('user_id'),
	]);
	const ids = new Set<string>();
	for (const r of roles ?? []) ids.add((r as { id: string }).id);
	for (const r of pms ?? []) ids.add((r as { user_id: string }).user_id);
	ids.delete(excluding);
	return [...ids];
}

// ---------------------------------------------------------------- propose

/**
 * Propose a NEW page. Lands as a pending create-revision; the wiki_pages row
 * is inserted only when an approver publishes it.
 */
export async function proposeNewPage(formData: FormData): Promise<ActionResult> {
	const ctx = await requireViewer();
	const parsed = z
		.object({
			space_id: uuid,
			space_slug: z.string().min(1),
			title,
			slug: z.string().trim().max(80).optional(),
			body_md: body,
			parent_page_id: z.union([uuid, z.literal('')]).optional(),
			reason: note,
		})
		.safeParse({
			space_id: formData.get('space_id'),
			space_slug: formData.get('space_slug'),
			title: formData.get('title'),
			slug: formData.get('slug') ?? undefined,
			body_md: formData.get('body_md') ?? '',
			parent_page_id: formData.get('parent_page_id') ?? undefined,
			reason: formData.get('reason') ?? undefined,
		});
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const input = parsed.data;

	const slug = slugify(input.slug || input.title);
	if (!slug) return { ok: false, error: 'Could not make a URL slug from that title.' };
	if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `"${slug}" is a reserved address; pick another title or slug.` };

	const supabase = await createClient();
	const { data: clash } = await supabase.from('wiki_pages').select('id').eq('space_id', input.space_id).eq('slug', slug).maybeSingle();
	if (clash) return { ok: false, error: `A page with the address "${slug}" already exists in this space. Edit it instead.` };

	const { data: rev, error } = await supabase
		.from('wiki_revisions')
		.insert({
			kind: 'create',
			status: 'pending',
			space_id: input.space_id,
			slug,
			parent_page_id: input.parent_page_id || null,
			title: input.title,
			body_md: input.body_md,
			reason: input.reason || null,
			edited_by: ctx.viewerId,
		})
		.select('id')
		.single();
	if (error || !rev) return { ok: false, error: error?.message ?? 'Could not save the proposal.' };

	void recordAudit({ actor_id: ctx.viewerId, entity_kind: 'supabase', entity_ref: `wiki_revisions/${rev.id}`, action: 'wiki.revision.propose_create' });
	await notify(
		(await approverIds(ctx.viewerId!)).map((uid) => ({
			user_id: uid,
			kind: 'wiki_change_proposed',
			title: 'Wiki change to review',
			body: `New page proposed: ${input.title}`,
			href: `${WIKI_BASE}/changes/${rev.id}`,
			dedupe_key: `wiki_rev_${rev.id}`,
		})),
	);
	revalidateWiki(input.space_slug);
	return { ok: true, revisionId: rev.id, href: `${WIKI_BASE}/changes/${rev.id}` };
}

/** Propose an edit to an existing page. Pending until an approver publishes it. */
export async function proposeEdit(formData: FormData): Promise<ActionResult> {
	const ctx = await requireViewer();
	const parsed = z
		.object({ page_id: uuid, title, body_md: body, reason: note })
		.safeParse({
			page_id: formData.get('page_id'),
			title: formData.get('title'),
			body_md: formData.get('body_md') ?? '',
			reason: formData.get('reason') ?? undefined,
		});
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const input = parsed.data;

	const supabase = await createClient();
	const { data: page } = await supabase
		.from('wiki_pages')
		.select('id, title, body_md, space:wiki_spaces(slug)')
		.eq('id', input.page_id)
		.maybeSingle();
	if (!page) return { ok: false, error: 'That page no longer exists.' };
	const live = page as unknown as { id: string; title: string; body_md: string | null; space: { slug: string } | null };
	if (live.title === input.title && (live.body_md ?? '') === input.body_md) {
		return { ok: false, error: 'No changes to propose.' };
	}

	const { data: rev, error } = await supabase
		.from('wiki_revisions')
		.insert({
			kind: 'edit',
			status: 'pending',
			page_id: input.page_id,
			title: input.title,
			body_md: input.body_md,
			reason: input.reason || null,
			edited_by: ctx.viewerId,
		})
		.select('id')
		.single();
	if (error || !rev) return { ok: false, error: error?.message ?? 'Could not save the proposal.' };

	void recordAudit({ actor_id: ctx.viewerId, entity_kind: 'supabase', entity_ref: `wiki_revisions/${rev.id}`, action: 'wiki.revision.propose_edit' });
	await notify(
		(await approverIds(ctx.viewerId!)).map((uid) => ({
			user_id: uid,
			kind: 'wiki_change_proposed',
			title: 'Wiki change to review',
			body: `Edit proposed: ${input.title}`,
			href: `${WIKI_BASE}/changes/${rev.id}`,
			dedupe_key: `wiki_rev_${rev.id}`,
		})),
	);
	revalidateWiki(live.space?.slug);
	return { ok: true, revisionId: rev.id, href: `${WIKI_BASE}/changes/${rev.id}` };
}

/** The author pulls their own pending change back. */
export async function withdrawRevision(formData: FormData): Promise<void> {
	const ctx = await requireViewer();
	const id = uuid.parse(formData.get('revision_id'));
	const supabase = await createClient();
	const { error } = await supabase.from('wiki_revisions').delete().eq('id', id).eq('edited_by', ctx.viewerId!).eq('status', 'pending');
	if (error) throw new Error(error.message);
	void recordAudit({ actor_id: ctx.viewerId, entity_kind: 'supabase', entity_ref: `wiki_revisions/${id}`, action: 'wiki.revision.withdraw' });
	revalidateWiki();
	redirect(`${WIKI_BASE}/changes`);
}

// ---------------------------------------------------------------- review

/**
 * Publish a pending revision: copy it into wiki_pages (insert for create,
 * update for edit) and mark the revision approved. Approver only.
 */
export async function publishRevision(formData: FormData): Promise<ActionResult> {
	const ctx = await requireViewer();
	if (!canEditWiki(ctx)) return { ok: false, error: 'Only wiki approvers can publish changes.' };
	const id = uuid.parse(formData.get('revision_id'));
	const reviewNote = note.parse(formData.get('review_note') ?? undefined);

	const rev = await getRevision(id);
	if (!rev) return { ok: false, error: 'That change no longer exists.' };
	if (rev.status !== 'pending') return { ok: false, error: `This change was already ${rev.status}.` };

	const supabase = await createClient();
	let pageId = rev.page_id;
	let spaceSlug: string | undefined;
	let pageSlug: string | undefined;

	if (rev.kind === 'create') {
		if (!rev.space_id || !rev.slug) return { ok: false, error: 'This proposal is missing its target space.' };
		const { data: clash } = await supabase.from('wiki_pages').select('id').eq('space_id', rev.space_id).eq('slug', rev.slug).maybeSingle();
		if (clash) return { ok: false, error: `A page at "${rev.slug}" was created in the meantime. Reject this and ask the author to propose an edit to it.` };
		const { data: page, error } = await supabase
			.from('wiki_pages')
			.insert({
				space_id: rev.space_id,
				parent_page_id: rev.parent_page_id,
				slug: rev.slug,
				title: rev.title,
				body_md: rev.body_md ?? '',
				created_by: rev.edited_by,
				last_edited_by: rev.edited_by,
			})
			.select('id')
			.single();
		if (error || !page) return { ok: false, error: error?.message ?? 'Could not create the page.' };
		pageId = page.id;
		spaceSlug = rev.space?.slug;
		pageSlug = rev.slug;
	} else {
		if (!pageId) return { ok: false, error: 'This proposal has no page.' };
		const { error } = await supabase
			.from('wiki_pages')
			.update({ title: rev.title, body_md: rev.body_md ?? '', last_edited_by: rev.edited_by })
			.eq('id', pageId);
		if (error) return { ok: false, error: explainAndLog(error, 'knowledge-base.actions') };
		spaceSlug = rev.page?.space?.slug;
		pageSlug = rev.page?.slug;
	}

	const { error: revErr } = await supabase
		.from('wiki_revisions')
		.update({ status: 'approved', page_id: pageId, reviewed_by: ctx.viewerId, reviewed_at: new Date().toISOString(), review_note: reviewNote || null })
		.eq('id', id);
	if (revErr) return { ok: false, error: revErr.message };

	void recordAudit({ actor_id: ctx.viewerId, entity_kind: 'supabase', entity_ref: `wiki_revisions/${id}`, action: 'wiki.revision.publish', diff: { page_id: pageId, kind: rev.kind } });
	if (rev.edited_by && rev.edited_by !== ctx.viewerId) {
		await notify([
			{
				user_id: rev.edited_by,
				kind: 'wiki_change_published',
				title: 'Your wiki change is live',
				body: rev.title,
				href: spaceSlug && pageSlug ? `${WIKI_BASE}/${spaceSlug}/${pageSlug}` : `${WIKI_BASE}/changes/${id}`,
				dedupe_key: `wiki_rev_${id}_published`,
			},
		]);
	}
	revalidateWiki(spaceSlug, pageSlug);
	return { ok: true, href: spaceSlug && pageSlug ? `${WIKI_BASE}/${spaceSlug}/${pageSlug}` : `${WIKI_BASE}/changes` };
}

/** Close a pending revision without publishing. Approver only; a note is expected. */
export async function rejectRevision(formData: FormData): Promise<ActionResult> {
	const ctx = await requireViewer();
	if (!canEditWiki(ctx)) return { ok: false, error: 'Only wiki approvers can reject changes.' };
	const id = uuid.parse(formData.get('revision_id'));
	const reviewNote = note.parse(formData.get('review_note') ?? undefined);

	const rev = await getRevision(id);
	if (!rev) return { ok: false, error: 'That change no longer exists.' };
	if (rev.status !== 'pending') return { ok: false, error: `This change was already ${rev.status}.` };

	const supabase = await createClient();
	const { error } = await supabase
		.from('wiki_revisions')
		.update({ status: 'rejected', reviewed_by: ctx.viewerId, reviewed_at: new Date().toISOString(), review_note: reviewNote || null })
		.eq('id', id);
	if (error) return { ok: false, error: explainAndLog(error, 'knowledge-base.actions') };

	void recordAudit({ actor_id: ctx.viewerId, entity_kind: 'supabase', entity_ref: `wiki_revisions/${id}`, action: 'wiki.revision.reject' });
	if (rev.edited_by && rev.edited_by !== ctx.viewerId) {
		await notify([
			{
				user_id: rev.edited_by,
				kind: 'wiki_change_rejected',
				title: 'Your wiki change was not published',
				body: reviewNote ? `${rev.title}: ${reviewNote}` : rev.title,
				href: `${WIKI_BASE}/changes/${id}`,
				dedupe_key: `wiki_rev_${id}_rejected`,
			},
		]);
	}
	revalidateWiki(rev.page?.space?.slug ?? rev.space?.slug, rev.page?.slug);
	return { ok: true, href: `${WIKI_BASE}/changes` };
}
