// /admin/attendance — attendance policies (0134): accrual days / year,
// method, waiting period, carryover, sick bank, company holidays per
// region / employment type. The default policy drives the holiday shading
// on /team/attendance.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { loadAttendancePolicies } from '@/lib/hiring/server';
import PoliciesEditor from './PoliciesEditor';

export const metadata = { title: 'Attendance · Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminAttendancePage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const canManage = canManagePeople(ctx);
	const { policies, notApplied } = await loadAttendancePolicies(supabase);
	return (
		<>
			<PageHeader
				title="Attendance policies"
				description="PTO accrual rules and company holidays. US employees: 21 days / year accrued daily from the start date, usable after 90 days (the 2026 offer letter). Contractors: no accrual unless granted per person."
				actions={
					<Link href="/team/attendance">
						<Button variant="ghost" size="sm">Open the tracker</Button>
					</Link>
				}
			/>
			{notApplied ? <Callout tone="warning">Migration <code>0134_hiring_h7_onboarding.sql</code> is not applied yet.</Callout> : <PoliciesEditor policies={policies} canManage={canManage} />}
		</>
	);
}
