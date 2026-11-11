// /team/knowledge-base/[space]/[slug]/edit - propose an edit to a page.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import { ChevronLeft } from 'lucide-react';
import { getPage, getSpaceBySlug, listPageRefs, listPendingForPage, personName, WIKI_BASE } from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, isVisibleTo } from '@/lib/people/permissions';
import { formatRelative } from '@/lib/format';
import WikiEditor from '../../../WikiEditor';
import { proposeEdit } from '../../../actions';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ space: string; slug: string }>;
}

export default async function EditWikiPage({ params }: PageProps) {
	const { space: spaceSlug, slug } = await params;
	const [space, page, ctx] = await Promise.all([getSpaceBySlug(spaceSlug), getPage(spaceSlug, slug), loadSensitiveAccessContext()]);
	if (!space || !page || !ctx.viewerId) notFound();
	if (!isVisibleTo(ctx, page.visibility ?? space.visibility)) notFound();

	const [refs, pending] = await Promise.all([listPageRefs(), listPendingForPage(page.id)]);
	const href = `${WIKI_BASE}/${space.slug}/${page.slug}`;

	return (
		<>
			<Link href={href} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> {page.title}
			</Link>
			<PageHeader title={`Editing: ${page.title}`} description={`${space.name}. Your change goes live once a wiki approver publishes it.`} />
			{pending.length > 0 && (
				<Callout tone="warning" className="mb-4">
					{pending.length === 1 ? 'There is already a pending change to this page' : `There are ${pending.length} pending changes to this page`} (
					{pending.map((r, i) => (
						<span key={r.id}>
							{i > 0 && ', '}
							<Link href={`${WIKI_BASE}/changes/${r.id}`} className="underline">
								{personName(r.author)}, {formatRelative(r.edited_at)}
							</Link>
						</span>
					))}
					). You are editing the live version; overlapping edits are resolved by the approver.
				</Callout>
			)}
			<WikiEditor
				mode="edit"
				spaceSlug={space.slug}
				pageId={page.id}
				initialTitle={page.title}
				initialBody={page.body_md ?? ''}
				pages={refs}
				cancelHref={href}
				action={proposeEdit}
			/>
		</>
	);
}
