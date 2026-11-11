// /admin/work-engine — the one queue (WORK_ENGINE_PLAN.md 1.3).
//
// Every work_runs row across scrapers, content jobs, imports, staff requests
// and automations, with "Waiting on someone" as the headline filter: oldest
// first, act without leaving the page. Actions route through each domain's
// own write (actions.ts); this page never re-implements an approval rule.
//
// Reads through the session client, so RLS decides: managers see all, a
// requester sees their own, a reviewer sees their group's. Before 0099 is
// applied the table is missing and the page says so in a Callout.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import FilterChipLink from '@/components/ui/FilterChipLink';
import { getAuthProfile } from '@/lib/supabase/server';
import { getCapabilities } from '@/lib/permissions/capabilities';
import { formatRelative } from '@/lib/format';
import { fetchCronSnapshot } from '@/lib/dev/cron';
import {
	DOMAIN_LABELS,
	SOURCE_HREFS,
	STATUS_DOT,
	STATUS_LABELS,
	WORK_DOMAINS,
	availableActions,
	formatAge,
	parseFilters,
	readWorkEngine,
	type WorkDomain,
	type WorkEngineSummaryRow,
	type WorkRunRow,
} from '@/lib/work-engine/server';
import { actOnWorkRun } from './actions';

export const metadata = { title: 'Work Engine' };
export const dynamic = 'force-dynamic';

const PATH = '/admin/work-engine';

function th(label: string, right = false) {
	return <th className={`${right ? 'text-right' : 'text-left'} text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2`}>{label}</th>;
}

function hrefWith(current: URLSearchParams, key: string, value: string | null): string {
	const next = new URLSearchParams(current);
	next.delete('error');
	if (value === null) next.delete(key);
	else next.set(key, value);
	const qs = next.toString();
	return qs ? `${PATH}?${qs}` : PATH;
}

function countWhere(summary: WorkEngineSummaryRow[], pred: (r: WorkEngineSummaryRow) => boolean): number {
	return summary.filter(pred).reduce((n, r) => n + r.runs, 0);
}

function openHref(run: WorkRunRow): string | null {
	if (run.source_table && run.source_id) return SOURCE_HREFS[run.source_table]?.(run.source_id) ?? null;
	return null;
}

