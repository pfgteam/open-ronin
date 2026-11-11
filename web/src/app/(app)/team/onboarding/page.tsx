// /team/onboarding — team-member onboarding (0134, H7): every active 60/90-day
// plan the viewer may see (RLS: the person, their manager, people managers,
// admins), progress by phase, overdue items, calibration hold; plus the
// project workflows + Drive playbooks this page always carried.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { loadOnboardingPlans, loadStaff } from '@/lib/hiring/server';
import { onboardingDay } from '@/lib/hiring/onboarding';
import { formatDate } from '@/lib/format';
import { Workflow, BookOpen, ExternalLink, Plus } from 'lucide-react';
import StartPlanForm from './StartPlanForm';

export const metadata = { title: 'Onboarding · Team' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const canManage = canManagePeople(ctx);
	const showAll = sp.status === 'all';
	const [{ plans, notApplied }, { data: templates }, staff] = await Promise.all([
		loadOnboardingPlans(supabase, { status: showAll ? 'all' : 'active' }),
		supabase.from('project_templates').select('*').in('kind', ['onboarding', 'beacon_onboarding']).eq('is_active', true).order('name'),
		canManage ? loadStaff(supabase) : Promise.resolve([]),
	]);
	const withPlan = new Set(plans.map((p) => p.profile_id));

	const onboardingLinks = [
		{ label: '(HR2) Playbook root', url: 'https://drive.google.com/drive/folders/1ryrwu8aC3ZwBxnt7_ryx0prWH3ZYxZym', desc: 'HR playbook folder.' },
		{ label: 'New Hire Onboarding folder', url: 'https://drive.google.com/drive/folders/1pJxZDZds4qMG5UAckZ1OIOClQ34nbuXk', desc: 'Standard new-hire materials.' },
		{ label: 'People Playbook', url: 'https://docs.google.com/document/d/1P0T-a5r_iLg-mus92UEk8nYkcz1LIB1BxyZo4BV7B-A/edit', desc: 'People Ops canonical playbook.' },
		{ label: 'Onboarding & Strategy Docs', url: 'https://drive.google.com/drive/folders/1aJc_or81qFDrpgbtyq41ZDE0DI4vD3TR', desc: 'Client onboarding strategy docs.' },
	];

	return (
		<>
			<PageHeader
				title="Onboarding"
				description="Team-member onboarding: the 60-Day Plan + the progressive 90-day framework (context → role clarity / PAP / DISC → PPF / Time Study → day-90 review). Calibration joins after day 60."
				actions={
					<div className="flex items-center gap-3">
						<Link href={showAll ? '/team/onboarding' : '/team/onboarding?status=all'} className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">{showAll ? 'Active only' : 'Show completed'}</Link>
						<Link href="/team/attendance" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Attendance →</Link>
					</div>
				}
			/>

			{notApplied && <Callout tone="warning" className="mb-4">Onboarding plans need migration <code>0134_hiring_h7_onboarding.sql</code>, which is written but not applied yet. The links below still work.</Callout>}

			{!notApplied && (
				<Card padding="none" className="mb-4">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Plans</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto tabular-nums">{plans.length} {showAll ? 'total' : 'active'}</span>
					</div>
					{plans.length === 0 ? (
						<p className="px-3 py-6 text-sm text-slate-500 text-center">No onboarding plans {showAll ? '' : 'in progress'}. A plan is created automatically when a hire is converted in Hiring{canManage ? ', or start one below for someone already on the team' : ''}.</p>
					) : (
						<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="text-left px-3 py-2 font-medium">Person</th>
									<th className="text-left px-3 py-2 font-medium">Manager</th>
									<th className="text-left px-3 py-2 font-medium">Start</th>
									<th className="text-right px-3 py-2 font-medium">Day</th>
									<th className="text-left px-3 py-2 font-medium">Phase</th>
									<th className="text-right px-3 py-2 font-medium">Done</th>
									<th className="text-right px-3 py-2 font-medium">Overdue</th>
									<th className="text-left px-3 py-2 font-medium">Calibration</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{plans.map((p) => {
									const day = onboardingDay(p.start_on);
									const phase = p.phase3_done_at ? 'Complete' : p.phase2_done_at ? 'Phase 3' : p.phase1_done_at ? 'Phase 2' : day > 60 ? 'Phase 3 (P1/P2 open)' : day > 30 ? 'Phase 2 (P1 open)' : 'Phase 1';
									return (
										<tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
											<td className="px-3 py-2">
												<Link href={`/team/onboarding/${p.profile_id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">{p.person_name}</Link>
												<div className="text-2xs text-slate-500">{p.job_role ?? p.person_email}</div>
											</td>
											<td className="px-3 py-2 text-slate-700 dark:text-slate-300">{p.manager_name ?? '—'}</td>
											<td className="px-3 py-2 text-slate-700 dark:text-slate-300">{formatDate(p.start_on)}</td>
											<td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{day > 0 ? day : `in ${1 - day}d`}</td>
											<td className="px-3 py-2"><Badge color={p.status === 'complete' ? 'success' : p.status === 'active' ? 'primary' : 'default'}>{p.status === 'active' ? phase : p.status}</Badge></td>
											<td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{p.done_items}/{p.total_items}</td>
											<td className="px-3 py-2 text-right tabular-nums">{p.overdue_items > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{p.overdue_items}</span> : <span className="text-slate-400">0</span>}</td>
											<td className="px-3 py-2">{p.calibration_enrolled_at ? <Badge color="success">enrolled</Badge> : p.calibration_hold ? <Badge color="warning">hold until day 60</Badge> : <Badge>in cycle</Badge>}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						</div>
					)}
					{canManage && <StartPlanForm staff={staff.filter((s) => !withPlan.has(s.id))} />}
				</Card>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5"><Workflow className="w-3.5 h-3.5" /> Project workflows</h2>
					</div>
					{(templates ?? []).length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-6">No templates available.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{(templates ?? []).map((t) => (
								<li key={t.id}>
									<Link href={`/team/templates/${t.slug}`} className="flex items-center justify-between px-3 py-2 hover:bg-hover transition-colors">
										<div className="min-w-0">
											<div className="text-sm text-slate-900 dark:text-slate-100 truncate">{t.name}</div>
											<div className="text-2xs text-slate-600 dark:text-slate-400">{t.kind} · {t.default_duration_days}d</div>
										</div>
										<Badge color="primary" className="text-2xs">Template</Badge>
									</Link>
								</li>
							))}
						</ul>
					)}
					<div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
						<Link href="/the-work/planning?kind=project" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
							<Plus className="w-3 h-3" /> Start a project from a template
						</Link>
					</div>
				</Card>

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Onboarding playbooks (Drive)</h2>
					</div>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{onboardingLinks.map((l) => (
							<li key={l.url} className="px-3 py-2">
								<a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
									<ExternalLink className="w-3 h-3" /> {l.label}
								</a>
								<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">{l.desc}</p>
							</li>
						))}
					</ul>
				</Card>
			</div>
		</>
	);
}
