// /team/knowledge-base/[space]/new - propose a new page in this space.
// Any active signed-in user may propose; it publishes only after review.
// `new` is a static segment, so it wins over [slug] in Next's router.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { ChevronLeft } from 'lucide-react';
import { getSpaceBySlug, listPagesInSpace, listPageRefs, WIKI_BASE } from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, isVisibleTo } from '@/lib/people/permissions';
import WikiEditor from '../../WikiEditor';
import { proposeNewPage } from '../../actions';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ space: string }>;
	searchParams: Promise<{ title?: string }>;
}

export default async function NewWikiPage({ params, searchParams }: PageProps) {
	const [{ space: spaceSlug }, { title }] = await Promise.all([params, searchParams]);
	const [space, ctx] = await Promise.all([getSpaceBySlug(spaceSlug), loadSensitiveAccessContext()]);
	if (!space || !isVisibleTo(ctx, space.visibility)) notFound();
	if (!ctx.viewerId) notFound();

	const [pages, refs] = await Promise.all([listPagesInSpace(space.id), listPageRefs()]);
	const initialTitle = (title ?? '').trim().slice(0, 160);

	return (
		<>
			<Link href={`${WIKI_BASE}/${space.slug}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> {space.name}
			</Link>
			<PageHeader title="New page" description={`Proposed in ${space.name}. It goes live once a wiki approver publishes it.`} />
			<WikiEditor
				mode="create"
				spaceSlug={space.slug}
				spaceId={space.id}
				initialTitle={initialTitle}
				initialBody={initialTitle ? `# ${initialTitle}\n\n` : ''}
				parentOptions={pages.map((p) => ({ id: p.id, title: p.title }))}
				pages={refs}
				cancelHref={`${WIKI_BASE}/${space.slug}`}
				action={proposeNewPage}
			/>
		</>
	);
}
