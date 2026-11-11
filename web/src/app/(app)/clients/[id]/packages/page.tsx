// /clients/[id]/packages — every package this client holds as a tab with
// deliverables tracking (0136, F1). Flywheel programs link to /flywheel;
// PR reads the media-opps delivery board (the Delivery tab) so nothing is
// duplicated; SMM / Maintenance / custom rows live in client_deliverables.

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import { createClient } from '@/lib/supabase/server';
import { loadClientDeliverables, loadFlywheelConfig } from '@/lib/flywheel/server';
import { DELIVERABLE_STATUS_COLORS, DELIVERABLE_STATUS_LABELS, PROGRAM_STATUS_COLORS, PROGRAM_STATUS_LABELS, fmtCents } from '@/lib/flywheel/shared';
import { formatDate } from '@/lib/format';
import { requireClient } from '../_lib';
import { DeliverableForm } from '@/app/(app)/flywheel/[id]/Panels';

export const dynamic = 'force-dynamic';

export default async function PackagesTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pkg?: string }> }) {
	const { id } = await params;
	const sp = await searchParams;
	const ctx = await requireClient(id, '/packages');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <Callout tone="warning">Package tabs need migration 0136.</Callout>;
	const { programs, deliverables } = await loadClientDeliverables(supabase, ctx.clientId);
	// Tabs: one per package the client holds (from programs + contract package names + deliverable rows).
	const contractPkgs = (ctx.contracts ?? []).map((c) => (c.package ?? '').toLowerCase());
	const keys = new Set<string>();
	for (const p of programs) keys.add(p.package_key);
	for (const d of deliverables) keys.add(d.package_key);
	for (const t of config.packages) if (contractPkgs.some((n) => n.includes(t.key === 'flywheel' ? 'flywheel' : t.key === 'pr' ? 'pr' : t.key === 'smm' ? 'smm' : t.key))) keys.add(t.key);
	if (contractPkgs.some((n) => /growth|kickstarter|maintenance|pr|media/.test(n))) keys.add('pr');
	const tabs = config.packages.filter((t) => keys.has(t.key));
	const active = tabs.find((t) => t.key === sp.pkg) ?? tabs[0] ?? null;
	const myPrograms = programs.filter((p) => p.package_key === active?.key);
	const rows = deliverables.filter((d) => d.package_key === active?.key);

	return (
		<div className="space-y-4">
			{tabs.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500">No package tabs yet for this client. Start a program on <Link href="/flywheel/new" className="text-primary-600 hover:underline">/flywheel/new</Link> or add a deliverable below.</p>
				</Card>
			) : (
				<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
					{tabs.map((t) => (
						<Link key={t.key} href={`/clients/${ctx.clientId}/packages?pkg=${t.key}`} className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${active?.key === t.key ? 'border-primary-600 text-primary-900 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
							{t.label}
						</Link>
					))}
				</div>
			)}

			{active && (
				<>
					{myPrograms.map((p) => (
						<Card key={p.id}>
							<div className="flex items-start justify-between gap-3">
								<div>
									<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
										{active.label}
										{p.label ? ` · ${p.label}` : ''}
									</h2>
									<p className="text-xs text-slate-500">
										setup {fmtCents(p.setup_fee_cents)}{p.setup_paid_on ? ` (paid ${formatDate(p.setup_paid_on)})` : ''} · {fmtCents(p.monthly_fee_cents)}/mo{p.first_set_live_on ? ` from ${formatDate(p.first_set_live_on)}` : ' (billing not started)'}
										{p.kickoff_on ? ` · kickoff ${formatDate(p.kickoff_on)}` : ''}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Badge color={PROGRAM_STATUS_COLORS[p.status]}>{PROGRAM_STATUS_LABELS[p.status]}</Badge>
									<Link href={`/flywheel/${p.id}`}>
										<Button size="sm" variant="outline">
											Open program
										</Button>
									</Link>
								</div>
							</div>
						</Card>
					))}
					{active.uses_media_opps && (
						<Callout tone="info">
							PR deliverables are the media opportunities on the <Link href={`/clients/${ctx.clientId}/delivery`} className="underline">Delivery tab</Link> (pitched / secured / live, reach, pace vs goal). Rows below are extras (reports, calls).
						</Callout>
					)}
					{active.key === 'flywheel' && myPrograms.length === 0 && (
						<Callout tone="warning">
							This client has a Flywheel contract line but no program yet. <Link href="/flywheel/new" className="underline">Start it</Link>.
						</Callout>
					)}
					<Card>
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Deliverables · {active.label}</h3>
						<DeliverableForm clientId={ctx.clientId} programId={myPrograms[0]?.id ?? null} packageKey={active.key} kinds={active.deliverable_kinds} />
						<div className="mt-3">
							{rows.length === 0 ? (
								<p className="text-xs text-slate-500">Nothing tracked yet.</p>
							) : (
								<table className="w-full text-sm">
									<thead>
										<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
											<th className="py-1.5 pr-3">Month</th>
											<th className="py-1.5 pr-3">Kind</th>
											<th className="py-1.5 pr-3">Title</th>
											<th className="py-1.5 pr-3">Status</th>
											<th className="py-1.5 pr-3">Due</th>
											<th className="py-1.5">Delivered</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
										{rows.map((d) => (
											<tr key={d.id}>
												<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{d.period_month ? d.period_month.slice(0, 7) : '—'}</td>
												<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{d.kind}</td>
												<td className="py-1.5 pr-3 text-slate-900 dark:text-slate-100">{d.href ? <Link href={d.href} className="hover:underline">{d.title}</Link> : d.title}{!d.visible_to_client && <span className="ml-1 text-2xs text-slate-500">(internal)</span>}</td>
												<td className="py-1.5 pr-3"><Badge color={DELIVERABLE_STATUS_COLORS[d.status]}>{DELIVERABLE_STATUS_LABELS[d.status]}</Badge></td>
												<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{d.due_on ? formatDate(d.due_on) : '—'}</td>
												<td className="py-1.5 text-slate-600 dark:text-slate-400">{d.delivered_at ? formatDate(d.delivered_at) : '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</Card>
				</>
			)}
		</div>
	);
}
