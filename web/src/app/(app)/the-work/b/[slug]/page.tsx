// /the-work/b/[slug] — a custom board on the hub's list screen (rework 5.1:
// tabs and custom boards are one mechanism). The old system boards the hub
// replaced (goals-priorities, recurring-processes, projects, tasks, …)
// redirect to their hub tab with every filter intact.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import { loadBoard } from '@/lib/work/boards/load';
import { LEGACY_BOARD_TO_TAB, hubTab, hubHref } from '@/lib/work/hub/tabs';
import { hubQueryString, parseHubState } from '@/lib/work/hub/state';
import HubPage, { type HubSearchParams } from '../../_hub/HubPage';

export const dynamic = 'force-dynamic';

interface Props {
	params: Promise<{ slug: string }>;
	searchParams: HubSearchParams;
}

export async function generateMetadata({ params }: Props) {
	const { slug } = await params;
	const loaded = await loadBoard(slug);
	return { title: loaded?.board.name ?? 'Board' };
}

const QUEUE_PAGES: Record<string, string> = {
	staff_requests: '/the-work/innovation-desk',
	content_requests: '/the-work/content-requests',
	acquisition_targets: '/the-work/acquisitions',
};

export default async function BoardPage({ params, searchParams }: Props) {
	const { slug } = await params;
	const tabKey = LEGACY_BOARD_TO_TAB[slug];
	if (tabKey) {
		const tab = hubTab(tabKey)!;
		redirect(`${hubHref(tab)}${hubQueryString(parseHubState(await searchParams))}`);
	}
	const loaded = await loadBoard(slug);
	if (loaded && loaded.board.source !== 'work_items') {
		// Queue boards keep their own pages (Requests inbox, Innovation Desk, Acquisitions).
		const href = QUEUE_PAGES[loaded.board.source] ?? '/the-work';
		return (
			<Card>
				<h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{loaded.board.name}</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-400">This queue opens on its own page.</p>
				<Link href={href} className="mt-3 inline-flex items-center rounded-md border border-primary-700 bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800">Open {loaded.board.name}</Link>
			</Card>
		);
	}
	return <HubPage mode="board" hubKey={slug} searchParams={searchParams} />;
}
