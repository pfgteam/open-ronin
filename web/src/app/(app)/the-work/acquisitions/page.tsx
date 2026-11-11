// /the-work/acquisitions — the Acquisitions module (0060 + 0107). The rollup
// target list in Mary's 28-column format, sorted on Donald's read path (gate
// pass, scorecard desc), plus the proposals queue where the five acquisitions
// identities' MCP writes wait for a human. Gated by the acquisitions
// capability (0060: grant only, no admin floor); RLS returns nothing to
// anyone else, and this page says so instead of rendering an empty table.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Lock, Target as TargetIcon } from 'lucide-react';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { businessToday, formatDate, formatRelative } from '@/lib/format';
import { redirect } from 'next/navigation';
import { TARGET_COLUMNS, TERMINAL_STATUSES, sortForReadPath, type TargetRow } from '@/lib/mcp/mappers/acquisitions';
import { ProposalDecide } from './Forms';

export const metadata = { title: 'Acquisitions' };
export const dynamic = 'force-dynamic';

type Proposal = {
	id: string;
	action_type: string;
	identity_slug: string;
	display_name: string | null;
	reasoning: string | null;
	payload: Record<string, unknown>;
	created_at: string;
	target_id: string | null;
	target_name: string | null;
};

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent'> = {
	identified: 'default', screened: 'default', contacted: 'primary', conversation: 'primary', nda: 'warning', loi: 'warning',
	diligence: 'warning', acquired: 'success', integrating: 'success', passed: 'danger', dead: 'danger',
};

const REC_COLOR: Record<string, 'success' | 'warning' | 'default'> = { escalate: 'success', nurture: 'warning', deprioritize: 'default' };

