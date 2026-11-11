// /the-work/[id] — one work item, full page.
//
// The item drawer and this page are THE SAME component in two sizes
// (rework 5.3): every planning field for the kind is edited inline
// (WorkItemPanel → ItemFields), so the old "All fields" modal (?edit=1) is
// gone. Updates (health + comments), children, files and activity are tabs;
// archive / restore / delete sit in "⋯"; the type changes from the header.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import BackButton from '../BackButton';
import ArchivedBanner from './ArchivedBanner';
import ItemPage from './ItemPage';
import { loadBoardContext } from '@/lib/work/boards/load';
import { hubHref, hubTabForKind, CLIENT_TABS } from '@/lib/work/hub/tabs';
import type { WorkRow } from '@/lib/work/boards/types';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_KINDS = new Set(['client_work', 'assignment', 'strategy', 'client_goal', 'target', 'campaign', 'twelve_week_plan']);

export default async function WorkItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	// Legacy redirects can land non-uuid tails here (e.g. /the-work/new);
	// guard before querying so Postgres never sees an invalid uuid.
	if (!UUID_RE.test(id)) notFound();
	const supabase = await createClient();
	const { data: item } = await supabase.from('projects').select('*').eq('id', id).single();
	if (!item) notFound();
	const ctx = await loadBoardContext([item as unknown as WorkRow], []);

	const tab = hubTabForKind(item.kind as string);
	const clientTab = CLIENT_KINDS.has(item.kind as string) ? CLIENT_TABS.find((t) => t.kinds.includes(item.kind as string)) ?? CLIENT_TABS[0] : undefined;
	const boardHref = tab ? hubHref(tab) : clientTab ? hubHref(clientTab) : '/the-work';
	const listLabel = tab?.label ?? (clientTab ? 'Client Work' : 'The Work');

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
				<BackButton fallbackHref={boardHref} />
				<Link href={boardHref} className="hover:text-primary-600 hover:underline">{listLabel}</Link>
				<ChevronRight className="h-3 w-3" aria-hidden="true" />
				<span className="truncate text-slate-700 dark:text-slate-300">{item.name}</span>
			</div>
			{item.archived && <ArchivedBanner itemId={item.id} boardHref={boardHref} />}
			{/* key: an archive or a restore refreshes this server page; the panel
			    keeps its own state, so re-mount it whenever the row changed. */}
			<ItemPage key={`${item.updated_at}:${item.archived}`} itemId={item.id} ctx={ctx} today={new Date().toISOString().slice(0, 10)} boardHref={boardHref} />
		</div>
	);
}
