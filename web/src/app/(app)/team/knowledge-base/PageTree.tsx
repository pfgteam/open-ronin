// Nested page list for a space (parent_page_id tree). Server component.

import Link from 'next/link';
import { clsx } from 'clsx';
import { FileText } from 'lucide-react';
import type { PageNode } from '@/lib/wiki/_lib';
import { WIKI_BASE } from '@/lib/wiki/_lib';

interface Props {
	nodes: PageNode[];
	spaceSlug: string;
	currentSlug?: string;
	depth?: number;
}

export default function PageTree({ nodes, spaceSlug, currentSlug, depth = 0 }: Props) {
	if (nodes.length === 0) {
		return depth === 0 ? <p className="px-1 py-1 text-xs text-slate-400">No pages yet.</p> : null;
	}
	return (
		<ul className={clsx('space-y-0.5', depth > 0 && 'ml-3 border-l border-slate-200 dark:border-slate-700 pl-2')}>
			{nodes.map((n) => {
				const active = n.page.slug === currentSlug;
				return (
					<li key={n.page.id}>
						<Link
							href={`${WIKI_BASE}/${spaceSlug}/${n.page.slug}`}
							className={clsx(
								'flex items-center gap-1.5 px-1.5 py-1 rounded-md text-xs transition-colors',
								active
									? 'bg-selected text-primary-700 dark:text-primary-400 font-medium'
									: 'text-slate-700 dark:text-slate-300 hover:bg-hover',
							)}
							aria-current={active ? 'page' : undefined}
						>
							<FileText className="w-3 h-3 text-slate-400 shrink-0" />
							<span className="truncate">{n.page.title}</span>
						</Link>
						{n.children.length > 0 && <PageTree nodes={n.children} spaceSlug={spaceSlug} currentSlug={currentSlug} depth={depth + 1} />}
					</li>
				);
			})}
		</ul>
	);
}
