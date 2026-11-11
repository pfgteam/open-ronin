// /admin/lead-scraper: the settings the Lead Scraper page reads (0072).
//
// Default preset, default max_results, cost per 1,000 rows per preset, the
// monthly budget cap, the Apify token presence check, and the last 30 days of
// spend from scrape_jobs. Admin only (the /admin ModuleGate; RLS on
// scraper_settings is admin write, scraper users read).
//
// Until 2026-09-12 this URL was a permanent redirect to /media/lead-scraper,
// kept for bookmarks and for hrefs stored in `notifications` before the tool
// moved. Production holds zero such notification rows, but a bookmarked run
// still carries ?job= or ?mode=, so those requests keep redirecting; a bare
// visit is the settings page.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import { getScraperConfig, PRESET_LABELS, usd, type ScraperPreset } from '@/lib/scrapers/settings';
import { formatDate } from '@/lib/format';
import SettingsForm from './SettingsForm';

export const metadata = { title: 'Lead Scraper settings' };
export const dynamic = 'force-dynamic';

interface CostRow {
	id: string;
	kind: string;
	preset: string;
	status: string;
	max_results: number;
	found: number;
	imported: number;
	created_at: string;
	estimated_usd: number | string | null;
}

export default async function LeadScraperSettingsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const sp = await searchParams;
	if (sp.job !== undefined || sp.mode !== undefined) {
		const qs = new URLSearchParams();
		for (const [key, value] of Object.entries(sp)) {
			if (Array.isArray(value)) for (const v of value) qs.append(key, v);
			else if (value !== undefined) qs.append(key, value);
		}
		redirect(`/media/lead-scraper?${qs.toString()}`);
	}

	const config = await getScraperConfig();
	const supabase = await createClient();
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	const { data: costRows } = config.applied
		? await supabase
				.from('v_scrape_job_costs')
				.select('id, kind, preset, status, max_results, found, imported, created_at, estimated_usd')
				.gte('created_at', since)
				.order('created_at', { ascending: false })
		: { data: [] as CostRow[] };
	const rows = (costRows ?? []) as CostRow[];
	const total30 = rows.reduce((s, r) => s + Number(r.estimated_usd ?? 0), 0);
	const byPreset = new Map<string, { runs: number; rowsFound: number; usd: number }>();
	for (const r of rows) {
		const cur = byPreset.get(r.preset) ?? { runs: 0, rowsFound: 0, usd: 0 };
		cur.runs += 1;
		cur.rowsFound += r.found;
		cur.usd += Number(r.estimated_usd ?? 0);
		byPreset.set(r.preset, cur);
	}

	const apifyConfigured = !!process.env.APIFY_TOKEN;
	const { budget } = config;

	return (
		<>
			<PageHeader
				title="Lead Scraper settings"
				description="Defaults, per preset cost and the monthly budget cap the scraper runs under"
				actions={
					<Link href="/media/lead-scraper" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
						Open the Lead Scraper
					</Link>
				}
			/>

			<div className="space-y-4">
				{!config.applied && (
					<Callout tone="warning">
						Migration <code>0072_brand_settings.sql</code> is not applied yet. The form shows the
						defaults, spend is unavailable and saving will fail until it is.
					</Callout>
				)}

				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<p className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Apify token</p>
						<div className="mt-1 flex items-center gap-2">
							<span className={`w-1.5 h-1.5 rounded-full ${apifyConfigured ? 'bg-green-500' : 'bg-red-500'}`} />
							<span className="text-sm text-slate-900 dark:text-slate-100">
								{apifyConfigured ? 'Present on this environment' : 'Missing: APIFY_TOKEN'}
							</span>
						</div>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">Set in Vercel; the cron refuses to run without it.</p>
					</Card>
					<Card>
						<p className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Month to date</p>
						<p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">{usd(budget.spentUsd)}</p>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">Estimated from scrape_jobs, UTC month.</p>
					</Card>
					<Card>
						<p className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Monthly cap</p>
						<p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
							{budget.monthlyBudgetUsd === null ? 'None' : usd(budget.monthlyBudgetUsd)}
						</p>
						<div className="mt-1">
							{budget.overCap ? (
								<Badge color="danger">Dispatch held</Badge>
							) : budget.monthlyBudgetUsd === null ? (
								<span className="text-2xs text-slate-600 dark:text-slate-400">Uncapped</span>
							) : (
								<span className="text-2xs text-slate-600 dark:text-slate-400">{usd(budget.remainingUsd ?? 0)} remaining</span>
							)}
						</div>
					</Card>
					<Card>
						<p className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Last 30 days</p>
						<p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">{usd(total30)}</p>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">{rows.length} runs</p>
					</Card>
				</div>

				{budget.overCap && (
					<Callout tone="error">
						Month to date spend ({usd(budget.spentUsd)}) has reached the cap (
						{usd(budget.monthlyBudgetUsd ?? 0)}). Queued jobs stay queued until the cap is raised
						or the month rolls over; the reason is shown on each held run on the Lead Scraper page.
					</Callout>
				)}

				<div className="grid gap-4 lg:grid-cols-5">
					<div className="lg:col-span-3">
						<SettingsForm settings={config.settings} applied={config.applied} spentUsd={budget.spentUsd} />
					</div>

					<div className="lg:col-span-2 space-y-4">
						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Spend by preset</h2>
								<span className="text-2xs text-slate-600 dark:text-slate-400">last 30 days</span>
							</div>
							{byPreset.size === 0 ? (
								<p className="px-3 py-4 text-sm text-slate-500">No runs in the last 30 days.</p>
							) : (
								<div className="overflow-x-auto">
								<table className="w-full text-xs">
									<thead className="bg-slate-50/80 dark:bg-slate-900/30">
										<tr>
											<th className="text-left px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Preset</th>
											<th className="text-right px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Runs</th>
											<th className="text-right px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Rows</th>
											<th className="text-right px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Est. USD</th>
										</tr>
									</thead>
									<tbody>
										{[...byPreset.entries()]
											.sort((a, b) => b[1].usd - a[1].usd)
											.map(([preset, v]) => (
												<tr key={preset} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
													<td className="px-3 py-1.5 text-slate-900 dark:text-slate-100">{PRESET_LABELS[preset as ScraperPreset] ?? preset}</td>
													<td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{v.runs}</td>
													<td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{v.rowsFound.toLocaleString()}</td>
													<td className="px-3 py-1.5 text-right tabular-nums text-slate-900 dark:text-slate-100">{usd(v.usd)}</td>
												</tr>
											))}
									</tbody>
								</table>
								</div>
							)}
						</Card>

						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Runs</h2>
								<span className="text-2xs text-slate-600 dark:text-slate-400">last 30 days, newest first</span>
							</div>
							{rows.length === 0 ? (
								<p className="px-3 py-4 text-sm text-slate-500">Nothing yet.</p>
							) : (
								<ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-96 overflow-y-auto">
									{rows.map((r) => (
										<li key={r.id} className="px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover transition-colors">
											<span className={`w-1.5 h-1.5 rounded-full ${r.status === 'done' ? 'bg-green-500' : r.status === 'failed' ? 'bg-red-500' : r.status === 'cancelled' ? 'bg-slate-300 dark:bg-slate-600' : 'bg-primary-500'}`} />
											<Link href={`/media/lead-scraper?job=${r.id}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600 transition-colors">
												{PRESET_LABELS[r.preset as ScraperPreset] ?? r.preset}
											</Link>
											<span className="text-2xs text-slate-600 dark:text-slate-400">{r.status}</span>
											<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{r.found.toLocaleString()} of {r.max_results.toLocaleString()}</span>
											<span className="ml-auto text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{formatDate(r.created_at)}</span>
											<span className="text-xs tabular-nums text-slate-900 dark:text-slate-100 w-16 text-right">{usd(Number(r.estimated_usd ?? 0))}</span>
										</li>
									))}
								</ul>
							)}
						</Card>
					</div>
				</div>
			</div>
		</>
	);
}
