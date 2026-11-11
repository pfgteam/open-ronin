// /flywheel — Delivery overview (0136, F1): every open program with its
// cluster tracker, what is behind, what is waiting on a client.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import ToolSettingsGear from '@/components/nav/ToolSettingsGear';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadPrograms } from '@/lib/flywheel/server';
import { MEMBER_ROLE_LABELS, PLAN_STATUS_COLORS, PLAN_STATUS_LABELS, PROGRAM_STATUS_COLORS, PROGRAM_STATUS_LABELS, clusterProgress } from '@/lib/flywheel/shared';
import { formatDate } from '@/lib/format';
import NotAppliedCard from './NotAppliedCard';

export const metadata = { title: 'Flywheel' };
export const dynamic = 'force-dynamic';

const PHASES = [
	['F1', 'Foundations: packages, programs, clusters, pages, citation ledger, facts, seed videos, client deliverables', 'shipped'],
	['F2', 'Onboarding: 64-task checklist, intake (form + conversational), discovery-call extract', 'planned'],
	['F3', 'AI visibility audit engine (Nous ~200-model panel, locked prompts, scoring, cost guard, trends)', 'planned'],
	['F4', 'Production pipeline + agents (Silas / Kira / Ava placeholders), approval lanes, execution rules, posting queue', 'planned'],
	['F5', 'Client portal (magic link): package tabs, approvals, requests, uploads, billing, Google connections', 'planned'],
	['F6', 'Comms + reporting: Friday recap, monthly report, welcome email, reminders + escalation', 'planned'],
	['F7', 'Health + alerts: behind-plan detection → Clients → Health, bells', 'planned'],
	['F8', 'Migration: MINT, FCU, Mama Bears, Northwind from the Sheets trackers', 'planned'],
] as const;

