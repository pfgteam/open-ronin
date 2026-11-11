// /hiring — Talent Engine overview (0128, H1). Open roles, what is waiting
// on Alex, the 4R backfill state, and the phases still to land.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import ToolSettingsGear from '@/components/nav/ToolSettingsGear';
import RequestButton from '@/components/nav/RequestButton';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadHiringConfig, loadPositions } from '@/lib/hiring/server';
import { HIRE_BRAND_LABELS, POSITION_STATUS_COLORS, POSITION_STATUS_LABELS, type PositionStatus } from '@/lib/hiring/shared';
import { formatRelative } from '@/lib/format';
import NotAppliedCard from './NotAppliedCard';

export const metadata = { title: 'Hiring' };
export const dynamic = 'force-dynamic';

const PHASES = [
	['H1', 'Foundations: positions, 4R builder, PAP pay link, position requests, 4R backfill, consent', 'shipped'],
	['H2', 'Careers page + posting kit (Google Jobs JSON-LD, XML feed, tracked links, referrals, job alerts)', 'shipped'],
	['H3', 'Application builder + candidate app (sections, honeypots, timers, video, resume, AI-text detection)', 'shipped'],
	['H4', 'AI scoring + enrichment, Top-10 shortlist, admin dashboard', 'shipped'],
	['H5', 'Pipeline + interviews, scorecards, scheduling, reviewed comms, candidate portal', 'shipped'],
	['H6', 'Offer + NDA via DocuSeal, hire → profile + PAP + provisioning, talent pool', 'shipped'],
	['H7', 'Onboarding (60-day plan + 90-day framework), DISC, attendance tracker with PTO accruals', 'shipped'],
	['H8', 'Quality of hire dashboard', 'shipped'],
] as const;

export default async function HiringOverview() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadHiringConfig(supabase), hasCapability('manage_hiring')]);
	if (config.notApplied) return <NotAppliedCard />;
	const { positions } = await loadPositions(supabase, { status: 'active' });
	const [{ count: pendingRequests }, { count: pendingImports }, { count: pendingDrafts }] = await Promise.all([
		supabase.from('staff_requests').select('id', { count: 'exact', head: true }).eq('kind', 'position_request').eq('status', 'pending'),
		supabase.from('hire_four_r_imports').select('id', { count: 'exact', head: true }).in('status', ['pending', 'fetched']),
		supabase.from('hire_four_r_drafts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
	]);
	const byStatus = new Map<PositionStatus, number>();
	for (const p of positions) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);

	return (
		<>
			<PageHeader
				title="Hiring"
				description="Role planning → 4R → posting → applications → interviews → offer → hire → onboarding. People managers and execs."
				actions={
					<div className="flex gap-2">
						<ToolSettingsGear tool="/hiring" />
						<RequestButton label="Request a position" option="New position" variant="outline" />
						{canManage && (
							<Link href="/hiring/positions/new">
								<Button size="sm">+ New position</Button>
							</Link>
						)}
					</div>
				}
			/>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Stat label="Open roles" value={byStatus.get('open') ?? 0} href="/hiring/positions?status=open" />
				<Stat label="Awaiting Alex" value={pendingRequests ?? 0} href="/hiring/requests" hint="position requests" />
				<Stat label="Approved, not posted" value={byStatus.get('approved') ?? 0} href="/hiring/positions?status=approved" />
				<Stat label="4R backfill" value={(pendingImports ?? 0) + (pendingDrafts ?? 0)} href="/hiring/four-r" hint="docs + drafts waiting" />
			</div>

			<div className="mt-6 grid gap-4 lg:grid-cols-3">
				<Card className="lg:col-span-2 space-y-3">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Active positions</h2>
						<Link href="/hiring/positions" className="text-xs text-primary-600 hover:underline">
							All positions
						</Link>
					</div>
					{positions.length === 0 ? (
						<p className="text-sm text-slate-500">No positions yet. {canManage ? 'Build one, or ' : ''}file a position request and Alex approves it in the Innovation Desk pipeline.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{positions.slice(0, 12).map((p) => (
								<li key={p.id} className="py-2 flex items-center justify-between gap-3">
									<div className="min-w-0">
										<Link href={`/hiring/positions/${p.id}`} className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline truncate block">
											{p.title}
										</Link>
										<div className="text-2xs text-slate-500">
											{HIRE_BRAND_LABELS[p.brand]}
											{p.department_label ? ` · ${p.department_label}` : ''} · {p.headcount}× · updated {formatRelative(p.updated_at)}
										</div>
									</div>
									<Badge color={POSITION_STATUS_COLORS[p.status]}>{POSITION_STATUS_LABELS[p.status]}</Badge>
								</li>
							))}
						</ul>
					)}
				</Card>
				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Build plan</h2>
					<ul className="space-y-1.5">
						{PHASES.map(([k, label, state]) => (
							<li key={k} className="flex gap-2 text-xs">
								<Badge color={state === 'shipped' ? 'success' : state === 'next' ? 'primary' : 'default'}>{k}</Badge>
								<span className="text-slate-600 dark:text-slate-400">{label}</span>
							</li>
						))}
					</ul>
				</Card>
			</div>
			<Callout tone="info" className="mt-6">
				How a role gets hired: a people manager files a <strong>position request</strong> (role, brand, pay level × multiplier, posting budget). Alex approves it — that single approval covers the annual cost and the posting spend. The position becomes <em>approved</em>; an admin finishes the 4R in the builder and opens it. H2 publishes it to the careers page and the post kit.
			</Callout>
		</>
	);
}

function Stat({ label, value, href, hint }: { label: string; value: number; href: string; hint?: string }) {
	return (
		<Link href={href}>
			<Card className="hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors">
				<div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div>
				<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
				{hint && <div className="text-2xs text-slate-500">{hint}</div>}
			</Card>
		</Link>
	);
}
