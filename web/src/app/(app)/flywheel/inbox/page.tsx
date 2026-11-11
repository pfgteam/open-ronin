// /flywheel/inbox — drafts waiting on me: lane review (my lanes) and
// verification (Gabi). Every client-facing asset passes here.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadDraftsByIds, loadFlywheelConfig, loadMyRoles, loadReviewInbox, loadTeamPickList } from '@/lib/flywheel/server';
import NotAppliedCard from '../NotAppliedCard';
import { DraftCard } from '../ProductionPanels';

export const metadata = { title: 'Review inbox · Flywheel' };
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const [inbox, roles, canManage, people] = await Promise.all([loadReviewInbox(supabase), loadMyRoles(supabase, profile.id), profile.role === 'admin' || profile.role === 'exec' ? Promise.resolve(true) : hasCapability('manage_flywheel'), loadTeamPickList(supabase)]);
	const drafts = await loadDraftsByIds(supabase, inbox.map((i) => i.draft_id));
	const byId = new Map(drafts.map((d) => [d.id, d]));
	const groups = new Map<string, typeof inbox>();
	for (const i of inbox) groups.set(i.client_name, [...(groups.get(i.client_name) ?? []), i]);
	return (
		<>
			<PageHeader title="Review inbox" description={`${inbox.length} draft${inbox.length === 1 ? '' : 's'} waiting on you: lane review (Flywheel / writers / pubs / SMM) and verification (the QA gate). Nothing reaches a client or goes live without passing here.`} />
			{inbox.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500">Nothing waiting on you. Drafts appear here once a teammate sends them to lane review, or after lane review when you are the verifier.</p>
				</Card>
			) : (
				<div className="space-y-6">
					{[...groups.entries()].map(([client, items]) => (
						<section key={client} className="space-y-3">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
								<Link href={`/flywheel/${items[0].program_id}?tab=drafts`} className="hover:underline">
									{client}
								</Link>
							</h2>
							{items.map((i) => {
								const d = byId.get(i.draft_id);
								return d ? <DraftCard key={d.id} draft={d} programId={d.program_id} myRoles={roles.get(d.program_id) ?? []} canManage={canManage} people={people} /> : null;
							})}
						</section>
					))}
				</div>
			)}
		</>
	);
}