export default async function WorkEnginePage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const me = await getAuthProfile();
	if (!me) redirect(`/auth/login?redirect=${PATH}`);
	const caps = await getCapabilities();
	const canManage = caps.has('manage_work_engine');

	const params = await searchParams;
	const filters = parseFilters(params);
	const errorMsg = typeof params.error === 'string' ? params.error : null;
	const current = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && k !== 'error') current.set(k, v);

	const [{ runs, summary, names, clients, unavailable }, cron] = await Promise.all([
		readWorkEngine(filters),
		canManage ? fetchCronSnapshot() : Promise.resolve(null),
	]);

	const waitingTotal = countWhere(summary, (r) => r.status === 'waiting_approval');
	const openTotal = countWhere(summary, (r) => ['queued', 'running', 'waiting_approval', 'approved'].includes(r.status));
	const failedTotal = countWhere(summary, (r) => r.status === 'failed');
	const domainsPresent = WORK_DOMAINS.filter((d) => summary.some((r) => r.domain === d));
	const returnTo = current.toString() ? `${PATH}?${current.toString()}` : PATH;
	const staleCron = cron?.routes.filter((r) => r.stale || r.lastStatus === 'error') ?? [];

	return (
		<>
			<PageHeader
				title="Work Engine"
				description={
					canManage
						? `${waitingTotal} waiting on a person, ${openTotal} open, ${failedTotal} failed — every job and approval across the app in one queue.`
						: 'Your jobs and the approvals your reviewer groups own.'
				}
				actions={
					<Link href="/data/pipeline" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
						Automations →
					</Link>
				}
			/>

			{unavailable && (
				<Callout tone="warning" className="mb-4">
					Migration 0099 (work_runs) is not applied yet, so there is nothing to show. Until then each domain keeps its own page: Lead Scraper, Providers, Imports, Innovation Desk.
				</Callout>
			)}
			{errorMsg && (
				<Callout tone="error" className="mb-4">
					{errorMsg}
				</Callout>
			)}

			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-2">
					<FilterChipLink href={hrefWith(current, 'status', 'waiting')} active={filters.status === 'waiting'} tone="warning" count={waitingTotal}>
						Waiting on someone
					</FilterChipLink>
					<FilterChipLink href={hrefWith(current, 'status', 'open')} active={filters.status === 'open'} count={openTotal}>
						Open
					</FilterChipLink>
					<FilterChipLink href={hrefWith(current, 'status', 'failed')} active={filters.status === 'failed'} count={failedTotal}>
						Failed
					</FilterChipLink>
					<FilterChipLink href={hrefWith(current, 'status', null)} active={!filters.status}>
						All
					</FilterChipLink>
					<span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
					<FilterChipLink href={hrefWith(current, 'domain', null)} active={!filters.domain}>
						Every domain
					</FilterChipLink>
					{domainsPresent.map((d) => (
						<FilterChipLink
							key={d}
							href={hrefWith(current, 'domain', d)}
							active={filters.domain === d}
							count={countWhere(summary, (r) => r.domain === d && (filters.status === 'waiting' ? r.status === 'waiting_approval' : true))}
						>
							{DOMAIN_LABELS[d as WorkDomain]}
						</FilterChipLink>
					))}
					{(filters.requestedBy || filters.clientId) && (
						<Link href={hrefWith(new URLSearchParams(current.toString().replace(/&?(requester|client)=[^&]*/g, '')), 'x', null)} className="text-xs text-slate-500 hover:underline">
							Clear person/client
						</Link>
					)}
				</div>

				<Card padding="none" className="overflow-hidden">
					<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
						<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
							{filters.status === 'waiting' ? 'Waiting on someone, oldest first' : 'Runs'}
						</span>
						<span className="text-xs tabular-nums text-slate-400">{runs.length}</span>
						<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									{th('Age')}
									{th('Status')}
									{th('Domain')}
									{th('What')}
									{th('Requested by')}
									{th('Client')}
									{th('Approver')}
									{th('Cost', true)}
									{th('')}
								</tr>
							</thead>
							<tbody>
								{runs.length === 0 && (
									<tr>
										<td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
											{unavailable ? 'Nothing to show until 0099 is applied.' : filters.status === 'waiting' ? 'Nobody is waiting on you. Nothing needs a human right now.' : 'No runs match these filters.'}
										</td>
									</tr>
								)}
								{runs.map((run) => {
									const actions = availableActions(run);
									const open = openHref(run);
									const requester = run.requested_via === 'mcp' ? `agent (${String(run.payload.consumer_slug ?? 'mcp')})` : run.requested_via === 'cron' ? 'Schedule' : run.requested_via === 'system' ? 'System' : (run.requested_by ? names.get(run.requested_by) : null) ?? 'System';
									return (
										<tr key={run.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top">
											<td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap tabular-nums" title={formatRelative(run.created_at)}>
												{formatAge(run.created_at)}
											</td>
											<td className="px-4 py-2 whitespace-nowrap">
												<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
													<span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[run.status] ?? 'bg-slate-400'}`} />
													{STATUS_LABELS[run.status] ?? run.status}
												</span>
											</td>
											<td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{DOMAIN_LABELS[run.domain] ?? run.domain}</td>
											<td className="px-4 py-2 text-xs text-slate-800 dark:text-slate-200 max-w-md">
												<div className="truncate" title={run.title ?? run.kind}>
													{run.title ?? run.kind}
												</div>
												<div className="text-2xs text-slate-500 font-mono truncate">{run.kind}</div>
												{run.error && (
													<div className="text-2xs text-red-600 dark:text-red-400 truncate" title={run.error}>
														{run.error}
													</div>
												)}
											</td>
											<td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
												{run.requested_by ? (
													<Link href={hrefWith(current, 'requester', run.requested_by)} className="hover:underline">
														{requester}
													</Link>
												) : (
													requester
												)}
											</td>
											<td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
												{run.client_id ? (
													<Link href={hrefWith(current, 'client', run.client_id)} className="hover:underline">
														{clients.get(run.client_id) ?? '…'}
													</Link>
												) : (
													''
												)}
											</td>
											<td className="px-4 py-2 text-2xs text-slate-500 whitespace-nowrap">
												{run.status === 'waiting_approval'
													? run.approver_group ?? (run.source_table === 'scrape_jobs' ? 'scraper reviewers' : '')
													: run.approved_by
														? `${run.status === 'rejected' ? 'by' : 'by'} ${names.get(run.approved_by) ?? '…'}`
														: ''}
											</td>
											<td className="px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap">{run.cost_usd !== null ? `$${Number(run.cost_usd).toFixed(3)}` : ''}</td>
											<td className="px-4 py-2 text-right whitespace-nowrap">
												<div className="inline-flex items-center gap-1">
													{actions
														.filter((a) => a !== 'open')
														.map((a) => (
															<form key={a} action={actOnWorkRun}>
																<input type="hidden" name="id" value={run.id} />
																<input type="hidden" name="action" value={a} />
																<input type="hidden" name="return_to" value={returnTo} />
																<Button size="sm" variant={a === 'approve' ? 'primary' : a === 'reject' ? 'outline' : 'ghost'} type="submit">
																	{a === 'approve' ? 'Approve' : a === 'reject' ? 'Reject' : a === 'cancel' ? 'Cancel' : 'Retry'}
																</Button>
															</form>
														))}
													{open && (
														<Link href={open} className="text-xs text-primary-600 dark:text-primary-400 hover:underline px-1">
															Open
														</Link>
													)}
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</Card>

				{cron && (
					<Card padding="none" className="overflow-hidden">
						<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
							<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Schedules</span>
							<span className="text-xs tabular-nums text-slate-400">{cron.routes.length}</span>
							<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
							<span className="text-2xs text-slate-500">{staleCron.length === 0 ? 'all healthy' : `${staleCron.length} need attention`}</span>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-xs">
								<tbody>
									{cron.routes.map((r) => (
										<tr key={r.route} className="border-t border-slate-200 dark:border-slate-700">
											<td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{r.route}</td>
											<td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{r.schedule}</td>
											<td className="px-3 py-2 whitespace-nowrap">
												<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
													<span className={`w-1.5 h-1.5 rounded-full ${r.lastStatus === 'error' || r.stale ? 'bg-red-500' : r.lastStatus === 'ok' ? 'bg-green-500' : 'bg-slate-400'}`} />
													{r.stale ? 'stale' : (r.lastStatus ?? 'never')}
												</span>
											</td>
											<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.lastStartedAt ? formatRelative(r.lastStartedAt) : ''}</td>
											<td className="px-3 py-2 text-2xs text-red-600 dark:text-red-400 max-w-xs truncate" title={r.lastError ?? undefined}>
												{r.lastError ?? ''}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Card>
				)}
			</div>
		</>
	);
}
