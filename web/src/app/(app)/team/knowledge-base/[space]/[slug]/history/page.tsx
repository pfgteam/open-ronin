// /team/knowledge-base/[space]/[slug]/history - every decided revision of a page.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPage, getSpaceBySlug, listRevisions, personName, WIKI_BASE } from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, isVisibleTo } from '@/lib/people/permissions';
import { ChevronLeft } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import StatusBadge from '../../../StatusBadge';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ space: string; slug: string }>;
}

export default async function WikiPageHistory({ params }: PageProps) {
	const { space: spaceSlug, slug } = await params;
	const [space, page, ctx] = await Promise.all([getSpaceBySlug(spaceSlug), getPage(spaceSlug, slug), loadSensitiveAccessContext()]);
	if (!space || !page) notFound();
	if (!isVisibleTo(ctx, page.visibility ?? space.visibility)) notFound();

	const revisions = await listRevisions({ pageId: page.id, limit: 200 });
	const href = `${WIKI_BASE}/${space.slug}/${page.slug}`;

	return (
		<>
			<Link href={href} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> {page.title}
			</Link>
			<PageHeader title="History" description={`${revisions.length} revision${revisions.length === 1 ? '' : 's'} of ${page.title}`} />

			<Card padding="none">
				{revisions.length === 0 ? (
					<p className="text-sm text-slate-500 text-center py-6">No revisions recorded.</p>
				) : (
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{revisions.map((r) => (
							<li key={r.id}>
								<Link href={`${WIKI_BASE}/changes/${r.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-hover transition-colors">
									<StatusBadge status={r.status} />
									<div className="min-w-0 flex-1">
										<div className="text-sm text-slate-900 dark:text-slate-100 truncate">{r.reason || (r.kind === 'create' ? 'Page created' : 'Edited')}</div>
										<div className="text-2xs text-slate-600 dark:text-slate-400">
											{personName(r.author)} · {formatRelative(r.edited_at)}
											{r.reviewer && r.status !== 'pending' ? ` · ${r.status} by ${personName(r.reviewer)}` : ''}
										</div>
									</div>
									{r.kind === 'create' && <Badge className="text-2xs">new page</Badge>}
								</Link>
							</li>
						))}
					</ul>
				)}
			</Card>
		</>
	);
}
