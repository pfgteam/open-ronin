// /team/calibration/[id] — one person's three rounds in the open cycle
// (0118). The leader scores round 2 here, the exec reconcilers round 3;
// everyone else sees the submitted totals. Past cycles live in Vantage Point.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { departmentOf, departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { isInternalStaff, loadCalibrationPeople } from '@/lib/calibration/people';
import NotStaffCard from '@/components/calibration/NotStaffCard';
import { loadCycles, loadExecIds } from '@/lib/calibration/server';
import { quarterLabel } from '@/lib/work/timeframe';
import PersonRounds from '@/components/calibration/PersonRounds';

export const metadata = { title: 'Calibration' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function CalibrationPersonPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
	const { id } = await params;
	const sp = await searchParams;
	if (!UUID.test(id)) notFound();
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (!isInternalStaff(profile)) return <NotStaffCard />;
	if (id === profile.id) redirect('/calibration');
	const isAdmin = profile.role === 'admin' || profile.role === 'exec';
	const supabase = await createClient();
	const [{ cycles, quarters, error }, execIds, { people }, departmentTags] = await Promise.all([
		loadCycles(supabase),
		loadExecIds(supabase),
		loadCalibrationPeople(supabase, { id }),
		loadDepartments(supabase),
	]);
	const subject = people[0] ?? null;
	if (!subject || !isInternalStaff(subject)) notFound();
	const cycle = cycles.find((c) => c.status === 'open') ?? null;
	const quarter = cycle ? quarters.find((q) => q.id === cycle.quarter_id) : null;
	const name = [subject.first_name, subject.last_name].filter(Boolean).join(' ') || 'Unnamed';
	const { data: mgr } = subject.manager_id ? await supabase.from('profiles').select('first_name, last_name').eq('id', subject.manager_id).maybeSingle() : { data: null };
	const leaderName = mgr ? [mgr.first_name, mgr.last_name].filter(Boolean).join(' ') : 'not set';

	return (
		<>
			<PageHeader
				title={name}
				description={`${departmentOf(subject, departmentLabelById(departmentTags)) ?? 'No department'} · leader: ${leaderName}${cycle && quarter ? ` · ${quarterLabel(quarter)}` : ''}`}
				actions={<Link href="/team/calibration" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">← Calibration</Link>}
			/>
			<div className="space-y-4 max-w-3xl">
				{sp.error && <Callout tone="error">{sp.error}</Callout>}
				{sp.submitted && !sp.error && <Callout tone="success">Submitted. The next round is now open.</Callout>}
				{error ? (
					<Callout tone="warning">Calibration isn&apos;t switched on yet.</Callout>
				) : !cycle ? (
					<Card><p className="text-sm text-slate-500 py-6 text-center">No calibration cycle is open. Past results are in <Link href="/team/vantage-point" className="text-primary-600 hover:underline">Vantage Point</Link>.</p></Card>
				) : subject.calibration_excluded ? (
					<Card><p className="text-sm text-slate-600 dark:text-slate-400 py-6 text-center">{name} is not part of calibration. Nothing to score here.</p></Card>
				) : (
					<PersonRounds
						supabase={supabase}
						cycle={cycle}
						subject={subject}
						viewerId={profile.id}
						viewerIsExec={isAdmin || execIds.has(profile.id)}
						viewerIsAdmin={isAdmin}
						returnTo={`/team/calibration/${id}`}
					/>
				)}
			</div>
		</>
	);
}
