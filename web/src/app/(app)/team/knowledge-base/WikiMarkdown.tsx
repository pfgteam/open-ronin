// The one markdown renderer for wiki articles. GFM (tables, task lists,
// strikethrough) plus [[wikilinks]]; raw HTML is never rendered (react-
// markdown escapes it by default). No 'use client' so server pages render it
// directly, and the editor preview can import it from a client component
// because every prop is serializable.

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { clsx } from 'clsx';
import { remarkWikilinks, type WikiPageRef } from '@/lib/wiki/wikilinks';

interface Props {
	source: string;
	currentSpace: string;
	pages: readonly WikiPageRef[];
	className?: string;
}

export default function WikiMarkdown({ source, currentSpace, pages, className }: Props) {
	const components: Components = {
		a: ({ href, children, title, ...rest }) => {
			const kind = (rest as Record<string, unknown>)['data-wikilink'];
			const isMissing = kind === 'missing';
			const internal = typeof href === 'string' && href.startsWith('/');
			const cls = clsx(
				'underline decoration-1 underline-offset-2 transition-colors',
				isMissing
					? 'text-red-600 dark:text-red-400 decoration-dotted hover:text-red-700'
					: 'text-primary-600 dark:text-primary-400 hover:text-primary-700',
			);
			if (internal) {
				return (
					<Link href={href} className={cls} title={title}>
						{children}
					</Link>
				);
			}
			return (
				<a href={href} className={cls} target="_blank" rel="noreferrer" title={title}>
					{children}
				</a>
			);
		},
	};

	return (
		<article className={clsx('prose prose-sm prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:no-underline', className)}>
			<Markdown remarkPlugins={[remarkGfm, [remarkWikilinks, { currentSpace, pages }]]} components={components}>
				{source}
			</Markdown>
		</article>
	);
}
