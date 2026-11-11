// /dashboard/metrics — KPIs (renamed from "Metrics Board", Alex 2026-09-14).
//
// Copies the CEO Metrics Daily sheet's format: every section of the Daily
// tab in sheet order (Marketing, Lead Gen, Sales, Social, Finances, CRM,
// Media, Podcasts, Influencers), each row with yesterday, Δ vs the day
// before, the week, Δ weekly, and a sparkline — the same MetricTable the
// department dashboards use, so a KPI reads identically here and on its
// department page. Weekly-only sections ride along as "(weekly)" groups.
//
// Editable and linkable:
//   - a row whose name matches a catalog definition (metric_definitions,
//     matched on name or on the 0082 sheet_definition) carries an "edit"
//     link to Admin -> Metrics, where the calculation, source of truth and
//     surfaces live;
//   - every row carries a "sheet" link straight to the Daily tab;
//   - ?section= deep-links a single sheet section; the catalog's `kpis`
//     surface tag (0082) adds app-native definitions in a "From the catalog"
//     group with their monthly team/company value from `metrics`.
//
// This is INPUTS_REPORTS_MODULE_SPEC.md's read side for the Daily grain,
// reconciled rather than duplicated: the spec's /inputs (typing numbers) and
// v_metric_rollup (0077) are not built here. When 0077 lands, the rows that
// have an app source swap in by the spec's precedence rule; the sheet read
// stays the fallback until then. The per-person monthly board this page
// used to be moved to /team/metrics (Team -> Metrics), where it belongs.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import FilterChipLink from '@/components/ui/FilterChipLink';
import MetricTable from '@/components/dashboard/MetricTable';
import PeriodTabs from '@/components/dashboard/PeriodTabs';
import { buildSheetSections } from '@/lib/dashboard/sheetCatalog';
import type { DashboardPeriod } from '@/lib/dashboard/layout';
import { getSheetMetrics } from '@/lib/metrics/sheets';
import { DAILY_TAB } from '@/lib/metrics/daily';
import { getSpreadsheetId, norm } from '@/lib/metrics/sheetsClient';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { surfacesOf } from '@/lib/metrics/surfaces';
import { redirect } from 'next/navigation';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'KPIs' };
export const dynamic = 'force-dynamic';

interface DefLite {
	key: string;
	name: string;
	unit: string | null;
	source: string;
	surfaces?: string[] | null;
	sheet_definition?: string | null;
	sheet_source_of_truth?: string | null;
	calc_notes?: string | null;
}

// Sheet order for the Daily tab (docs/metrics/ceo_sheet_audit.csv). Sections
// the sheet gains later land at the end in the order they appear.
const DAILY_ORDER = ['Marketing', 'Lead Gen', 'Sales', 'Social', 'Finances', 'CRM', 'Media', 'Podcasts', 'Influencers'];

function orderSections(names: string[]): string[] {
	const known = DAILY_ORDER.filter((s) => names.some((n) => norm(n) === norm(s)));
	const rest = names.filter((n) => !DAILY_ORDER.some((s) => norm(s) === norm(n)));
	return [...known, ...rest];
}

