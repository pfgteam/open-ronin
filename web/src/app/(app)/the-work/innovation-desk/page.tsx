// /the-work/innovation-desk — Innovation Desk (Alex, 2026-09-14).
//
// "Insights" and "Requests" merged into one surface. Every submission is a
// staff_requests row (0043 engine): the new `innovation` kind (0081) for
// Open Ronin changes, process insights, policy requests and new projects,
// plus the six kinds the old /team/requests page carried (that URL now
// redirects here). Alex is the single approver for Innovation Desk
// submissions (innovation_reviewers group); the other kinds keep routing to
// their own reviewer groups. The admin-side pipeline over every submission
// is /admin/innovation-desk.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import ToolSettingsGear from '@/components/nav/ToolSettingsGear';
import Link from 'next/link';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { FormError } from '../../team/_form';
import { Lightbulb } from 'lucide-react';
import { INNOVATION_DESK_PATH, INNOVATION_PIPELINE_PATH } from '@/lib/requests/kinds';
import NewRequestForm from './NewRequestForm';
import { RequestSummary, ReviewerActions, StatusBadge, WithdrawButton, type RequestRow } from './RequestRows';

export const metadata = { title: 'Innovation Desk' };
export const dynamic = 'force-dynamic';

interface ReviewerGroup {
	id: string;
	key: string;
	name: string;
}

export default async function InnovationDeskPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');

	const supabase = await createClient();
	const [{ data: memberships }, { data: rows }, { data: groups }] = await Promise.all([
		supabase.from('reviewer_group_members').select('group_id').eq('user_id', profile.id),
		supabase
			.from('staff_requests')
			.select(
				'id, kind, title, body_md, payload, requester_id, reviewer_group_id, status, decided_at, decision_note_md, created_at, requester:profiles!staff_requests_requester_id_fkey(first_name, last_name)',
			)
			.order('created_at', { ascending: false }),
		supabase.from('reviewer_groups').select('id, key, name'),
	]);

	const isAdminOrExec = ['admin', 'exec'].includes(profile.role);
	const myGroupIds = new Set((memberships ?? []).map((m) => m.group_id));
	const allGroups = (groups ?? []) as ReviewerGroup[];
	// Admin/exec see every group's queue (anti-lockout floor, same as
	// is_reviewer() itself); everyone else sees only groups they're in.
	const myQueueGroups = isAdminOrExec ? allGroups : allGroups.filter((g) => myGroupIds.has(g.id));
	const innovationGroupMissing = !allGroups.some((g) => g.key === 'innovation_reviewers');

	const requests = (rows ?? []) as unknown as RequestRow[];
	const mine = requests.filter((r) => r.requester_id === profile.id);

	return (
		<>
			<div className="space-y-4">
				<PageHeader
					title="Innovation Desk"
					description="Ideas, process insights, policy requests and new projects — plus time off, SOPs, promotions, design projects, podcast episodes and software changes. Each routes to its reviewer; Innovation Desk submissions go to Alex."
					actions={
						<div className="flex items-center gap-2">
							<ToolSettingsGear tool="/the-work/innovation-desk" />
							{isAdminOrExec ? (
								<Link href={INNOVATION_PIPELINE_PATH} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
									Admin pipeline →
								</Link>
							) : null}
						</div>
					}
				/>
				<FormError message={error} />

				{innovationGroupMissing && isAdminOrExec && (
					<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">
							Migration 0081 (Innovation Desk kind + reviewer group) is not applied yet. The other request
							kinds work; an Innovation Desk submission will be refused until it is.
						</p>
					</Card>
				)}

				<Card>
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
						<Lightbulb className="w-4 h-4 text-slate-400" />
						New submission
					</h3>
					<NewRequestForm returnTo={INNOVATION_DESK_PATH} />
				</Card>

				{/* Review queue(s) — one card per reviewer group the viewer belongs
				    to, kept separate so Alex's Innovation Desk queue doesn't mix
				    with Strategy Reviewers' Time Off/SOP rows or DevOps' changes. */}
				{myQueueGroups.map((g) => {
					const queue = requests.filter(
						(r) =>
							r.reviewer_group_id === g.id &&
							r.status !== 'withdrawn' &&
							!['denied', 'completed'].includes(r.status) &&
							// approved is final for one-step kinds; two-step kinds stay until completed
							!(r.status === 'approved' && !['software_change', 'innovation'].includes(r.kind)),
					);
					return (
						<Card key={g.id} padding="none">
							<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
								<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Review queue — {g.name}</h3>
								<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
									{queue.length === 0 ? 'Nothing waiting.' : `${queue.length} open`}
								</p>
							</div>
							<div className="divide-y divide-slate-100 dark:divide-slate-700/60">
								{queue.map((r) => (
									<div key={r.id} className="px-4 py-3 space-y-2">
										<div className="flex items-center justify-between gap-3">
											<RequestSummary r={r} />
											<StatusBadge status={r.status} />
										</div>
										<ReviewerActions r={r} returnTo={INNOVATION_DESK_PATH} />
									</div>
								))}
							</div>
						</Card>
					);
				})}

				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">My submissions</h3>
					</div>
					<div className="divide-y divide-slate-100 dark:divide-slate-700/60">
						{mine.length === 0 && (
							<p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Nothing filed yet.</p>
						)}
						{mine.map((r) => (
							<div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
								<RequestSummary r={r} showRequester={false} />
								<div className="flex items-center gap-2 shrink-0">
									<StatusBadge status={r.status} />
									<WithdrawButton r={r} returnTo={INNOVATION_DESK_PATH} />
								</div>
							</div>
						))}
					</div>
				</Card>
			</div>
		</>
	);
}
