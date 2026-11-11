// /team/knowledge-base/[space] - Pages within a space (tree) + Drive playbooks.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSpaceBySlug, listPagesInSpace, listPlaybookLinks, buildPageTree, WIKI_BASE } from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, isVisibleTo } from '@/lib/people/permissions';
import { ChevronLeft, FileText, ExternalLink, Plus } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import PageTree from '../PageTree';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ space: string }>;
}

export default async function SpacePage({ params }: PageProps) {
	const { space: spaceSlug } = await params;
	const [space, ctx] = await Promise.all([getSpaceBySlug(spaceSlug), loadSensitiveAccessContext()]);
	if (!space || !isVisibleTo(ctx, space.visibility)) notFound();

	const [allPages, allPlaybooks] = await Promise.all([listPagesInSpace(space.id), listPlaybookLinks()]);
	const pages = allPages.filter((p) => isVisibleTo(ctx, p.visibility ?? space.visibility));
	const tree = buildPageTree(pages);
	const recent = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

	// Match playbooks to this space by category (case-insensitive contains)
	const relatedPlaybooks = allPlaybooks.filter(
		(p) => p.category && (p.category.toLowerCase() === space.slug || space.name.toLowerCase().includes(p.category.toLowerCase())),
	);

	return (
		<>
			<Link href={WIKI_BASE} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Knowledge Base
			</Link>

			<PageHeader
				title={space.name}
				description={space.description_md ? <span className="block max-w-2xl">{space.description_md}</span> : undefined}
				actions={
					ctx.viewerId ? (
						<Link href={`${WIKI_BASE}/${space.slug}/new`}>
							<Button size="sm">
								<Plus className="w-3 h-3" /> New page
							</Button>
						</Link>
					) : null
				}
			/>

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
				<div className="space-y-4">
					<Card padding="none">
						<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
							<h3 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Pages</h3>
							<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{pages.length}</span>
						</div>
						<div className="p-2">
							{pages.length === 0 ? (
								<p className="text-sm text-slate-500 text-center py-6">
									No pages yet in this space.
									{ctx.viewerId && (
										<>
											{' '}
											<Link href={`${WIKI_BASE}/${space.slug}/new`} className="text-primary-600 hover:underline">
												Propose the first one.
											</Link>
										</>
									)}
								</p>
							) : (
								<PageTree nodes={tree} spaceSlug={space.slug} />
							)}
						</div>
					</Card>
				</div>

				<aside className="space-y-4">
					{recent.length > 0 && (
						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
								<h3 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Recently updated</h3>
							</div>
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{recent.map((p) => (
									<li key={p.id}>
										<Link href={`${WIKI_BASE}/${space.slug}/${p.slug}`} className="flex items-center gap-2 px-3 py-2 hover:bg-hover transition-colors">
											<FileText className="w-3 h-3 text-slate-400 shrink-0" />
											<span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">{p.title}</span>
											<span className="text-2xs text-slate-600 dark:text-slate-400 shrink-0">{formatRelative(p.updated_at)}</span>
										</Link>
									</li>
								))}
							</ul>
						</Card>
					)}

					{relatedPlaybooks.length > 0 && (
						<Card padding="none" className="overflow-hidden">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
								<h3 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Drive playbooks</h3>
							</div>
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{relatedPlaybooks.map((p) => (
									<li key={p.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-hover transition-colors">
										<a href={p.drive_url} target="_blank" rel="noreferrer" className="text-xs text-slate-700 dark:text-slate-300 hover:text-primary-600 inline-flex items-center gap-1.5 truncate transition-colors">
											<FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
											<span className="truncate">{p.title}</span>
											{p.is_canonical && <Badge color="success" className="text-2xs">Canonical</Badge>}
										</a>
										<a href={p.drive_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary-500 transition-colors">
											<ExternalLink className="w-3 h-3" />
										</a>
									</li>
								))}
							</ul>
						</Card>
					)}
				</aside>
			</div>
		</>
	);
}
