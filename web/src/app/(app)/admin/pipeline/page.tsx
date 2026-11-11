// /admin/pipeline — settings for the Pipeline tool (Alex, 2026-09-14:
// settings under Admin, the tool under Data). Connections each pipeline
// depends on (presence only), the import targets and their natural keys,
// and where the native builder's defaults will live.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { TARGETS } from '@/lib/imports/targets';

export const metadata = { title: 'Pipeline settings' };
export const dynamic = 'force-dynamic';

function present(name: string) {
	return !!process.env[name];
}

export default function PipelineAdminPage() {
	const connections = [
		{ name: 'AIRTABLE_PAT', purpose: 'Client Central / Client Media reads (contracts, opps, delivery tracker) and the Airtable import target.' },
		{ name: 'GOOGLE_SERVICE_ACCOUNT_JSON', purpose: 'CEO Metrics sheet sync into sheet_snapshots.' },
		{ name: 'APIFY_TOKEN', purpose: 'Lead scraper runs.' },
		{ name: 'N8N_API_URL', purpose: 'n8n workflows (Sessions ingest, client comms).' },
		{ name: 'SUPABASE_SERVICE_ROLE_KEY', purpose: 'Cron writers and the import engine.' },
	];
	return (
		<>
			<PageHeader
				title="Pipeline"
				description="Connections and targets behind the data pipelines. The pipelines themselves (what runs, last activity, run an import) are under Data → Pipeline."
				actions={<Link href="/data/pipeline" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Open the tool →</Link>}
			/>
			<div className="space-y-4">
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Connections</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">Set in Vercel (docs/ENV.md). Presence only — values are never shown.</p>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<tbody>
							{connections.map((c) => (
								<tr key={c.name} className="border-t border-slate-200 dark:border-slate-700">
									<td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{c.name}</td>
									<td className="px-3 py-2">{present(c.name) ? <Badge color="success">set</Badge> : <Badge color="warning">not set</Badge>}</td>
									<td className="px-3 py-2 text-slate-500">{c.purpose}</td>
								</tr>
							))}
						</tbody>
					</table>
					</div>
				</Card>

				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Import targets</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">Which tables the Imports wizard may write, and how it finds an existing row. Adding a target is a code change in <code>lib/imports/targets.ts</code> (allowlist by design).</p>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Target</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Natural key</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Columns</th>
							</tr>
						</thead>
						<tbody>
							{Object.values(TARGETS).map((t) => (
								<tr key={t.key} className="border-t border-slate-200 dark:border-slate-700">
									<td className="px-4 py-2 text-slate-900 dark:text-slate-100">{t.label}<span className="block text-2xs text-slate-600 dark:text-slate-400">{t.description}</span></td>
									<td className="px-3 py-2 text-slate-500">{t.naturalKeyLabel}</td>
									<td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.columns.length}</td>
								</tr>
							))}
							<tr className="border-t border-slate-200 dark:border-slate-700">
								<td className="px-4 py-2 text-slate-900 dark:text-slate-100">Airtable<span className="block text-2xs text-slate-600 dark:text-slate-400">Any table in an allowed base; columns come from the base schema.</span></td>
								<td className="px-3 py-2 text-slate-500">Record id or a chosen field</td>
								<td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
							</tr>
						</tbody>
					</table>
					</div>
				</Card>

				<Card className="space-y-1">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Native pipeline defaults</h2>
					<p className="text-xs text-slate-600 dark:text-slate-400">
						When the builder ships (WIP module 6): allowlisted tables and columns for write steps, per-rule daily run cap, and who may enable a rule (<code>can_manage_automations()</code>) are set here.
					</p>
				</Card>
			</div>
		</>
	);
}
