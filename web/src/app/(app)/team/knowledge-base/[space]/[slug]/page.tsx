// /team/knowledge-base/[space]/[slug] - Wiki article.
// Live (approved) content, rendered with WikiMarkdown. Sidebar: page tree of
// the space, pending changes on this article, history, what links here.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
	getPage,
	getSpaceBySlug,
	listPageRefs,
	listPagesInSpace,
	listRevisions,
	listPendingForPage,
	listBacklinks,
	buildPageTree,
	personName,
	WIKI_BASE,
} from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, canEditWiki, isVisibleTo } from '@/lib/people/permissions';
import { ChevronLeft, ExternalLink, Pencil, History, Link2, Clock } from 'lucide-react';
import { formatDate, formatRelative } from '@/lib/format';
import WikiMarkdown from '../../WikiMarkdown';
import PageTree from '../../PageTree';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ space: string; slug: string }>;
}

export default async function WikiPageDetail({ params }: PageProps) {
	const { space: spaceSlug, slug } = await params;
	const [space, page, ctx] = await Promise.all([getSpaceBySlug(spaceSlug), getPage(spaceSlug, slug), loadSensitiveAccessContext()]);
	if (!space || !page) notFound();
	if (!isVisibleTo(ctx, page.visibility ?? space.visibility)) notFound();

	const [refs, siblings, history, pending, backlinksAll] = await Promise.all([
		listPageRefs(),
		listPagesInSpace(space.id),
		listRevisions({ status: 'approved', pageId: page.id, limit: 8 }),
		listPendingForPage(page.id),
		listBacklinks({ slug: page.slug, title: page.title }),
	]);
	const backlinks = backlinksAll.filter((b) => isVisibleTo(ctx, b.visibility ?? b.space.visibility));
	const tree = buildPageTree(siblings.filter((p) => isVisibleTo(ctx, p.visibility ?? space.visibility)));
	const approver = canEditWiki(ctx);
	const href = `${WIKI_BASE}/${space.slug}/${page.slug}`;
	const lastRev = history[0];

	return (
		<>
			<Link href={`${WIKI_BASE}/${spaceSlug}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> {space.name}
			</Link>

			<PageHeader
				title={page.title}
				description={
					<span className="flex flex-wrap items-center gap-2 text-2xs text-slate-600 dark:text-slate-400">
						<span>
							Updated {formatRelative(page.updated_at)}
							{lastRev?.author ? ` by ${personName(lastRev.author)}` : ''}
						</span>
						{page.drive_file_id && (
							<>
								<span>·</span>
								<a href={page.drive_file_url ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
									<ExternalLink className="w-3 h-3" /> Source doc in Drive
								</a>
								{page.drive_last_synced_at && (
									<>
										<span>·</span>
										<span>synced {formatDate(page.drive_last_synced_at)}</span>
									</>
								)}
							</>
						)}
					</span>
				}
				actions={
					ctx.viewerId ? (
						<>
							<Link href={`${href}/history`}>
								<Button variant="outline" size="sm">
									<History className="w-3 h-3" /> History
								</Button>
							</Link>
							<Link href={`${href}/edit`}>
								<Button size="sm">
									<Pencil className="w-3 h-3" /> Edit
								</Button>
							</Link>
						</>
					) : null
				}
			/>

			{pending.length > 0 && (
				<Callout tone="warning" className="mb-4">
					<span className="font-medium">{pending.length === 1 ? '1 pending change' : `${pending.length} pending changes`}</span> to this article
					{approver ? ' awaiting your review: ' : ': '}
					{pending.map((r, i) => (
						<span key={r.id}>
							{i > 0 && ', '}
							<Link href={`${WIKI_BASE}/changes/${r.id}`} className="underline">
								{personName(r.author)} · {formatRelative(r.edited_at)}
							</Link>
						</span>
					))}
					.
				</Callout>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_16rem] gap-4">
				<Card>
					{page.body_md && page.body_md.trim() ? (
						<WikiMarkdown source={page.body_md} currentSpace={space.slug} pages={refs} />
					) : (
						<div className="text-center py-8">
							<p className="text-sm text-slate-400">This article is empty.</p>
							{ctx.viewerId && (
								<Link href={`${href}/edit`} className="inline-flex items-center gap-1 mt-3 text-primary-600 hover:underline text-sm">
									<Pencil className="w-3.5 h-3.5" /> Write it
								</Link>
							)}
						</div>
					)}
				</Card>

				<aside className="space-y-4">
					<Card padding="none">
						<SidebarHeading>In {space.name}</SidebarHeading>
						<div className="p-2">
							<PageTree nodes={tree} spaceSlug={space.slug} currentSlug={page.slug} />
						</div>
					</Card>

					<Card padding="none">
						<SidebarHeading icon={<Clock className="w-3 h-3" />}>History</SidebarHeading>
						{history.length === 0 ? (
							<p className="px-3 py-2 text-xs text-slate-400">No revisions recorded.</p>
						) : (
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{history.slice(0, 5).map((r) => (
									<li key={r.id}>
										<Link href={`${WIKI_BASE}/changes/${r.id}`} className="block px-3 py-2 hover:bg-hover transition-colors">
											<div className="text-xs text-slate-700 dark:text-slate-300 truncate">{r.reason || (r.kind === 'create' ? 'Page created' : 'Edited')}</div>
											<div className="text-2xs text-slate-600 dark:text-slate-400">
												{personName(r.author)} · {formatRelative(r.reviewed_at ?? r.edited_at)}
											</div>
										</Link>
									</li>
								))}
							</ul>
						)}
						{history.length > 5 && (
							<Link href={`${href}/history`} className="block px-3 py-2 text-2xs text-primary-600 hover:underline border-t border-slate-200 dark:border-slate-700">
								Full history
							</Link>
						)}
					</Card>

					<Card padding="none">
						<SidebarHeading icon={<Link2 className="w-3 h-3" />}>What links here</SidebarHeading>
						{backlinks.length === 0 ? (
							<p className="px-3 py-2 text-xs text-slate-400">Nothing links to this article yet.</p>
						) : (
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{backlinks.map((b) => (
									<li key={b.id}>
										<Link href={`${WIKI_BASE}/${b.space.slug}/${b.slug}`} className="block px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-hover transition-colors">
											<span className="truncate block">{b.title}</span>
											{b.space.slug !== space.slug && <span className="text-2xs text-slate-600 dark:text-slate-400">{b.space.name}</span>}
										</Link>
									</li>
								))}
							</ul>
						)}
					</Card>

					{page.visibility && page.visibility !== 'team' && page.visibility !== 'public' && (
						<Badge color="warning" className="text-2xs">
							{page.visibility} only
						</Badge>
					)}
				</aside>
			</div>
		</>
	);
}

function SidebarHeading({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
	return (
		<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
			{icon}
			{children}
		</div>
	);
}
