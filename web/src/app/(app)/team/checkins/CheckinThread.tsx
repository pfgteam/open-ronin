// Two-way thread + review marks on a SUBMITTED check-in (migration 0038).
// Server component — rendered inside the manager Team view expand AND inside
// the profile's CheckinSection, so both sides of the conversation see the
// same thing. Data comes in as props (the parent already fetched the week);
// this component only renders + wires the actions.

import Button from '@/components/ui/Button';
import { inputClass } from '../_form';
import { addComment, editComment, toggleReview } from './actions';
import { formatRelative } from '@/lib/format';
import { CheckCircle2, MessageSquare, Pencil } from 'lucide-react';

export interface ThreadComment {
	id: string;
	author_id: string;
	author_name: string;
	body: string;
	created_at: string;
	edited_at: string | null;
}

export interface ThreadReview {
	reviewer_id: string;
	reviewer_name: string;
	reviewed_at: string;
}

export default function CheckinThread({
	checkinId,
	viewerId,
	subjectId,
	comments,
	reviews,
	returnPath,
}: {
	checkinId: string;
	viewerId: string;
	subjectId: string;
	comments: ThreadComment[];
	reviews: ThreadReview[];
	returnPath: string;
}) {
	const myReview = reviews.some((r) => r.reviewer_id === viewerId);
	const canReview = viewerId !== subjectId;

	return (
		<div className="space-y-3">
			{/* Review marks — per reviewer, never a single boolean (0038). */}
			<div className="flex items-center gap-2 flex-wrap">
				{reviews.length > 0 ? (
					reviews.map((r) => (
						<span
							key={r.reviewer_id}
							className="inline-flex items-center gap-1 text-2xs text-green-700 dark:text-green-400"
							title={new Date(r.reviewed_at).toLocaleString('en-US')}
						>
							<CheckCircle2 className="w-3 h-3" /> Reviewed by {r.reviewer_name}
						</span>
					))
				) : (
					<span className="text-2xs text-slate-600 dark:text-slate-400">Not reviewed yet</span>
				)}
				{canReview && (
					<form action={toggleReview} className="ml-auto">
						<input type="hidden" name="checkin_id" value={checkinId} />
						<input type="hidden" name="reviewed" value={myReview ? '1' : '0'} />
						<input type="hidden" name="return_path" value={returnPath} />
						<Button type="submit" variant={myReview ? 'secondary' : 'outline'} size="sm">
							{myReview ? 'Un-mark reviewed' : 'Mark reviewed'}
						</Button>
					</form>
				)}
			</div>

			{/* Thread */}
			<div className="space-y-2">
				{comments.map((c) => (
					<div key={c.id} className="rounded-md bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
						<div className="flex items-center gap-2 text-2xs text-slate-600 dark:text-slate-400">
							<MessageSquare className="w-3 h-3" />
							<span className="font-medium text-slate-600 dark:text-slate-300">{c.author_name}</span>
							<span>{formatRelative(c.created_at)}</span>
							{c.edited_at && <span title={new Date(c.edited_at).toLocaleString('en-US')}>(edited)</span>}
						</div>
						<p className="text-sm text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">{c.body}</p>
						{c.author_id === viewerId && (
							<details className="mt-1">
								<summary className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 cursor-pointer inline-flex items-center gap-1 transition-colors">
									<Pencil className="w-3 h-3" /> Edit
								</summary>
								<form action={editComment} className="mt-2 flex items-start gap-2">
									<input type="hidden" name="comment_id" value={c.id} />
									<input type="hidden" name="return_path" value={returnPath} />
									<textarea
										name="body"
										defaultValue={c.body}
										required
										maxLength={4000}
										rows={2}
										aria-label="Edit comment"
										className={`${inputClass} flex-1`}
									/>
									<Button type="submit" variant="outline" size="sm">Save</Button>
								</form>
							</details>
						)}
					</div>
				))}
			</div>

			{/* Reply — two-way: the audience writes, including the person. */}
			<form action={addComment} className="flex items-start gap-2">
				<input type="hidden" name="checkin_id" value={checkinId} />
				<input type="hidden" name="return_path" value={returnPath} />
				<textarea
					name="body"
					required
					maxLength={4000}
					rows={2}
					placeholder={comments.length === 0 ? 'Start the conversation…' : 'Reply…'}
					aria-label="Add a comment"
					className={`${inputClass} flex-1`}
				/>
				<Button type="submit" size="sm">Comment</Button>
			</form>
		</div>
	);
}
