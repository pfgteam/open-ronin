// /data/pipeline — Pipeline tool (Alex, 2026-09-14, Part 5 item 22).
//
// Pipeline = pull -> transform -> push between systems. The top half is an
// honest map of the pipelines that already run in this app, each with its
// source, transform, sink and last activity, plus the entry points to run
// the manual ones (Imports wizard, sheet sync). The bottom half is the
// native rule builder (WORK_ENGINE_PLAN.md 1.4 / automation_rules v2):
// rules, run log, editor. Every run is a work_runs row too, so it shows in
// /admin/work-engine. Settings live in Admin -> Pipeline.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import ToolSettingsGear from '@/components/nav/ToolSettingsGear';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';
import { TARGETS } from '@/lib/imports/targets';
import { fetchCronSnapshot } from '@/lib/dev/cron';
import AutomationRules from './AutomationRules';

export const metadata = { title: 'Pipeline' };
export const dynamic = 'force-dynamic';

interface PipelineRow {
	name: string;
	source: string;
	transform: string;
	sink: string;
	trigger: string;
	lastAt: string | null;
	status: 'ok' | 'error' | 'idle' | 'manual';
	href: string | null;
	note?: string;
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ error?: string; edit?: string; run?: string }> }) {
	const sp = await searchParams;
	const supabase = await createClient();
	const [cron, { data: lastImport }, { data: lastSnapshot }] = await Promise.all([
		fetchCronSnapshot().catch(() => null),
		supabase.from('import_batches').select('created_at, target, status').order('created_at', { ascending: false }).limit(1).maybeSingle(),
		supabase.from('sheet_snapshots').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
	]);
	const routeHealth = (path: string) => cron?.routes.find((r) => r.route === path) ?? null;
	const fromRoute = (path: string): Pick<PipelineRow, 'lastAt' | 'status'> => {
		const r = routeHealth(path);
		if (!r || !r.lastStartedAt) return { lastAt: null, status: 'idle' };
		return { lastAt: r.lastStartedAt, status: r.lastStatus === 'error' || r.stale ? 'error' : 'ok' };
	};

	const rows: PipelineRow[] = [
		{
			name: 'CEO Metrics sheet → sheet_snapshots',
			source: 'Google Sheets (Daily / Weekly tabs)',
			transform: 'walkScoreboard: section / group / metric rows',
			sink: 'sheet_snapshots',
			trigger: 'every 10 minutes',
			lastAt: (lastSnapshot?.synced_at as string | undefined) ?? fromRoute('/api/cron/sheet-sync').lastAt,
			status: fromRoute('/api/cron/sheet-sync').status,
			href: '/api/cron/sheet-sync',
		},
		{
			name: 'The Work → metrics (computed)',
			source: 'projects, tasks, work_item_events',
			transform: 'compute_the_work_metrics() (0049)',
			sink: 'metrics (source the_work)',
			trigger: 'daily 15:15 UTC',
			...fromRoute('/api/cron/the-work-metrics'),
			href: '/api/cron/the-work-metrics',
		},
		{
			name: 'Airtable contracts → client health scores',
			source: 'Airtable Client Central',
			transform: 'compute_health_scores() (0042)',
			sink: 'client_health_scores + notifications',
			trigger: 'daily 09:30 UTC',
			...fromRoute('/api/cron/health-scores'),
			href: '/api/cron/health-scores',
		},
		{
			name: 'Apify scrapes → scraped_records',
			source: 'Apify (LinkedIn, B2B, trade show, acquisitions presets)',
			transform: 'normalise + dedupe, budget guard (0076)',
			sink: 'scraped_records → review queue → CSV',
			trigger: 'every 5 minutes (dispatcher)',
			...fromRoute('/api/cron/scrapers'),
			href: '/media/lead-scraper',
		},
		{
			name: 'Provider content jobs',
			source: 'content_jobs queue',
			transform: 'provider adapters (text / image / video)',
			sink: 'content_assets + Storage',
			trigger: 'every minute',
			...fromRoute('/api/cron/content-jobs'),
			href: '/admin/providers',
		},
		{
			name: 'n8n → Sessions ingest',
			source: 'n8n (call recordings, transcripts)',
			transform: 'AI analysis, suggested tasks',
			sink: 'calls, call_analyses, call_suggested_tasks',
			trigger: 'event: POST /api/ingest/sessions',
			lastAt: null,
			status: 'idle',
			href: '/team/sessions',
			note: 'Last activity is visible on Sessions itself.',
		},
		{
			name: 'CSV / XLSX → tables (Imports)',
			source: 'Uploaded file',
			transform: `auto-match headers, coerce, plan → apply → verify (${Object.values(TARGETS).map((t) => t.label).join(', ')}, Airtable)`,
			sink: 'the chosen target',
			trigger: 'manual (wizard)',
			lastAt: (lastImport?.created_at as string | undefined) ?? null,
			status: 'manual',
			href: '/data/imports',
		},
	];

	return (
		<>
			<PageHeader
				title="Pipeline"
				description="Pull → transform → push, everything that moves data in and out of Open Ronin. Settings and connections live in Admin → Pipeline."
				actions={<ToolSettingsGear tool="/data/pipeline" />}
			/>
			<div className="space-y-4">
				<Card padding="none" className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Pipeline</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Source</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Transform</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Sink</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Trigger</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Last</th>
								<th className="w-16" />
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.name} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top">
									<td className="px-4 py-2 text-slate-900 dark:text-slate-100">
										{r.name}
										{r.note && <span className="block text-2xs text-slate-600 dark:text-slate-400">{r.note}</span>}
									</td>
									<td className="px-3 py-2 text-slate-500">{r.source}</td>
									<td className="px-3 py-2 text-slate-500">{r.transform}</td>
									<td className="px-3 py-2 text-slate-500">{r.sink}</td>
									<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.trigger}</td>
									<td className="px-3 py-2 whitespace-nowrap">
										<span className="inline-flex items-center gap-1.5">
											<Badge color={r.status === 'ok' ? 'success' : r.status === 'error' ? 'danger' : 'default'}>{r.status}</Badge>
											<span className="text-slate-500">{r.lastAt ? formatRelative(r.lastAt) : '—'}</span>
										</span>
									</td>
									<td className="px-3 py-2 text-right">
										{r.href && (r.href.startsWith('/api/') ? <span className="text-2xs text-slate-600 dark:text-slate-400 font-mono">{r.href}</span> : <Link href={r.href} className="text-2xs text-primary-600 hover:underline">open</Link>)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Card>
				<AutomationRules error={sp.error ?? null} editId={sp.edit ?? null} runId={sp.run ?? null} />
			</div>
		</>
	);
}