export default async function FlywheelOverview({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const programs = await loadPrograms(supabase, { status: sp.status === 'all' ? 'all' : 'open' });
	const ids = programs.map((p) => p.id);
	const [{ data: pages }, { data: citations }] = ids.length
		? await Promise.all([
				supabase.from('fw_pages').select('program_id, cluster_id, status, target_citations, citation_wave_due_at, citation_wave_done_at, live_at, auto_approve_at').in('program_id', ids),
				supabase.from('fw_citations').select('program_id, cluster_id, page_id, status').in('program_id', ids),
			])
		: [{ data: [] }, { data: [] }];
	type P = { program_id: string; cluster_id: string; status: 'live' | 'planned'; target_citations: number | null; citation_wave_due_at: string | null; citation_wave_done_at: string | null; live_at: string | null; auto_approve_at: string | null };
	type C = { program_id: string; cluster_id: string | null; page_id: string | null; status: 'posted' | 'planned' };
	const pg = (pages ?? []) as P[];
	const ct = (citations ?? []) as C[];
	const rows = programs.map((p) => {
		const oc = p.open_cluster;
		const prog = oc ? clusterProgress(oc, pg.filter((x) => x.cluster_id === oc.id), ct.filter((x) => x.cluster_id === oc.id)) : null;
		const awaiting = pg.filter((x) => x.program_id === p.id && x.status === ('awaiting_client' as string)).length + (oc?.plan_status === 'awaiting_client' ? 1 : 0);
		return { p, prog, awaiting };
	});
	const behind = rows.filter((r) => r.prog?.behind).length;
	const waiting = rows.reduce((s, r) => s + r.awaiting, 0);
	const strategistOf = (members: typeof programs[number]['members']) => members.find((m) => m.role === 'strategist')?.name ?? '—';

	return (
		<>
			<PageHeader
				title="Flywheel"
				description="Delivery system: programs → 90-day clusters → pages → citation waves. Scope of record = AEO Flywheel SOP (9/21)."
				actions={
					<div className="flex gap-2">
						<ToolSettingsGear tool="/flywheel" />
						<Link href={sp.status === 'all' ? '/flywheel' : '/flywheel?status=all'}>
							<Button variant="ghost" size="sm">
								{sp.status === 'all' ? 'Open only' : 'Include closed'}
							</Button>
						</Link>
						<Link href="/flywheel/new">
							<Button size="sm">+ New program</Button>
						</Link>
					</div>
				}
			/>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Stat label="Programs" value={programs.filter((p) => p.status !== 'closed').length} hint="onboarding + active + paused" />
				<Stat label="Behind plan" value={behind} hint="cluster lagging time or a wave past 72 h" tone={behind ? 'danger' : 'default'} />
				<Stat label="Waiting on a client" value={waiting} hint="plans + pages awaiting approval" tone={waiting ? 'warning' : 'default'} />
				<Stat label="Channels" value={config.channels.filter((c) => c.is_active).length} hint="8-channel citation template" />
			</div>

			<Card className="mt-6">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Cluster Tracker</h2>
				{rows.length === 0 ? (
					<p className="text-sm text-slate-500">No programs yet. Start one from a Flywheel contract line (MINT, FCU, Mama Bears) or the Northwind pilot.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
									<th className="py-1.5 pr-3">Client</th>
									<th className="py-1.5 pr-3">Status</th>
									<th className="py-1.5 pr-3">Strategist</th>
									<th className="py-1.5 pr-3">Cluster</th>
									<th className="py-1.5 pr-3">Plan</th>
									<th className="py-1.5 pr-3">Day</th>
									<th className="py-1.5 pr-3">Pages live</th>
									<th className="py-1.5 pr-3">Citations</th>
									<th className="py-1.5 pr-3">Re-audit</th>
									<th className="py-1.5">Flags</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{rows.map(({ p, prog, awaiting }) => (
									<tr key={p.id}>
										<td className="py-2 pr-3">
											<Link href={`/flywheel/${p.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
												{p.client_name}
											</Link>
											<div className="text-2xs text-slate-500">{config.packages.find((k) => k.key === p.package_key)?.label ?? p.package_key}{p.is_internal_pilot ? ' · internal pilot' : ''}</div>
										</td>
										<td className="py-2 pr-3">
											<Badge color={PROGRAM_STATUS_COLORS[p.status]}>{PROGRAM_STATUS_LABELS[p.status]}</Badge>
										</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{strategistOf(p.members)}</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{p.open_cluster ? `#${p.open_cluster.number} ${p.open_cluster.anchor_keyword ?? ''}` : '—'}</td>
										<td className="py-2 pr-3">{p.open_cluster ? <Badge color={PLAN_STATUS_COLORS[p.open_cluster.plan_status]}>{PLAN_STATUS_LABELS[p.open_cluster.plan_status]}</Badge> : '—'}</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{prog?.day != null ? `${prog.day}/${prog.days_total}` : '—'}</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{prog ? `${prog.pages_live}/${prog.pages_total}` : '—'}</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{prog ? `${prog.citations_shipped}/${prog.citations_target}` : '—'}</td>
										<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{p.open_cluster?.reaudit_due_on ? formatDate(p.open_cluster.reaudit_due_on) : '—'}</td>
										<td className="py-2 space-x-1">
											{prog?.behind && <Badge color="danger">Behind</Badge>}
											{(prog?.waves_overdue ?? 0) > 0 && <Badge color="danger">{prog!.waves_overdue} wave{prog!.waves_overdue === 1 ? '' : 's'} &gt; 72 h</Badge>}
											{awaiting > 0 && <Badge color="warning">{awaiting} awaiting client</Badge>}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>

			<div className="mt-6 grid gap-4 lg:grid-cols-3">
				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Roles per program</h2>
					<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
						{(['strategist', 'seo_tech', 'content', 'video', 'distribution', 'verifier'] as const).map((r) => (
							<li key={r}>
								<span className="font-medium text-slate-800 dark:text-slate-200">{MEMBER_ROLE_LABELS[r]}</span>
							</li>
						))}
					</ul>
					<p className="text-2xs text-slate-500">Chris = methodology + agents · Riley = Strategist + Flywheel lane · Gabi = Verifier.</p>
				</Card>
				<Card className="lg:col-span-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Build plan</h2>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{PHASES.map(([k, label, st]) => (
							<li key={k} className="py-1.5 flex items-center justify-between gap-3 text-xs">
								<span className="text-slate-700 dark:text-slate-300">
									<span className="font-mono text-slate-500 mr-2">{k}</span>
									{label}
								</span>
								<Badge color={st === 'shipped' ? 'success' : 'default'}>{st}</Badge>
							</li>
						))}
					</ul>
				</Card>
			</div>
		</>
	);
}

function Stat({ label, value, hint, tone = 'default' }: { label: string; value: number; hint?: string; tone?: 'default' | 'warning' | 'danger' }) {
	return (
		<Card padding="md">
			<p className="text-2xs uppercase tracking-wide text-slate-500">{label}</p>
			<p className={`text-2xl font-semibold ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
			{hint && <p className="text-2xs text-slate-500">{hint}</p>}
		</Card>
	);
}
