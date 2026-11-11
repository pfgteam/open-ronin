// /team/knowledge-base/changes - the review queue (Wikipedia "recent changes").
// ?status=pending|approved|rejected|mine. Default: pending for approvers,
// mine for everyone else.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import FilterChip from '@/components/ui/FilterChip';
import Link from 'next/link';
import { listRevisions, countPendingRevisions, revisionVisibility, personName, WIKI_BASE } from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, canEditWiki, isVisibleTo } from '@/lib/people/permissions';
import { ChevronLeft } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import StatusBadge from '../StatusBadge';

export const dynamic = 'force-dynamic';

type Filter = 'pending' | 'approved' | 'rejected' | 'mine';

interface PageProps {
	searchParams: Promise<{ status?: string }>;
}

export default async function RecentChanges({ searchParams }: PageProps) {
	const { status } = await searchParams;
	const ctx = await loadSensitiveAccessContext();
	const approver = canEditWiki(ctx);
	const filter: Filter = (['pending', 'approved', 'rejected', 'mine'] as const).includes(status as Filter)
		? (status as Filter)
		: approver
			? 'pending'
			: 'mine';

	const [revisionsAll, pendingCount] = await Promise.all([
		filter === 'mine'
			? listRevisions({ authorId: ctx.viewerId ?? undefined, limit: 100 })
			: listRevisions({ status: filter, limit: 100 }),
		countPendingRevisions(),
	]);
	// Space/page visibility is not enforced by RLS on wiki_revisions; filter here
	// so a managers-only space never surfaces in a contributor's queue.
	const revisions = revisionsAll.filter((r) => isVisibleTo(ctx, revisionVisibility(r)));

	const chips: { key: Filter; label: string; count?: number }[] = [
		{ key: 'pending', label: 'Pending review', count: pendingCount },
		{ key: 'approved', label: 'Published' },
		{ key: 'rejected', label: 'Rejected' },
		{ key: 'mine', label: 'My changes' },
	];

	return (
		<>
			<Link href={WIKI_BASE} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Knowledge Base
			</Link>
			<PageHeader
				title="Recent changes"
				description={approver ? 'Proposed edits wait here until you publish or reject them.' : 'Your proposed edits and their review status.'}
			/>

			<div className="flex flex-wrap items-center gap-2 mb-4">
				{chips.map((c) => (
					<Link key={c.key} href={`${WIKI_BASE}/changes?status=${c.key}`}>
						<FilterChip active={filter === c.key} count={c.count}>
							{c.label}
						</FilterChip>
					</Link>
				))}
			</div>

			<Card padding="none">
				{revisions.length === 0 ? (
					<p className="text-sm text-slate-500 text-center py-8">
						{filter === 'pending' ? 'Nothing waiting for review.' : filter === 'mine' ? 'You have not proposed any changes yet.' : 'Nothing here.'}
					</p>
				) : (
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{revisions.map((r) => {
							const spaceName = r.page?.space?.name ?? r.space?.name ?? '';
							return (
								<li key={r.id}>
									<Link href={`${WIKI_BASE}/changes/${r.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-hover transition-colors">
										<StatusBadge status={r.status} />
										<div className="min-w-0 flex-1">
											<div className="text-sm text-slate-900 dark:text-slate-100 truncate">
												{r.title}
												{r.kind === 'create' && (
													<Badge className="text-2xs ml-2">new page</Badge>
												)}
											</div>
											<div className="text-2xs text-slate-600 dark:text-slate-400 truncate">
												{spaceName && `${spaceName} · `}
												{personName(r.author)} · {formatRelative(r.edited_at)}
												{r.reason ? ` · ${r.reason}` : ''}
											</div>
										</div>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</Card>
		</>
	);
}
