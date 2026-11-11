// /calibration — Self -> Calibration (0118). My own self-assessment for the
// open cycle. The Self sidebar entry exists only while a cycle is open
// (navConfig 'cycle' visibility); reaching this URL with no open cycle shows
// a plain message.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadCycles, loadExecIds } from '@/lib/calibration/server';
import { isInternalStaff, loadCalibrationPeople } from '@/lib/calibration/people';
import NotStaffCard from '@/components/calibration/NotStaffCard';
import { quarterLabel } from '@/lib/work/timeframe';
import PersonRounds from '@/components/calibration/PersonRounds';

export const metadata = { title: 'Calibration' };
export const dynamic = 'force-dynamic';

export default async function SelfCalibrationPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (!isInternalStaff(profile)) return <NotStaffCard />;
	const supabase = await createClient();
	const [{ cycles, quarters, error }, execIds, { people }] = await Promise.all([
		loadCycles(supabase),
		loadExecIds(supabase),
		loadCalibrationPeople(supabase, { id: profile.id }),
	]);
	const me = people[0] ?? null;
	const cycle = cycles.find((c) => c.status === 'open') ?? null;
	const quarter = cycle ? quarters.find((q) => q.id === cycle.quarter_id) : null;
	const isAdmin = profile.role === 'admin' || profile.role === 'exec';

	return (
		<>
			<PageHeader
				title="Calibration"
				description={cycle && quarter ? `${quarterLabel(quarter)} · your self-assessment` : 'Your quarterly self-assessment.'}
				actions={<Link href="/team/vantage-point" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Vantage Point →</Link>}
			/>
			<div className="space-y-4 max-w-3xl">
				{sp.error && <Callout tone="error">{sp.error}</Callout>}
				{sp.submitted && !sp.error && <Callout tone="success">Submitted. Your leader&apos;s round is now open; you&apos;ll see their score here once it&apos;s in.</Callout>}
				{error ? (
					<Callout tone="warning">Calibration isn&apos;t switched on yet. Ask Ops to enable it.</Callout>
				) : !cycle ? (
					<Card><p className="text-sm text-slate-500 py-6 text-center">No calibration cycle is open right now. {isAdmin ? <Link href="/admin/calibration" className="text-primary-600 hover:underline">Open one in Admin →</Link> : 'This tab appears when one opens.'}</p></Card>
				) : me?.calibration_excluded ? (
					<Card><p className="text-sm text-slate-600 dark:text-slate-400 py-6 text-center">You are not part of calibration. Nothing to score here.</p></Card>
				) : (
					<PersonRounds
						supabase={supabase}
						cycle={cycle}
						subject={{ id: profile.id, first_name: profile.first_name, last_name: profile.last_name, manager_id: me?.manager_id ?? null }}
						viewerId={profile.id}
						viewerIsExec={isAdmin || execIds.has(profile.id)}
						viewerIsAdmin={isAdmin}
						returnTo="/calibration"
					/>
				)}
			</div>
		</>
	);
}
