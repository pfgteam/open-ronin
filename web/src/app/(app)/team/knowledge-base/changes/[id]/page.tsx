// /team/knowledge-base/changes/[id] - one proposed change: diff against the
// live page, rendered preview, and the approver's publish / reject controls.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { clsx } from 'clsx';
import { getRevision, getPageById, listPageRefs, revisionVisibility, personName, WIKI_BASE } from '@/lib/wiki/_lib';
import { diffLines, diffStats } from '@/lib/wiki/diff';
import { loadSensitiveAccessContext, canEditWiki, isVisibleTo } from '@/lib/people/permissions';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import StatusBadge from '../../StatusBadge';
import WikiMarkdown from '../../WikiMarkdown';
import ReviewControls from './ReviewControls';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
}

export default async function ChangeDetail({ params }: PageProps) {
	const { id } = await params;
	if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
	const [rev, ctx] = await Promise.all([getRevision(id), loadSensitiveAccessContext()]);
	if (!rev || !ctx.viewerId) notFound();
	// The full proposed body renders below; a viewer who cannot see the target
	// space must not see it here either. Authors of a pending revision were
	// viewers of the space when they wrote it, so no author special case.
	if (!isVisibleTo(ctx, revisionVisibility(rev))) notFound();

	const approver = canEditWiki(ctx);
	const isAuthor = rev.edited_by === ctx.viewerId;
	const live = rev.page_id ? await getPageById(rev.page_id) : null;
	const refs = await listPageRefs();

	const spaceSlug = rev.page?.space?.slug ?? rev.space?.slug ?? 'overview';
	const spaceName = rev.page?.space?.name ?? rev.space?.name ?? '';
	const liveHref = live && rev.page?.space ? `${WIKI_BASE}/${rev.page.space.slug}/${live.slug}` : null;

	// For a pending edit, diff against the CURRENT live page (what publishing
	// would overwrite). For a decided revision, diff against the previous
	// approved revision is what Wikipedia shows; we show against the page as
	// it is now, which is the honest, cheap answer until history diffs matter.
	const before = rev.kind === 'create' ? '' : (live?.body_md ?? '');
	const after = rev.body_md ?? '';
	const ops = diffLines(before, after);
	const stats = diffStats(ops);
	const titleChanged = live ? live.title !== rev.title : false;

	return (
		<>
			<Link href={`${WIKI_BASE}/changes`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Recent changes
			</Link>

			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<StatusBadge status={rev.status} />
						{rev.kind === 'create' ? 'New page: ' : 'Edit: '}
						{rev.title}
					</span>
				}
				description={
					<span className="flex flex-wrap items-center gap-2">
						<span>
							{spaceName && `${spaceName} · `}
							proposed by {personName(rev.author)} {formatRelative(rev.edited_at)}
						</span>
						{rev.status !== 'pending' && rev.reviewer && (
							<span>
								· {rev.status === 'approved' ? 'published' : 'rejected'} by {personName(rev.reviewer)} {formatRelative(rev.reviewed_at)}
							</span>
						)}
						{liveHref && (
							<Link href={liveHref} className="inline-flex items-center gap-1 text-primary-600 hover:underline">
								<ExternalLink className="w-3 h-3" /> Live page
							</Link>
						)}
					</span>
				}
			/>

			{rev.reason && (
				<Callout tone="info" className="mb-4">
					<span className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 block">Change summary</span>
					{rev.reason}
				</Callout>
			)}
			{rev.status !== 'pending' && rev.review_note && (
				<Callout tone={rev.status === 'approved' ? 'success' : 'warning'} className="mb-4">
					<span className="text-2xs uppercase tracking-wide block opacity-70">Reviewer note</span>
					{rev.review_note}
				</Callout>
			)}

			{rev.status === 'pending' && (
				<ReviewControls revisionId={rev.id} approver={approver} isAuthor={isAuthor} kind={rev.kind} className="mb-4" />
			)}

			<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<h3 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
							{rev.kind === 'create' ? 'Proposed content' : 'Changes vs. live page'}
						</h3>
						<span className="text-2xs tabular-nums">
							<span className="text-green-600 dark:text-green-400">+{stats.added}</span>{' '}
							<span className="text-red-600 dark:text-red-400">−{stats.removed}</span>
						</span>
					</div>
					{titleChanged && live && (
						<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-xs">
							<span className="text-slate-400">Title:</span>{' '}
							<span className="line-through text-red-600 dark:text-red-400">{live.title}</span>{' '}
							<span className="text-green-700 dark:text-green-400">{rev.title}</span>
						</div>
					)}
					<pre className="text-xs font-mono leading-5 overflow-x-auto max-h-[40rem] p-0 m-0">
						{ops.map((op, i) => (
							<div
								key={i}
								className={clsx(
									'px-3 whitespace-pre-wrap break-words',
									op.kind === 'add' && 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300',
									op.kind === 'del' && 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 line-through decoration-red-300/60',
									op.kind === 'same' && 'text-slate-500 dark:text-slate-400',
								)}
							>
								<span className="select-none inline-block w-4 text-slate-300 dark:text-slate-600">{op.kind === 'add' ? '+' : op.kind === 'del' ? '−' : ' '}</span>
								{op.text || ' '}
							</div>
						))}
					</pre>
				</Card>

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
						<h3 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Preview</h3>
						{rev.kind === 'create' && rev.slug && (
							<Badge className="text-2xs font-mono">/{spaceSlug}/{rev.slug}</Badge>
						)}
					</div>
					<div className="p-4 max-h-[40rem] overflow-y-auto">
						{after.trim() ? (
							<WikiMarkdown source={after} currentSpace={spaceSlug} pages={refs} />
						) : (
							<p className="text-sm text-slate-400">Empty body.</p>
						)}
					</div>
				</Card>
			</div>
		</>
	);
}
