// /social/automations — Automations tool (Tools; Alex, 2026-09-14).
//
// The working half of "Automations": one inventory of everything that runs
// on a schedule or an event — the seven Vercel cron routes (with last run,
// status and duration from cron_runs, 0067) and n8n workflows when the API
// is connected. Native rules (WIP module 6, automation_rules) join the same
// table when that engine ships. Settings (connections, defaults) live in
// Admin -> Automations.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { formatRelative } from '@/lib/format';
import { loadAutomationsInventory, type AutomationRow } from '@/lib/automations/inventory';

export const metadata = { title: 'Automations' };
export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<AutomationRow['source'], string> = {
	vercel_cron: 'Vercel cron',
	n8n: 'n8n',
	native: 'Native rule',
	hermes: 'Hermes cron',
	external: 'External job',
};

function statusBadge(r: AutomationRow) {
	if (r.stale) return <Badge color="danger">stale</Badge>;
	if (r.lastStatus === 'ok') return <Badge color="success">ok</Badge>;
	if (r.lastStatus === 'error') return <Badge color="danger">error</Badge>;
	if (r.lastStatus === 'running') return <Badge color="primary">running</Badge>;
	return <Badge color="default">never logged</Badge>;
}

export default async function AutomationsToolPage() {
	const inv = await loadAutomationsInventory();
	const healthy = inv.rows.filter((r) => !r.stale && r.lastStatus !== 'error').length;

	return (
		<>
			<PageHeader
				title="Automations"
				description={`${inv.rows.length} scheduled or event-driven jobs · ${healthy} healthy · settings in Admin → Automations`}
				actions={<Link href="/admin/automations" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Settings →</Link>}
			/>
			<div className="space-y-4">
				{inv.n8n.state === 'not_connected' && (
					<Callout tone="info">
						n8n is not connected: set <code className="font-mono text-xs">{inv.n8n.envVar}</code> (Admin → Automations lists both variables) to list its workflows here.
					</Callout>
				)}
				{inv.n8n.state === 'error' && <Callout tone="warning">n8n could not be read: {inv.n8n.message}</Callout>}
				{inv.external.state === 'not_applied' && (
					<Callout tone="info">
						Hermes-side crons appear here once migration 0108 (external_jobs) is applied and each job posts to{' '}
						<code className="font-mono text-xs">/api/ingest/automations/heartbeat</code> from its last step.
					</Callout>
				)}
				{inv.external.state === 'ok' && inv.external.count === 0 && (
					<Callout tone="info">
						No Hermes cron has reported yet. Each job posts <code className="font-mono text-xs">{'{job_key, name, status}'}</code> to{' '}
						<code className="font-mono text-xs">/api/ingest/automations/heartbeat</code> with the ingest key; it then lists here with its last run and goes stale when it misses two intervals.
					</Callout>
				)}
				{inv.external.state === 'error' && <Callout tone="warning">External jobs could not be read: {inv.external.message}</Callout>}

				<Card padding="none" className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Automation</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Source</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Trigger</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Last run</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Duration</th>
								<th className="w-16" />
							</tr>
						</thead>
						<tbody>
							{inv.rows.map((r) => (
								<tr key={`${r.source}:${r.id}`} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top">
									<td className="px-4 py-2">
										<span className="text-slate-900 dark:text-slate-100">{r.name}</span>
										{r.source === 'vercel_cron' && <span className="block text-2xs text-slate-600 dark:text-slate-400 font-mono">{r.id}</span>}
										{r.lastError && <span className="block text-2xs text-red-600 dark:text-red-400 truncate max-w-md" title={r.lastError}>{r.lastError}</span>}
									</td>
									<td className="px-3 py-2 text-slate-500">{SOURCE_LABEL[r.source]}</td>
									<td className="px-3 py-2 text-slate-500">{r.trigger}{!r.active && <span className="text-2xs text-slate-600 dark:text-slate-400"> · inactive</span>}</td>
									<td className="px-3 py-2">{statusBadge(r)}</td>
									<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.lastRunAt ? formatRelative(r.lastRunAt) : '—'}</td>
									<td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.lastDurationMs != null ? `${(r.lastDurationMs / 1000).toFixed(1)}s` : '—'}</td>
									<td className="px-3 py-2 text-right">
										{r.href && <a href={r.href} target="_blank" rel="noreferrer" className="text-2xs text-primary-600 hover:underline">open ↗</a>}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Card>
				<p className="text-2xs text-slate-600 dark:text-slate-400">
					Enable / disable and Run now arrive with the native rule engine (Data → Pipeline); Vercel cron routes are driven by <code>web/vercel.json</code>, n8n workflows from n8n itself.
				</p>
			</div>
		</>
	);
}
