// Followers card for the work-item detail chassis (migration 0052). Server
// component, self-fetches its own follower list by workItemId (same
// self-contained idiom as CommentsPanel/AttachmentsPanel). The viewer's own
// follow state is derived from `viewerId` (passed by the page — it already
// knows who's signed in via auth.getUser(), no reason for this card to make
// its own auth round-trip). Follow/unfollow posts through an inline server
// action wrapping toggleFollow (../social.ts); no client JS required.
//
// Followers get notified on status change, comment, and deliverable — see
// notifyWorkItemComment/notifyWorkItemDeliverable in social.ts and the
// projects_log_status_change trigger's downstream notifier (Task elsewhere
// in this plan). This card is just the read/write surface for membership.

import { createClient } from '@/lib/supabase/server';
import Card from '@/components/ui/Card';
import { toggleFollow } from '../social';

interface Props {
	workItemId: string;
	viewerId: string | null;
}

interface ProfileRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

const nameOf = (p: ProfileRow) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export default async function FollowersCard({ workItemId, viewerId }: Props) {
	const supabase = await createClient();

	// A failed query degrades to "nobody follows this", which is visually
	// identical to a genuinely unfollowed item — so log the cause (same
	// treatment as ActivityCard and attachments-actions). The return contract is
	// unchanged: still an empty list, never a thrown page.
	const { data: followerRows, error: followersError } = await supabase
		.from('work_item_followers')
		.select('user_id, created_at')
		.eq('work_item_id', workItemId)
		.order('created_at', { ascending: true });
	if (followersError) console.error('[FollowersCard] followers query failed:', followersError.message);

	const followers = followerRows ?? [];
	const followerIds = followers.map((f) => f.user_id);

	const { data: profileRows, error: profilesError } = followerIds.length > 0
		? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', followerIds)
		: { data: [] as ProfileRow[], error: null };
	if (profilesError) console.error('[FollowersCard] follower profiles query failed:', profilesError.message);
	const profileById = new Map((profileRows ?? []).map((p) => [p.id, p as ProfileRow]));

	const isFollowing = !!viewerId && followerIds.includes(viewerId);

	async function follow() {
		'use server';
		await toggleFollow(workItemId, true);
	}
	async function unfollow() {
		'use server';
		await toggleFollow(workItemId, false);
	}

	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">
					Followers {followers.length > 0 && `(${followers.length})`}
				</div>
				{viewerId && (
					<form action={isFollowing ? unfollow : follow}>
						<button
							type="submit"
							className={`text-2xs font-medium px-2 py-0.5 rounded-md border transition-colors ${
								isFollowing
									? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600'
									: 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-400 border-primary-200 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-950/50'
							}`}
						>
							{isFollowing ? 'Following' : 'Follow'}
						</button>
					</form>
				)}
			</div>

			{followers.length === 0 ? (
				<p className="text-xs text-slate-400">No followers yet.</p>
			) : (
				<div className="flex items-center flex-wrap gap-1.5">
					{followers.map((f) => {
						const profile = profileById.get(f.user_id) ?? null;
						const name = profile ? nameOf(profile) : 'Unknown';
						return (
							<span
								key={f.user_id}
								title={name}
								className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-2xs font-medium flex items-center justify-center shrink-0"
							>
								{initialsOf(name)}
							</span>
						);
					})}
				</div>
			)}
		</Card>
	);
}
