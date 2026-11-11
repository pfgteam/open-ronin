// /flywheel/queue — the posting queue: approved citations waiting for a
// person, the owned network or Fourth Pillar; sorted by the page's 72 h
// wave deadline. Posting with the URL writes the Citation Ledger.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadPostingQueue, loadTeamPickList } from '@/lib/flywheel/server';
import NotAppliedCard from '../NotAppliedCard';
import { QueueItem } from '../ProductionPanels';

export const metadata = { title: 'Posting queue · Flywheel' };
export const dynamic = 'force-dynamic';

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const status = sp.status === 'all' ? undefined : sp.status === 'posted' ? ['posted'] : ['queued', 'claimed'];
	const [rows, people] = await Promise.all([loadPostingQueue(supabase, { status }), loadTeamPickList(supabase)]);
	const list = sp.mine ? rows.filter((r) => r.assignee_id === profile.id) : rows;
	const late = list.filter((r) => r.due_at && ['queued', 'claimed'].includes(r.status) && new Date(r.due_at) < new Date()).length;
	const byKind = { person: list.filter((r) => r.poster_kind === 'person').length, network: list.filter((r) => r.poster_kind === 'network').length, fourth_pillar: list.filter((r) => r.poster_kind === 'fourth_pillar').length };
	return (
		<>
			<PageHeader
				title="Posting queue"
				description={`${list.length} citation${list.length === 1 ? '' : 's'} · ${byKind.person} by people · ${byKind.network} owned network · ${byKind.fourth_pillar} Fourth Pillar${late ? ` · ${late} past the 72 h wave` : ''}`}
				actions={
					<div className="flex gap-2 text-xs">
						<Link href="/flywheel/queue" className="text-primary-600 hover:underline">
							Open
						</Link>
						<Link href="/flywheel/queue?status=posted" className="text-primary-600 hover:underline">
							Posted (verify)
						</Link>
						<Link href="/flywheel/queue?status=all" className="text-primary-600 hover:underline">
							All
						</Link>
						<Link href="/flywheel/queue?mine=1" className="text-primary-600 hover:underline">
							Mine
						</Link>
					</div>
				}
			/>
			{late > 0 && (
				<Badge color="danger" className="mb-3">
					{late} past 72 h — prioritise the 8-channel order so no channel is skipped
				</Badge>
			)}
			<Card>
				{list.length === 0 ? (
					<p className="text-sm text-slate-500">Queue is empty. Approved citations land here automatically.</p>
				) : (
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{list.map((r) => (
							<QueueItem key={r.id} row={r} people={people} />
						))}
					</ul>
				)}
			</Card>
		</>
	);
}