export default async function KpisPage({
	searchParams,
}: {
	searchParams: Promise<{ period?: string; section?: string; month?: string }>;
}) {
	const [sp, profile] = await Promise.all([searchParams, getAuthProfile()]);
	if (!profile) redirect('/auth/login');
	const period: DashboardPeriod = sp?.period === 'weekly' ? 'weekly' : 'daily';

	const supabase = await createClient();
	const [{ weekly, daily }, { data: defRows }] = await Promise.all([
		getSheetMetrics(),
		supabase.from('metric_definitions').select('*').eq('is_active', true).order('sort'),
	]);
	const defs = (defRows ?? []) as DefLite[];

	// Every Daily section, in sheet order; weekly sections that have no daily
	// twin (Hiring, Design, MVP, Operations, Writing) come along as weekly-only.
	const dailySections = orderSections([...new Set(daily.rows.map((r) => r.section))]);
	const weeklyOnlyNames = [...new Set(weekly.rows.map((r) => r.section))].filter(
		(w) => !dailySections.some((d) => norm(d) === norm(w) || norm(w).startsWith(norm(d))),
	);
	const wantedSection = sp?.section && dailySections.some((s) => norm(s) === norm(sp.section as string)) ? (sp.section as string) : null;

	const sheetOpts = {
		daily,
		weekly,
		period,
		sections: wantedSection ? [wantedSection] : dailySections,
		weeklySections: wantedSection
			? [wantedSection, wantedSection === 'Media' ? 'Media Relations' : wantedSection]
			: [...dailySections, 'Media Relations', ...weeklyOnlyNames],
	};
	const sections = buildSheetSections(sheetOpts);

	// Link sheet rows to catalog definitions by name (case/space-insensitive),
	// then by the 0082 sheet_definition text when the sheet label lives there.
	const defByName = new Map<string, DefLite>();
	for (const d of defs) {
		defByName.set(norm(d.name), d);
		if (d.sheet_definition) defByName.set(norm(d.sheet_definition), d);
	}
	const sheetHref = `https://docs.google.com/spreadsheets/d/${getSpreadsheetId()}/edit#gid=${DAILY_TAB.sheetId}`;
	const linked = sections.map((s) => ({
		...s,
		rows: s.rows.map((r) => {
			const bare = r.label.includes(' · ') ? r.label.split(' · ').pop() ?? r.label : r.label;
			const def = defByName.get(norm(r.label)) ?? defByName.get(norm(bare));
			return {
				...r,
				editHref: def ? `/admin/metrics?edit=${encodeURIComponent(def.key)}` : null,
				sheetHref,
				sourceNote: def?.sheet_source_of_truth ?? null,
			};
		}),
	}));
	const linkedCount = linked.reduce((n, s) => n + s.rows.filter((r) => r.editHref).length, 0);
	const rowCount = linked.reduce((n, s) => n + s.rows.length, 0);

	// Catalog definitions tagged for this page (0082), with this month's
	// team/company-level values from `metrics` (subject_type team/client).
	const kpiDefs = defs.filter((d) => surfacesOf(d).includes('kpis'));
	const now = new Date();
	const month = /^\d{4}-\d{2}$/.test(sp?.month ?? '') ? (sp!.month as string) : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
	const { data: kpiValues } = kpiDefs.length
		? await supabase
				.from('metrics')
				.select('metric_key, subject_type, subject_ref, value, goal, source')
				.in('metric_key', kpiDefs.map((d) => d.key))
				.eq('period', `${month}-01`)
				.neq('subject_type', 'user')
		: { data: [] as { metric_key: string; subject_type: string; subject_ref: string | null; value: number | null; goal: number | null; source: string }[] };
	const valuesByKey = new Map<string, NonNullable<typeof kpiValues>>();
	for (const v of kpiValues ?? []) {
		const list = valuesByKey.get(v.metric_key) ?? [];
		list.push(v);
		valuesByKey.set(v.metric_key, list);
	}
	const dayPending = !daily.hasRequestedDay;

	return (
		<>
			<PageHeader
				title="KPIs"
				description={`${rowCount} KPIs across ${linked.length} sections, in the CEO Metrics sheet's layout · ${linkedCount} linked to a catalog definition`}
				actions={
					<div className="flex items-center gap-2">
						<PeriodTabs
							basePath="/dashboard/metrics"
							period={period}
							dayLabel={dayPending ? `${daily.requestedDay} (pending)` : daily.requestedDay}
							weekLabel={weekly.weekLabel}
						/>
						<a href={sheetHref} target="_blank" rel="noreferrer" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">
							Open sheet ↗
						</a>
						<Link href="/admin/metrics" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">
							Edit definitions →
						</Link>
					</div>
				}
			/>

			{(daily.error || weekly.error) && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Could not read the CEO Metrics sheet:</strong> {daily.error ?? weekly.error}
					</p>
				</Card>
			)}

			{dayPending && !daily.error && (
				<Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
					<p className="text-sm text-amber-800 dark:text-amber-300">
						<strong>No sheet data for {daily.requestedDay} yet.</strong> The Daily tab is filled in arrears
						{daily.latestFilledDay ? ` — last filled day: ${daily.latestFilledDay}` : ''}.
					</p>
				</Card>
			)}

			<div className="flex flex-wrap items-center gap-2 mb-4">
				<FilterChipLink href={period === 'weekly' ? '/dashboard/metrics?period=weekly' : '/dashboard/metrics'} active={!wantedSection}>
					All sections
				</FilterChipLink>
				{dailySections.map((s) => (
					<FilterChipLink
						key={s}
						href={`/dashboard/metrics?section=${encodeURIComponent(s)}${period === 'weekly' ? '&period=weekly' : ''}`}
						active={wantedSection === s}
						count={daily.rows.filter((r) => !r.isGroupHeader && norm(r.section) === norm(s)).length}
					>
						{s}
					</FilterChipLink>
				))}
			</div>

			<MetricTable
				dashboardKey="kpis"
				sections={linked}
				period={period}
				dayLabel={daily.requestedDay}
				prevDayLabel={daily.prevDayLabel}
				weekLabel={weekly.weekLabel}
				prevWeekLabel={weekly.prevWeekLabel}
				dayPending={dayPending}
				className="mb-6"
			/>

			{/* Catalog definitions tagged to surface here (0082). Empty until a
			    definition is tagged on Admin -> Metrics; says so rather than hiding. */}
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">From the catalog</h2>
					<span className="text-xs text-slate-400 tabular-nums">{kpiDefs.length}</span>
					<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto">{month} · team/company values from the app</span>
				</div>
				{kpiDefs.length === 0 ? (
					<p className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
						No definition is tagged for this page yet. Tick <em>Dashboards → KPIs</em> under “Surfaces on” in{' '}
						<Link href="/admin/metrics" className="text-primary-600 hover:underline">Admin → Metrics</Link> to add one.
					</p>
				) : (
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Metric</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Source of truth</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Value</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Goal</th>
								<th className="w-16" />
							</tr>
						</thead>
						<tbody>
							{kpiDefs.map((d) => {
								const rows = valuesByKey.get(d.key) ?? [];
								const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
								const goal = rows.reduce((s, r) => s + (r.goal ?? 0), 0);
								return (
									<tr key={d.key} id={`kpi-${d.key}`} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-1.5 text-slate-700 dark:text-slate-300">
											{d.name}
											{d.unit && <span className="text-2xs text-slate-600 dark:text-slate-400 ml-1">{d.unit}</span>}
											{d.calc_notes && <span className="block text-2xs text-slate-600 dark:text-slate-400 truncate" title={d.calc_notes}>{d.calc_notes}</span>}
										</td>
										<td className="px-3 py-1.5 text-slate-500 truncate max-w-48" title={d.sheet_source_of_truth ?? ''}>{d.sheet_source_of_truth ?? d.source.replace(/_/g, ' ')}</td>
										<td className="px-3 py-1.5 text-right tabular-nums text-slate-900 dark:text-slate-100">{rows.length ? formatNumber(value) : '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{rows.some((r) => r.goal != null) ? formatNumber(goal) : '—'}</td>
										<td className="px-3 py-1.5 text-right">
											<Link href={`/admin/metrics?edit=${encodeURIComponent(d.key)}`} className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600">edit</Link>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				)}
			</Card>
		</>
	);
}