export default async function AcquisitionsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
	const { tab, view } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login?redirect=/the-work/acquisitions');
	const canView = await hasCapability('acquisitions');
	if (!canView) {
		return (
			<>
				<PageHeader title="Acquisitions" description="Rollup target pipeline" />
				<Card>
					<div className="text-center py-12 text-slate-500">
						<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
						<p className="text-sm">M&amp;A sourcing is need-to-know. Ask Alex for the acquisitions capability (Admin &rarr; Capabilities).</p>
					</div>
				</Card>
			</>
		);
	}

	const supabase = await createClient();
	const [{ data: targetRows, error: tErr }, { data: proposalRows, error: pErr }] = await Promise.all([
		supabase.from('acquisition_targets').select(TARGET_COLUMNS).returns<TargetRow[]>(),
		supabase.rpc('acquisition_pending_actions'),
	]);
	const notApplied = !!tErr && /target_ref|does not exist/.test(tErr.message);
	const today = businessToday();
	const all = notApplied ? [] : (targetRows ?? []);
	const showAll = view === 'all';
	const rows = sortForReadPath(showAll ? all : all.filter((r) => !TERMINAL_STATUSES.has(r.status)));
	const proposals = (pErr ? [] : ((proposalRows ?? []) as Proposal[]));
	const overdue = rows.filter((r) => r.next_action_on && r.next_action_on < today).length;
	const escalate = rows.filter((r) => r.recommendation === 'escalate').length;
	const activeTab = tab === 'proposals' ? 'proposals' : 'targets';

	return (
		<>
			<PageHeader
				title="Acquisitions"
				description={`${rows.length} ${showAll ? 'targets' : 'open targets'} · ${escalate} escalate · ${overdue} overdue next action · ${proposals.length} proposals waiting`}
			/>

			{notApplied && (
				<Callout tone="warning" className="mb-4">
					Migration 0107 (acquisitions module) is not applied yet. The 28-column fields, notes and the proposals queue appear once it is; until then the
					Lead Scraper export is the only view of acquisition_targets.
				</Callout>
			)}

			<div className="flex flex-wrap items-center gap-2 mb-4">
				<FilterChipLink href="/the-work/acquisitions" active={activeTab === 'targets'}>Targets</FilterChipLink>
				<FilterChipLink href="/the-work/acquisitions?tab=proposals" active={activeTab === 'proposals'} tone={proposals.length ? 'warning' : 'default'} count={proposals.length}>
					Proposals
				</FilterChipLink>
				{activeTab === 'targets' && (
					<>
						<span className="text-slate-300 dark:text-slate-600">·</span>
						<FilterChipLink href="/the-work/acquisitions" active={!showAll}>Open</FilterChipLink>
						<FilterChipLink href="/the-work/acquisitions?view=all" active={showAll}>All incl. passed/dead</FilterChipLink>
					</>
				)}
			</div>

			{activeTab === 'targets' ? (
				<Card padding="none">
					{rows.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-8">
							No targets yet. Approve acquisition rows from the <Link href="/media/lead-scraper?mode=acquisition" className="text-primary-600 hover:underline">Lead Scraper</Link>, or let deal_sourcing propose one over MCP.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-700/60">
									<tr>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Ref</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Company</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Status</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Gate</th>
										<th className="text-right text-xs font-medium text-slate-500 px-3 py-2">Score</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Rec.</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Rev / EBITDA</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Warmth</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Next action</th>
										<th className="text-left text-xs font-medium text-slate-500 px-3 py-2">Last touch</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((r) => {
										const isOverdue = !!r.next_action_on && r.next_action_on < today && !TERMINAL_STATUSES.has(r.status);
										return (
											<tr key={r.id} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
												<td className="px-3 py-2 font-mono text-2xs text-slate-500">{r.target_ref ?? '—'}</td>
												<td className="px-3 py-2">
													<Link href={`/the-work/acquisitions/${r.id}`} className="text-slate-900 dark:text-slate-100 font-medium hover:text-primary-600 transition-colors">
														{r.company_name}
													</Link>
													<div className="text-2xs text-slate-500">
														{[r.vertical, [r.city, r.state].filter(Boolean).join(', ') || null, r.employee_count ? `${r.employee_count} staff` : null].filter(Boolean).join(' · ')}
													</div>
												</td>
												<td className="px-3 py-2"><Badge color={STATUS_COLOR[r.status] ?? 'default'}>{r.status}</Badge></td>
												<td className="px-3 py-2">
													{r.hard_gate ? <Badge color={r.hard_gate === 'pass' ? 'success' : 'danger'}>{r.hard_gate}</Badge> : <span className="text-slate-400 text-2xs">unscreened</span>}
												</td>
												<td className="px-3 py-2 text-right tabular-nums">{r.scorecard_total ?? <span className="text-slate-400">—</span>}</td>
												<td className="px-3 py-2">{r.recommendation ? <Badge color={REC_COLOR[r.recommendation]}>{r.recommendation}</Badge> : '—'}</td>
												<td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-2xs">
													{r.est_revenue ?? '—'} / {r.est_ebitda ?? '—'}
													{r.financial_confidence && <span className="text-slate-400"> · {r.financial_confidence}</span>}
												</td>
												<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">{r.relationship_warmth?.replace(/_/g, ' ') ?? '—'}</td>
												<td className="px-3 py-2 text-2xs">
													{r.next_action ? (
														<>
															<span className={isOverdue ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}>{r.next_action}</span>
															{r.next_action_on && <span className="text-slate-500"> · {formatDate(r.next_action_on)}</span>}
														</>
													) : (
														<Badge color="warning" className="text-2xs">blank</Badge>
													)}
												</td>
												<td className="px-3 py-2 text-2xs text-slate-500">{r.last_touch_on ? formatDate(r.last_touch_on) : '—'}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			) : (
				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
						<TargetIcon className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Proposals from the acquisitions identities</h2>
						<span className="text-2xs text-slate-500">approve applies the write under your name; reject records why</span>
					</div>
					{proposals.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-8">Nothing waiting.</p>
					) : (
						<ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
							{proposals.map((p) => (
								<li key={p.id} className="px-3 py-3 space-y-2">
									<div className="flex flex-wrap items-center gap-2 text-sm">
										<Badge color="primary">{p.display_name ?? p.identity_slug}</Badge>
										<span className="font-mono text-2xs text-slate-500">{p.action_type}</span>
										{p.target_id && (
											<Link href={`/the-work/acquisitions/${p.target_id}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600">
												{p.target_name ?? p.target_id}
											</Link>
										)}
										<span className="text-2xs text-slate-500">{formatRelative(p.created_at)}</span>
									</div>
									{p.reasoning && <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{p.reasoning}</p>}
									<pre className="text-2xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-2 overflow-x-auto max-h-48">
										{JSON.stringify(p.payload.patch ?? p.payload.row ?? p.payload, null, 2)}
									</pre>
									<ProposalDecide actionId={p.id} />
								</li>
							))}
						</ul>
					)}
				</Card>
			)}
		</>
	);
}
