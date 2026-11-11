// /team/calibration — Team -> Calibration (0118).
//
// The open cycle only. A review list of the assessments waiting on ME:
//   - the leader round for my direct reports (self submitted, leader not);
//   - the exec round for the exec reconcilers (self + leader submitted).
// No cycle picker, no admin controls (those live at /admin/calibration);
// past quarters are read in Vantage Point. Each row opens
// /team/calibration/<person>.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { departmentOf, departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { assessable, isInternalStaff, loadCalibrationPeople, type CalibrationPerson } from '@/lib/calibration/people';
import NotStaffCard from '@/components/calibration/NotStaffCard';
import { groupBySubject, loadCycles, loadExecIds, loadScores } from '@/lib/calibration/server';
import { TotalsStrip } from '@/components/calibration/SubmittedRound';
import { nextRound, STATUS_LABELS, type Round } from '@/lib/calibration/shared';
import { quarterLabel } from '@/lib/work/timeframe';

export const metadata = { title: 'Calibration' };
export const dynamic = 'force-dynamic';

const nameOf = (p: Pick<CalibrationPerson, 'first_name' | 'last_name'> | null | undefined) =>
	p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed' : 'Unknown';

export default async function TeamCalibrationPage({ searchParams }: { searchParams: Promise<{ error?: string; submitted?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (!isInternalStaff(profile)) return <NotStaffCard />;
	const isAdmin = profile.role === 'admin' || profile.role === 'exec';
	const supabase = await createClient();
	const [{ cycles, quarters, error }, execIds] = await Promise.all([loadCycles(supabase), loadExecIds(supabase)]);
	const isExec = isAdmin || execIds.has(profile.id);
	const cycle = cycles.find((c) => c.status === 'open') ?? null;
	const quarter = cycle ? quarters.find((q) => q.id === cycle.quarter_id) : null;

	const header = (
		<PageHeader
			title="Calibration"
			description={cycle && quarter ? `${quarterLabel(quarter)} · assessments waiting on you` : 'Assessments waiting on you.'}
			actions={
				<div className="flex items-center gap-3">
					<Link href="/calibration" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">My self-assessment →</Link>
					<Link href="/team/vantage-point" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Vantage Point →</Link>
					{isAdmin && <Link href="/admin/calibration" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Admin →</Link>}
				</div>
			}
		/>
	);

	if (error) {
		return (
			<>
				{header}
				<Callout tone="warning">Calibration isn&apos;t switched on yet. Ask Ops to enable it.</Callout>
			</>
		);
	}
	if (!cycle) {
		return (
			<>
				{header}
				<Card><p className="text-sm text-slate-500 py-6 text-center">No calibration cycle is open. {isAdmin ? <Link href="/admin/calibration" className="text-primary-600 hover:underline">Open one in Admin →</Link> : 'Past results are in Vantage Point.'}</p></Card>
			</>
		);
	}

	const [{ people: allPeople }, departmentTags, { scores, scorecardAvailable }] = await Promise.all([
		loadCalibrationPeople(supabase),
		loadDepartments(supabase),
		loadScores(supabase, { cycleId: cycle.id }),
	]);
	const byId = new Map(allPeople.map((p) => [p.id, p]));
	const roster = assessable(allPeople).filter((p) => p.id !== profile.id);
	const bySubject = groupBySubject(scores);
	const deptLabels = departmentLabelById(departmentTags);

	// What is waiting on me, and what I am watching (started but not my turn).
	const mine: { person: CalibrationPerson; round: Round }[] = [];
	const watching: { person: CalibrationPerson; status: Round | 'done' }[] = [];
	for (const p of roster) {
		const rows = bySubject.get(p.id) ?? [];
		const nxt = nextRound(rows);
		const isMyReport = p.manager_id === profile.id;
		if (nxt === 'leader' && (isMyReport || isAdmin)) mine.push({ person: p, round: 'leader' });
		else if (nxt === 'exec' && isExec) mine.push({ person: p, round: 'exec' });
		else if (isMyReport || isExec) watching.push({ person: p, status: nxt });
	}
	// Leaders first by report name
	mine.sort((a, b) => (a.round === b.round ? nameOf(a.person).localeCompare(nameOf(b.person)) : a.round === 'leader' ? -1 : 1));

	return (
		<>
			{header}
			<div className="space-y-4">
				{sp.error && <Callout tone="error">{sp.error}</Callout>}
				{sp.submitted && !sp.error && <Callout tone="success">Submitted. The next round is now open.</Callout>}
				{!scorecardAvailable && (
					<Callout tone="warning">The scorecard needs migration <code>0118_calibration_scorecard.sql</code>, which is written but not applied yet.</Callout>
				)}

				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Waiting on you</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto tabular-nums">{mine.length} to score</span>
					</div>
					{mine.length === 0 ? (
						<p className="text-sm text-slate-500 py-8 text-center">
							Nothing waiting on you right now.
							{!isExec && roster.some((p) => p.manager_id === profile.id) ? ' Your reports’ leader rounds appear here once they submit their self-assessment.' : ''}
							{!isExec && !roster.some((p) => p.manager_id === profile.id) ? ' You have no direct reports to score.' : ''}
						</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{mine.map(({ person, round }) => {
								const rows = bySubject.get(person.id) ?? [];
								const selfRow = rows.find((r) => r.round === 'self' && r.submitted_at);
								const leaderRow = rows.find((r) => r.round === 'leader' && r.submitted_at);
								const myDraft = rows.find((r) => r.round === round && !r.submitted_at && r.scorer_id === profile.id);
								return (
									<li key={person.id} className="px-4 py-3 flex items-center gap-4 flex-wrap hover:bg-hover transition-colors">
										<div className="min-w-0 flex-1">
											<Link href={`/team/calibration/${person.id}`} className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600">{nameOf(person)}</Link>
											<p className="text-2xs text-slate-600 dark:text-slate-400">
												{departmentOf(person, deptLabels) ?? 'No department'} · leader: {person.manager_id ? nameOf(byId.get(person.manager_id)) : '—'}
											</p>
										</div>
										<div className="flex items-center gap-4 text-xs">
											{selfRow && <div><p className="text-2xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Self</p><TotalsStrip score={selfRow} compact /></div>}
											{round === 'exec' && leaderRow && <div><p className="text-2xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Leader</p><TotalsStrip score={leaderRow} compact /></div>}
										</div>
										<div className="flex items-center gap-2">
											<Badge color={round === 'exec' ? 'primary' : 'warning'}>{round === 'exec' ? 'Exec round' : 'Leader round'}{myDraft ? ' · draft' : ''}</Badge>
											<Link href={`/team/calibration/${person.id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">{myDraft ? 'Continue →' : 'Score →'}</Link>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</Card>

				{watching.length > 0 && (
					<Card padding="none">
						<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{isExec ? 'Everyone else' : 'Your reports'}</h2>
						</div>
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{watching
								.sort((a, b) => nameOf(a.person).localeCompare(nameOf(b.person)))
								.map(({ person, status }) => (
									<li key={person.id} className="px-4 py-2 flex items-center gap-3 text-xs">
										<Link href={`/team/calibration/${person.id}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600 flex-1 min-w-0 truncate">{nameOf(person)}</Link>
										<span className="text-slate-500 dark:text-slate-400">{person.manager_id ? nameOf(byId.get(person.manager_id)) : '—'}</span>
										<Badge color={status === 'done' ? 'success' : 'default'}>{STATUS_LABELS[status]}</Badge>
									</li>
								))}
						</ul>
					</Card>
				)}
			</div>
		</>
	);
}
