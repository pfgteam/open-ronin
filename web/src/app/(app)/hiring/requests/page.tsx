// /hiring/requests — position requests on the staff-request engine (0128).
// People managers file; Alex (people_reviewers) decides here or in the
// Innovation Desk pipeline. RLS: a requester sees their own, reviewers all.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext } from '@/lib/people/permissions';
import { loadCatalogs, loadHiringConfig, loadPosition, loadStaff } from '@/lib/hiring/server';
import { positionRequestSummary, type PositionRequestPayload } from '@/lib/hiring/shared';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/requests/kinds';
import { formatRelative } from '@/lib/format';
import { decideStaffRequest, withdrawStaffRequest } from '@/app/(app)/the-work/innovation-desk/actions';
import { inputClass } from '@/app/(app)/team/_form';
import NotAppliedCard from '../NotAppliedCard';
import RequestForm from './RequestForm';

export const metadata = { title: 'Position requests · Hiring' };
export const dynamic = 'force-dynamic';

interface Row {
	id: string;
	title: string;
	body_md: string | null;
	payload: PositionRequestPayload;
	requester_id: string;
	status: string;
	decided_at: string | null;
	decision_note_md: string | null;
	subject_id: string | null;
	created_at: string;
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ new?: string; position?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, ctx] = await Promise.all([loadHiringConfig(supabase), loadSensitiveAccessContext()]);
	if (config.notApplied) return <NotAppliedCard />;
	const canFile = ctx.viewerIsPeopleManager || profile.role === 'admin' || profile.role === 'exec';
	const [{ data: rows }, { data: group }, staff, catalogs, draft] = await Promise.all([
		supabase.from('staff_requests').select('id, title, body_md, payload, requester_id, status, decided_at, decision_note_md, subject_id, created_at').eq('kind', 'position_request').order('created_at', { ascending: false }).limit(200),
		supabase.from('reviewer_groups').select('id, members:reviewer_group_members(user_id)').eq('key', 'people_reviewers').maybeSingle(),
		loadStaff(supabase),
		loadCatalogs(supabase),
		sp.position ? loadPosition(supabase, sp.position) : Promise.resolve(null),
	]);
	const isReviewer = profile.role === 'admin' || profile.role === 'exec' || (((group as { members?: { user_id: string }[] } | null)?.members ?? []).some((m) => m.user_id === profile.id));
	const name = new Map(staff.map((s) => [s.id, s.name]));
	const list = (rows ?? []) as Row[];
	const showForm = sp.new === '1' || !!draft;
	const returnTo = '/hiring/requests';

	return (
		<>
			<PageHeader
				title="Position requests"
				description="Alex is the sole approver to start a hiring process; the approval covers the role's annual cost (PAP: multiplier × level, first step) and the posting spend."
				actions={
					!showForm ? (
						<Link href="/hiring/requests?new=1">
							<Button size="sm">Request a position</Button>
						</Link>
					) : (
						<Link href="/hiring/requests">
							<Button size="sm" variant="ghost">
								Close form
							</Button>
						</Link>
					)
				}
			/>
			{showForm && (
				<div className="mb-4">
					<RequestForm config={config} people={staff} departments={catalogs.departments} draft={draft} canFile={canFile} />
				</div>
			)}
			<Card padding="none">
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{list.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No position requests yet.</li>}
					{list.map((r) => (
						<li key={r.id} className="px-4 py-3 space-y-1.5">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.title}</div>
									<div className="text-2xs text-slate-500">
										{name.get(r.requester_id) ?? 'Unknown'} · {formatRelative(r.created_at)} · {positionRequestSummary(r.payload, config.levels)}
									</div>
									{r.body_md && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap line-clamp-4">{r.body_md}</p>}
									{r.decision_note_md && <p className="text-xs text-slate-500 mt-1">Decision: {r.decision_note_md}</p>}
									{r.subject_id && (
										<Link href={`/hiring/positions/${r.subject_id}`} className="text-xs text-primary-600 hover:underline">
											Open the position →
										</Link>
									)}
								</div>
								<Badge color={STATUS_COLORS[r.status] ?? 'default'}>{STATUS_LABELS[r.status] ?? r.status}</Badge>
							</div>
							{r.status === 'pending' && (isReviewer || r.requester_id === profile.id) && (
								<div className="flex flex-wrap items-end gap-2">
									{isReviewer && (
										<form action={decideStaffRequest} className="flex flex-wrap items-end gap-2">
											<input type="hidden" name="id" value={r.id} />
											<input type="hidden" name="return_to" value={returnTo} />
											<input name="note" placeholder="Decision note (optional)" className={`${inputClass} w-64`} maxLength={2000} />
											<button type="submit" name="decision" value="approved" className="rounded-md bg-primary-700 hover:bg-primary-800 text-white text-xs font-medium px-3 py-1.5">
												Approve (budget + posting)
											</button>
											<button type="submit" name="decision" value="denied" className="rounded-md border border-slate-300 dark:border-slate-600 text-xs font-medium px-3 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45">
												Deny
											</button>
										</form>
									)}
									{r.requester_id === profile.id && (
										<form action={withdrawStaffRequest}>
											<input type="hidden" name="id" value={r.id} />
											<input type="hidden" name="return_to" value={returnTo} />
											<button type="submit" className="text-xs text-slate-500 hover:underline">
												Withdraw
											</button>
										</form>
									)}
								</div>
							)}
						</li>
					))}
				</ul>
			</Card>
		</>
	);
}
