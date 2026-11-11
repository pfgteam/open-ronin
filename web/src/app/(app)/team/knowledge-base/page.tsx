// /team/knowledge-base - Wiki home.
// Spaces grid, search (?q=), recent updates, pending-review count, Drive playbooks.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { listSpaces, listPlaybookLinks, searchPages, listRevisions, countPendingRevisions, revisionVisibility, personName, WIKI_BASE } from '@/lib/wiki/_lib';
import { loadSensitiveAccessContext, isVisibleTo, canEditWiki } from '@/lib/people/permissions';
import { BookOpen, ExternalLink, FileText, ListChecks, Clock } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import WikiSearch from './WikiSearch';

export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ q?: string }>;
}

export default async function KnowledgeBaseHome({ searchParams }: PageProps) {
	const { q } = await searchParams;
	const query = (q ?? '').trim();
	const [spaces, playbooks, ctx, hits, recentAll, pendingCount] = await Promise.all([
		listSpaces(),
		listPlaybookLinks(),
		loadSensitiveAccessContext(),
		query ? searchPages(query) : Promise.resolve([]),
		listRevisions({ status: 'approved', limit: 24 }),
		countPendingRevisions(),
	]);

	const visibleSpaces = spaces.filter((s) => isVisibleTo(ctx, s.visibility));
	const visibleHits = hits.filter((h) => isVisibleTo(ctx, h.space.visibility));
	const recent = recentAll.filter((r) => isVisibleTo(ctx, revisionVisibility(r))).slice(0, 8);
	const approver = canEditWiki(ctx);

	const playbooksByCategory = playbooks.reduce<Record<string, typeof playbooks>>((acc, p) => {
		const k = p.category ?? 'Other';
		(acc[k] ??= []).push(p);
		return acc;
	}, {});

	return (
		<>
			<div className="flex items-start justify-between gap-4 mb-6">
				<div>
					<div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
						<BookOpen className="w-3.5 h-3.5" /> Knowledge Base
					</div>
					<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Open Ronin Wiki</h1>
					<p className="text-sm text-slate-500 mt-1">
						Playbooks and how we work. Anyone can propose an edit; approvers publish.
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<WikiSearch initial={query} />
					<Link href={`${WIKI_BASE}/changes`}>
						<Button variant={pendingCount > 0 && approver ? 'primary' : 'outline'} size="sm">
							<ListChecks className="w-3.5 h-3.5" />
							{approver ? 'Review' : 'Changes'}
							{pendingCount > 0 && <span className="ml-1.5 tabular-nums opacity-80">{pendingCount}</span>}
						</Button>
					</Link>
				</div>
			</div>

			{query && (
				<Card padding="none" className="mb-6">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<h2 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
							Results for &ldquo;{query}&rdquo;
						</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{visibleHits.length}</span>
					</div>
					{visibleHits.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-6">No articles match.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{visibleHits.map((h) => (
								<li key={h.id}>
									<Link href={`${WIKI_BASE}/${h.space.slug}/${h.slug}`} className="block px-3 py-2 hover:bg-hover transition-colors">
										<div className="flex items-center gap-2">
											<span className="text-sm text-slate-900 dark:text-slate-100">{h.title}</span>
											<span className="text-2xs text-slate-600 dark:text-slate-400">{h.space.name}</span>
										</div>
										{h.snippet && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{h.snippet}</p>}
									</Link>
								</li>
							))}
						</ul>
					)}
				</Card>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4 mb-6">
				<div>
					<h2 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-2">Spaces</h2>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{visibleSpaces.map((space) => (
							<Link key={space.id} href={`${WIKI_BASE}/${space.slug}`}>
								<Card className="hover:border-primary-400 dark:hover:border-primary-700 transition-colors h-full">
									<div className="flex items-start gap-3">
										<div className="w-9 h-9 rounded-md bg-primary-50 dark:bg-primary-950/30 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0">
											<BookOpen className="w-4 h-4" />
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{space.name}</h3>
												{space.visibility !== 'public' && space.visibility !== 'team' && (
													<Badge color="warning" className="text-2xs">{space.visibility}</Badge>
												)}
											</div>
											<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{space.description_md ?? '—'}</p>
										</div>
									</div>
								</Card>
							</Link>
						))}
					</div>
				</div>

				<aside>
					<h2 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1.5">
						<Clock className="w-3 h-3" /> Recently published
					</h2>
					<Card padding="none">
						{recent.length === 0 ? (
							<p className="text-sm text-slate-500 text-center py-6">Nothing published yet.</p>
						) : (
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{recent.map((r) => {
									const href = r.page?.space ? `${WIKI_BASE}/${r.page.space.slug}/${r.page.slug}` : `${WIKI_BASE}/changes/${r.id}`;
									return (
										<li key={r.id}>
											<Link href={href} className="block px-3 py-2 hover:bg-hover transition-colors">
												<div className="text-xs text-slate-900 dark:text-slate-100 truncate">{r.page?.title ?? r.title}</div>
												<div className="text-2xs text-slate-600 dark:text-slate-400 truncate">
													{r.page?.space?.name ? `${r.page.space.name} · ` : ''}
													{personName(r.author)} · {formatRelative(r.reviewed_at ?? r.edited_at)}
												</div>
											</Link>
										</li>
									);
								})}
							</ul>
						)}
					</Card>
				</aside>
			</div>

			{/* Playbook quick links - by category */}
			<h2 className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-2">Playbooks (Drive)</h2>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
				{Object.keys(playbooksByCategory).sort().map((category) => (
					<Card key={category} padding="none">
						<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{category}</h3>
						</div>
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{playbooksByCategory[category].map((p) => (
								<li key={p.id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-hover transition-colors">
									<a
										href={p.drive_url}
										target="_blank"
										rel="noreferrer"
										className="text-sm text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 inline-flex items-center gap-1.5 truncate transition-colors"
									>
										<FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
										<span className="truncate">{p.title}</span>
										{p.is_canonical && <Badge color="success" className="text-2xs shrink-0">Canonical</Badge>}
									</a>
									<a href={p.drive_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary-500 shrink-0 transition-colors">
										<ExternalLink className="w-3 h-3" />
									</a>
								</li>
							))}
						</ul>
					</Card>
				))}
			</div>

			{playbooks.length === 0 && (
				<Card>
					<p className="text-sm text-slate-500 text-center py-6">
						Playbook links haven&apos;t been set up yet. Ask Ops to add them.
					</p>
				</Card>
			)}
		</>
	);
}
