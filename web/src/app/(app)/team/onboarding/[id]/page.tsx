// /team/onboarding/[id] — one person's 60/90-day plan (0134): the phase
// checklist with traffic lights, the 60-Day Plan daily check-in form, the
// DISC result + questionnaire / manual entry, calibration status.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { loadDiscQuestions, loadLevelHistory, loadOnboardingPlan, loadStaff } from '@/lib/hiring/server';
import { ONBOARDING_PHASES, onboardingDay } from '@/lib/hiring/onboarding';
import { formatDate } from '@/lib/format';
import PlanChecklist from './PlanChecklist';
import CheckinForm from './CheckinForm';
import DiscPanel from './DiscPanel';
import PlanControls from './PlanControls';

export const dynamic = 'force-dynamic';

export default async function OnboardingPlanPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const viewer = await getAuthProfile();
	if (!viewer) redirect('/auth/login');
	if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const [{ data: person }, { plan, items, checkins, disc, notApplied }] = await Promise.all([
		supabase.from('profiles').select('id, first_name, last_name, email, job_role, title, manager_id, date_started, disc, calibration_excluded').eq('id', id).maybeSingle(),
		loadOnboardingPlan(supabase, id),
	]);
	const p = person as { id: string; first_name: string | null; last_name: string | null; email: string; job_role: string | null; title: string | null; manager_id: string | null; date_started: string | null; disc: string | null; calibration_excluded: boolean } | null;
	if (!p) notFound();
	const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
	const isSelf = viewer.id === id;
	const isManager = p.manager_id === viewer.id || plan?.manager_id === viewer.id;
	const canManage = canManagePeople(ctx);
	const canEdit = canManage || isManager;
	const [staff, questions, history] = await Promise.all([canEdit ? loadStaff(supabase) : Promise.resolve([]), loadDiscQuestions(supabase), loadLevelHistory(supabase, id)]);

	const header = (
		<PageHeader
			title={`${name} · onboarding`}
			description={p.job_role ?? p.title ?? p.email}
			actions={
				<div className="flex items-center gap-3">
					<Link href={`/team/${id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Profile →</Link>
					<Link href="/team/onboarding" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">All plans →</Link>
				</div>
			}
		/>
	);

	if (notApplied) return <>{header}<Callout tone="warning">Migration <code>0134_hiring_h7_onboarding.sql</code> is not applied yet.</Callout></>;
	if (!plan) {
		return (
			<>
				{header}
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">{isSelf ? 'You have no onboarding plan on record.' : `${name} has no onboarding plan.`} {canEdit ? <Link href="/team/onboarding" className="text-primary-600 hover:underline">Start one from the Onboarding page.</Link> : 'Plans are created when a hire is converted, or by a people manager.'}</p>
				</Card>
			</>
		);
	}

	const day = onboardingDay(plan.start_on);
	const byPhase = (ph: 1 | 2 | 3) => items.filter((i) => i.phase === ph);
	const phaseDone = (ph: 1 | 2 | 3) => (ph === 1 ? plan.phase1_done_at : ph === 2 ? plan.phase2_done_at : plan.phase3_done_at);

	return (
		<>
			{header}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-4">
				<Stat label="Day" value={day > 0 ? String(day) : `starts in ${1 - day}d`} hint={`started ${formatDate(plan.start_on)}`} />
				<Stat label="Status" value={plan.status} hint={plan.completed_at ? `completed ${formatDate(plan.completed_at)}` : plan.phase2_done_at ? 'Phase 3' : plan.phase1_done_at ? 'Phase 2' : 'Phase 1'} />
				<Stat label="Items done" value={`${items.filter((i) => i.status === 'done' || i.status === 'skipped').length}/${items.length}`} hint={`${items.filter((i) => !['done', 'skipped'].includes(i.status) && i.due_on < new Date().toISOString().slice(0, 10)).length} overdue`} />
				<Stat label="Check-ins" value={String(checkins.length)} hint="60-Day Plan forms" />
				<Stat label="Calibration" value={plan.calibration_enrolled_at ? 'enrolled' : plan.calibration_hold ? 'hold' : 'in cycle'} hint={plan.calibration_enrolled_at ? `since ${formatDate(plan.calibration_enrolled_at)}` : plan.calibration_hold ? `joins after day 60 (${formatDate(addDays(plan.start_on, 60))})` : 'assessed with the team'} />
			</div>

			{canEdit && <PlanControls plan={plan} profileId={id} staff={staff} />}

			<div className="grid gap-4 lg:grid-cols-3 mt-4">
				<div className="lg:col-span-2 space-y-4">
					{([1, 2, 3] as const).map((ph) => (
						<Card key={ph} padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ONBOARDING_PHASES[ph].label}</h2>
								<span className="text-2xs text-slate-500">{ONBOARDING_PHASES[ph].days}</span>
								{phaseDone(ph) && <Badge color="success" className="ml-auto">complete {formatDate(phaseDone(ph)!)}</Badge>}
							</div>
							<p className="px-3 pt-2 text-2xs text-slate-600 dark:text-slate-400">{ONBOARDING_PHASES[ph].focus}</p>
							<PlanChecklist items={byPhase(ph)} planId={plan.id} profileId={id} phase={ph} canEdit={canEdit || isSelf} canAdd={canEdit} staff={staff} startOn={plan.start_on} />
						</Card>
					))}
				</div>
				<div className="space-y-4">
					<DiscPanel profileId={id} name={name} currentStyle={p.disc} response={disc} questions={questions} canEnter={canEdit || isSelf} isSelf={isSelf} />
					<CheckinForm planId={plan.id} profileId={id} startOn={plan.start_on} checkins={checkins} isSelf={isSelf} isSupervisor={canEdit} viewerId={viewer.id} />
					{history.length > 0 && (
						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700"><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Role changes</h2></div>
							<ul className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
								{history.slice(0, 12).map((h) => (
									<li key={h.id} className="px-3 py-1.5 flex items-center gap-2">
										{h.is_advancement && <Badge color="success">advancement</Badge>}
										<span className="text-slate-700 dark:text-slate-300">{h.field.replace('_', ' ')}: {h.field === 'manager_id' ? (staff.find((s) => s.id === h.from_value)?.name ?? '—') : (h.from_value ?? '—')} → {h.field === 'manager_id' ? (staff.find((s) => s.id === h.to_value)?.name ?? '—') : (h.to_value ?? '—')}</span>
										<span className="ml-auto text-slate-500">{formatDate(h.changed_at)}</span>
									</li>
								))}
							</ul>
						</Card>
					)}
				</div>
			</div>
		</>
	);
}

function addDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<Card>
			<div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div>
			<div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100 capitalize">{value}</div>
			{hint && <div className="text-2xs text-slate-500">{hint}</div>}
		</Card>
	);
}
