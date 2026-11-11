// Activity card for the work-item detail chassis. Server component: fetches
// the four histories (status log, health updates, comments, attachments)
// plus the item's own creation, resolves every actor/author/uploader id to a
// display name, and hands the whole thing to composeActivity
// (@/lib/work/activity.ts) for the actual merge-and-sort — that function is
// pure and unit-tested on its own, this component's only job is the I/O and
// the render.
//
// createdBy/createdAt/parentName come in as props (the page already has
// them from its own item + parent query) rather than being re-fetched here,
// since re-deriving "who created this and where does it live" would just
// duplicate a query the page already ran.

import { createClient } from '@/lib/supabase/server';
import { composeActivity, type ActivityTone } from '@/lib/work/activity';
import { formatRelative } from '@/lib/format';
import Card from '@/components/ui/Card';

interface Props {
	workItemId: string;
	createdAt: string;
	createdBy: string | null;
	parentName: string | null;
}

interface ProfileRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

const nameOf = (p: ProfileRow) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

const DOT: Record<ActivityTone, string> = {
	success: 'bg-green-500',
	primary: 'bg-primary-500',
	default: 'bg-slate-400',
};

export default async function ActivityCard({ workItemId, createdAt, createdBy, parentName }: Props) {
	const supabase = await createClient();

	const [
		{ data: statusLogRows, error: statusLogError },
		{ data: updateRows, error: updateError },
		{ data: commentRows, error: commentError },
		{ data: attachmentRows, error: attachmentError },
	] = await Promise.all([
		supabase
			.from('work_item_status_log')
			.select('from_status, to_status, created_at, actor_id')
			.eq('work_item_id', workItemId)
			.order('created_at', { ascending: false }),
		supabase
			.from('work_item_updates')
			.select('health, created_at, author_id')
			.eq('work_item_id', workItemId)
			.order('created_at', { ascending: false }),
		supabase
			.from('work_item_comments')
			.select('created_at, author_id')
			.eq('work_item_id', workItemId)
			.order('created_at', { ascending: false }),
		supabase
			.from('work_item_attachments')
			.select('file_name, is_deliverable, created_at, uploaded_by')
			.eq('work_item_id', workItemId)
			.order('created_at', { ascending: false }),
	]);

	// Same reasoning as listAttachments: a failed query degrades to a shorter
	// feed, which is visually identical to a quiet item. Log the cause — the
	// attachment query in particular selects is_deliverable (0052), so it fails
	// wholesale until that migration is applied.
	for (const [label, err] of [
		['status log', statusLogError],
		['updates', updateError],
		['comments', commentError],
		['attachments', attachmentError],
	] as const) {
		if (err) console.error(`[ActivityCard] ${label} query failed:`, err.message);
	}

	const statusLog = statusLogRows ?? [];
	const updates = updateRows ?? [];
	const comments = commentRows ?? [];
	const attachments = attachmentRows ?? [];

	const ids = new Set<string>();
	for (const s of statusLog) if (s.actor_id) ids.add(s.actor_id);
	for (const u of updates) if (u.author_id) ids.add(u.author_id);
	for (const c of comments) if (c.author_id) ids.add(c.author_id);
	for (const a of attachments) if (a.uploaded_by) ids.add(a.uploaded_by);
	if (createdBy) ids.add(createdBy);

	const { data: profileRows } = ids.size > 0
		? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', [...ids])
		: { data: [] as ProfileRow[] };
	const profileById = new Map((profileRows ?? []).map((p) => [p.id, p as ProfileRow]));
	const nameById = (id: string | null): string | null => (id ? (profileById.get(id) ? nameOf(profileById.get(id)!) : null) : null);

	const entries = composeActivity({
		createdAt,
		createdByName: nameById(createdBy),
		parentName,
		statusLog: statusLog.map((s) => ({
			from_status: s.from_status,
			to_status: s.to_status,
			created_at: s.created_at,
			actorName: nameById(s.actor_id),
		})),
		updates: updates.map((u) => ({
			health: u.health,
			created_at: u.created_at,
			authorName: nameById(u.author_id),
		})),
		comments: comments.map((c) => ({
			created_at: c.created_at,
			authorName: nameById(c.author_id),
		})),
		attachments: attachments.map((a) => ({
			file_name: a.file_name,
			is_deliverable: a.is_deliverable,
			created_at: a.created_at,
			uploaderName: nameById(a.uploaded_by),
		})),
	});

	return (
		<Card>
			<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-2">Activity</div>
			<ul className="space-y-2.5">
				{entries.map((e, i) => (
					<li key={`${e.at}-${i}`} className="flex items-start gap-2.5">
						<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[e.tone]}`} />
						<div className="min-w-0 flex-1">
							<p className="text-sm text-slate-700 dark:text-slate-300">{e.text}</p>
							<span className="text-2xs text-slate-600 dark:text-slate-400">{formatRelative(e.at)}</span>
						</div>
					</li>
				))}
			</ul>
		</Card>
	);
}
