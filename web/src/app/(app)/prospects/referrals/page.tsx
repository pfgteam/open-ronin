// /prospects/referrals — the growth loop (0127, spec §10): referral codes
// and "send us a lead" links, referrals by status with commissions due /
// paid, feedback requests (call + client) with links to send, review
// requests by milestone. Payouts are recorded by hand (manage_revenue).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { formatRelative } from '@/lib/format';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadGrowth, loadStaff } from '@/lib/revenue/server';
import { formatCents } from '@/lib/revenue/shared';
import NotAppliedCard from '../NotAppliedCard';
import GrowthPanels from './GrowthPanels';

export const metadata = { title: 'Referrals · Prospects' };
export const dynamic = 'force-dynamic';

export default async function ReferralsPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [g, staff, canManage] = await Promise.all([loadGrowth(supabase), loadStaff(supabase), hasCapability('manage_revenue')]);
	if (g.notApplied) return <NotAppliedCard />;
	const due = g.payouts.filter((p) => p.status === 'due').reduce((n, p) => n + p.amount_cents, 0);
	const paid = g.payouts.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amount_cents, 0);
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
	const myFeedback = g.feedback.filter((f) => f.subject_user_id === profile.id && f.submitted_at);
	const myAvg = myFeedback.length ? Math.round((myFeedback.reduce((n, f) => n + (f.rating ?? 0), 0) / myFeedback.filter((f) => f.rating).length) * 10) / 10 : null;

	return (
		<>
			<PageHeader
				title="Referrals, reviews & feedback"
				description={`${g.referrals.length} referral${g.referrals.length === 1 ? '' : 's'} · ${formatCents(due)} commission due · ${formatCents(paid)} paid · ${g.reviews.filter((r) => r.status === 'collected').length} review${g.reviews.filter((r) => r.status === 'collected').length === 1 ? '' : 's'} collected`}
				actions={
					<Link href="/data/pipeline" className="text-xs text-primary-700 dark:text-primary-300 underline">
						Automations
					</Link>
				}
			/>
			<Callout tone="info" className="mb-4">
				Affiliate program: a non-client earns <strong>$100</strong> for an intro that reaches a call and <strong>10% for 5 months</strong> if it closes; a client earns <strong>5% for 5 months</strong> (or 10% for as long as both remain clients — set on the referral). Milestones advance automatically from the deal; payouts are recorded by hand here.
			</Callout>
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
				<Card padding="sm">
					<div className="text-2xs uppercase tracking-wide text-slate-500">Referred</div>
					<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{g.referrals.length}</div>
				</Card>
				<Card padding="sm">
					<div className="text-2xs uppercase tracking-wide text-slate-500">Closed</div>
					<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{g.referrals.filter((r) => r.status === 'closed').length}</div>
				</Card>
				<Card padding="sm">
					<div className="text-2xs uppercase tracking-wide text-slate-500">Commission due</div>
					<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCents(due)}</div>
				</Card>
				<Card padding="sm">
					<div className="text-2xs uppercase tracking-wide text-slate-500">My feedback</div>
					<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
						{myAvg ?? '—'}
						<span className="text-xs text-slate-500"> / 5 · {myFeedback.length}</span>
					</div>
				</Card>
			</div>
			<GrowthPanels codes={g.codes} referrals={g.referrals} payouts={g.payouts} feedback={g.feedback} reviews={g.reviews} staff={staffMap} staffList={staff} viewerId={profile.id} canManage={canManage} />
			<p className="mt-4 text-2xs text-slate-500">
				<Badge>spec §10</Badge> Each person sees their own feedback; the team summary feeds coaching and call scoring. Updated {formatRelative(new Date().toISOString())}.
			</p>
		</>
	);
}
