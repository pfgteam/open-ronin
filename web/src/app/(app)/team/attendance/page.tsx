// /team/attendance — the company-wide attendance tracker with PTO accruals
// (0134, decision 7; replaces the "2026 Attendance Tracker with Accruals"
// sheet). Everyone sees who is out (the sheet was shared); balances show
// for yourself, your reports, and for people managers / admins. PTO requests
// still go through the Innovation Desk (staff_requests kind time_off) and
// approvals land on time_off; this page counts them. Sick / unpaid / late /
// WFH are recorded here.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { loadAttendancePolicies, loadAttendanceSummary, loadAttendanceYear } from '@/lib/hiring/server';
import { fmtDays } from '@/lib/hiring/onboarding';
import AttendanceGrid from './AttendanceGrid';

export const metadata = { title: 'Attendance · Team' };
export const dynamic = 'force-dynamic';

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; dept?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const now = new Date();
	const year = Number(sp.year) >= 2020 && Number(sp.year) <= 2100 ? Number(sp.year) : now.getFullYear();
	const month = Number(sp.month) >= 1 && Number(sp.month) <= 12 ? Number(sp.month) : year === now.getFullYear() ? now.getMonth() + 1 : 1;
	const ctx = await loadSensitiveAccessContext();
	const canManage = canManagePeople(ctx);
	const [summary, { timeOff, events }, { policies, notApplied }, deptTags] = await Promise.all([loadAttendanceSummary(supabase, year), loadAttendanceYear(supabase, year), loadAttendancePolicies(supabase), loadDepartments(supabase)]);
	const deptLabels = departmentLabelById(deptTags);

	if (notApplied || summary.notApplied) {
		return (
			<>
				<PageHeader title="Attendance" description="Company-wide attendance with PTO accruals." />
				<Callout tone="warning">The attendance tracker needs migration <code>0134_hiring_h7_onboarding.sql</code>, which is written but not applied yet. Until then the 2026 sheet stays the source of truth.</Callout>
			</>
		);
	}

	const rows = summary.rows.filter((r) => r.is_active || timeOff.some((t) => t.user_id === r.profile_id));
	const mine = rows.find((r) => r.profile_id === profile.id);
	const outToday = (() => {
		const today = now.toISOString().slice(0, 10);
		const ids = new Set<string>();
		for (const t of timeOff) if (t.status === 'approved' && t.counts_as_pto && t.starts_on <= today && (t.source === 'calendar_event' ? t.ends_on > today : t.ends_on >= today)) ids.add(t.user_id);
		for (const e of events) if (e.on_date === today && ['sick', 'unpaid', 'absent'].includes(e.kind)) ids.add(e.profile_id);
		return rows.filter((r) => ids.has(r.profile_id));
	})();

	return (
		<>
			<PageHeader
				title="Attendance"
				description={`${year} · PTO accrues daily from the start date (21 days / year for US employees, usable after 90 days); balances count approved time off from the Innovation Desk. Sick, unpaid, late and WFH are recorded here.`}
				actions={
					<div className="flex items-center gap-3">
						<Link href="/the-work/innovation-desk" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Request time off →</Link>
						{canManage && <Link href="/admin/attendance" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Policies →</Link>}
					</div>
				}
			/>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
				<Card>
					<div className="text-2xs uppercase tracking-wide text-slate-500">Out today</div>
					<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{outToday.length}</div>
					<div className="text-2xs text-slate-500 truncate">{outToday.map((r) => r.first_name ?? r.email).join(', ') || 'everyone in'}</div>
				</Card>
				{mine && (
					<>
						<Card>
							<div className="text-2xs uppercase tracking-wide text-slate-500">My balance</div>
							<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmtDays(mine.balance_days)} <span className="text-sm font-normal text-slate-500">days</span></div>
							<div className="text-2xs text-slate-500">{fmtDays(mine.accrued_days)} accrued · {fmtDays(mine.used_pto_days)} used{mine.pending_pto_days ? ` · ${fmtDays(mine.pending_pto_days)} pending` : ''}</div>
						</Card>
						<Card>
							<div className="text-2xs uppercase tracking-wide text-slate-500">My policy</div>
							<div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{mine.policy_label ?? '—'}</div>
							<div className="text-2xs text-slate-500">{mine.eligible_from ? `PTO usable from ${mine.eligible_from}` : ''}{mine.sick_days ? ` · ${fmtDays(mine.sick_days)} sick` : ''}</div>
						</Card>
					</>
				)}
				<Card>
					<div className="text-2xs uppercase tracking-wide text-slate-500">Policies</div>
					<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{policies.filter((p) => p.is_active).length}</div>
					<div className="text-2xs text-slate-500 truncate">{policies.filter((p) => p.is_default).map((p) => p.label).join(', ') || 'no default'}</div>
				</Card>
			</div>
			{summary.error && <Callout tone="error" className="mb-4">{summary.error}</Callout>}
			<AttendanceGrid year={year} month={month} rows={rows} timeOff={timeOff} events={events} policies={policies} deptLabels={Object.fromEntries(deptLabels)} viewerId={profile.id} canManage={canManage} deptFilter={sp.dept ?? ''} />
		</>
	);
}
