// Comments card for the work-item detail chassis (migration 0052). Server
// component: self-fetches its own thread by workItemId (same self-contained
// idiom as AttachmentsPanel/ChildrenPanel — it works regardless of what the
// page around it already queried), so Task 5/6 only need to drop it in with
// an id. The composer is a plain <form action> bound to an inline server
// action that calls addWorkItemComment (../social.ts) — no client JS
// required for the common case; @mention resolution and the follow-on
// notification are entirely addWorkItemComment's concern.
//
// Per spec: tasks get comments only, projects/goals get comments too (an
// update is a separate, health-bearing broadcast — see ProjectOverview's
// Updates card). This card is generic across all three.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import { addWorkItemComment } from '../social';
import LinkifiedText from '@/components/ui/LinkifiedText';

interface Props {
	workItemId: string;
	/** Read from `?commentError=` by the page (see MetricsSection's `error`
	 *  prop for the mirrored pattern) and rendered as a Callout above the
	 *  composer. Optional so a caller that doesn't wire query params yet
	 *  (no page reads this component before Task 5/6) still compiles. */
	error?: string;
}

interface ProfileRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

const nameOf = (p: ProfileRow) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

function initialsOf(name: string | null): string {
	if (!name) return '?';
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export default async function CommentsPanel({ workItemId, error }: Props) {
	const supabase = await createClient();

	// A failed query degrades to "no comments", which is visually identical to a
	// genuinely quiet thread — so log the cause (same treatment as ActivityCard
	// and attachments-actions). The return contract is unchanged: still an empty
	// list, never a thrown page.
	const { data: rows, error: commentsError } = await supabase
		.from('work_item_comments')
		.select('id, body, created_at, author_id')
		.eq('work_item_id', workItemId)
		.order('created_at', { ascending: true });
	if (commentsError) console.error('[CommentsPanel] comments query failed:', commentsError.message);

	const comments = rows ?? [];
	const authorIds = [...new Set(comments.map((c) => c.author_id).filter((id): id is string => !!id))];

	const { data: profileRows, error: profilesError } = authorIds.length > 0
		? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', authorIds)
		: { data: [] as ProfileRow[], error: null };
	if (profilesError) console.error('[CommentsPanel] author profiles query failed:', profilesError.message);
	const profileById = new Map((profileRows ?? []).map((p) => [p.id, p as ProfileRow]));

	// Inline server action — no separate 'actions.ts' export needed since this
	// only ever wraps addWorkItemComment for this one form. Empty-body submit
	// is already unreachable via the `required` attribute below. A real
	// backend failure (RLS, network) is surfaced with the same shape
	// saveMonthlyMetrics/fail() use (web/src/app/team/metrics/actions.ts):
	// redirect back to the item with a namespaced `commentError` query param,
	// rendered as a Callout by this component when the page passes it back
	// in as `error`. `commentError` (vs `metricsError`/`metricsSaved`/
	// `metricsSetSaved`) is scoped to comments only, so it cannot collide with
	// any existing or future param on this route. The typed text is not lost
	// on failure — this is a plain form POST with no client JS clearing it.
	//
	// The message shown is a fixed, human string — NEVER e.message. The real
	// error (which for a Postgres/RLS failure names the table and policy) is
	// logged server-side only. See task-4-report.md's "Fix — raw database
	// error string reached the user" for why this doesn't try to distinguish
	// "authorization" from "transient" failures: addWorkItemComment only
	// throws a plain Error with a message string (../social.ts:238), not the
	// original PostgrestError with its `code`, so there is nothing reliable
	// to branch on here short of pattern-matching the very string we're
	// trying not to depend on.
	async function submitComment(formData: FormData) {
		'use server';
		const body = String(formData.get('body') ?? '').trim();
		if (!body) return;
		try {
			await addWorkItemComment({ workItemId, body });
		} catch (e) {
			console.error('[CommentsPanel] addWorkItemComment failed:', e);
			redirect(`/the-work/${workItemId}?commentError=${encodeURIComponent('Could not post your comment. Try again.')}`);
		}
	}

	return (
		<Card>
			<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-2">
				Comments {comments.length > 0 && `(${comments.length})`}
			</div>

			{comments.length === 0 ? (
				<p className="text-xs text-slate-400 mb-3">No comments yet.</p>
			) : (
				<ul className="space-y-3 mb-3">
					{comments.map((c) => {
						const author = c.author_id ? profileById.get(c.author_id) ?? null : null;
						const authorName = author ? nameOf(author) : null;
						return (
							<li key={c.id} className="flex items-start gap-2.5">
								<span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-2xs font-medium flex items-center justify-center shrink-0">
									{initialsOf(authorName)}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 text-xs">
										<span className="font-medium text-slate-900 dark:text-slate-100">{authorName ?? 'Someone'}</span>
										<span className="text-slate-400">{formatRelative(c.created_at)}</span>
									</div>
									<p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 whitespace-pre-wrap break-words"><LinkifiedText text={c.body} /></p>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			{error && (
				<Callout tone="error" className="mb-3">
					{error}
				</Callout>
			)}

			<form action={submitComment} className="flex items-start gap-2">
				<input
					type="text"
					name="body"
					required
					maxLength={4000}
					placeholder="Write a comment… @Name to mention"
					className="flex-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
				/>
				<Button type="submit" size="sm">Post</Button>
			</form>
		</Card>
	);
}
