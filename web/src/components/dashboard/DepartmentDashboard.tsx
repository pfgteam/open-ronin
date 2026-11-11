// Server-rendered shell shared by the department dashboards
// (/dashboard/{marketing,leadgen,sales,ops,social}).
//
// Layout (three layers, in reading order):
//   1. header — title, both period labels, the period switch, the sheet link;
//   2. pinned KPI cards — the handful that matter every day, editable (drag,
//      rename, pin/unpin) and always in the same place; the focused period is
//      the big number, the other one rides underneath;
//   3. metric table — every metric of the page's sheet sections, one row each,
//      with Daily and Weekly side by side.
//
// Data: KPI cards come from lib/dashboard/sheetCatalog.ts (generated from the
// sheet); the table is the same list in table form. Ops has no daily data in
// the sheet, so it passes neither `daily` nor `sections` and keeps weekly cards.
//
// Both tabs of the sheet are filled in arrears and not always on the same day,
// so each period is labelled with the period it actually shows.

import Card from '@/components/ui/Card';
import {
	EditableDashboardProvider,
	EditButton,
	EditableGrid,
} from '@/components/dashboard/EditableDashboard';
import MetricTable from '@/components/dashboard/MetricTable';
import PeriodTabs from '@/components/dashboard/PeriodTabs';
import type { DashboardPeriod } from '@/lib/dashboard/layout';
import type { SheetSection } from '@/lib/dashboard/sheetCatalog';
import type { DailyMetrics } from '@/lib/metrics/daily';
import type { WeeklyMetrics } from '@/lib/metrics/sheets';
import type { RenderedTile } from '@/lib/dashboard/types';

interface Props {
	dashboardKey: string;
	title: string;
	subtitle: string;
	metrics: WeeklyMetrics;
	/** Daily tab state — omit on dashboards whose metrics are weekly-only. */
	daily?: DailyMetrics;
	/** Metric-table sections — omit to render only the KPI grid. */
	sections?: SheetSection[];
	/** Which period leads the cards; drives the highlighted table columns. */
	period?: DashboardPeriod;
	visible: RenderedTile[];
	hidden: RenderedTile[];
	/**
	 * Link after the subtitle. Defaults to the CEO Metrics sheet; pass null
	 * for a dashboard that is not sheet fed (Dev reads GitHub, Vercel and
	 * Supabase) or your own label and href.
	 */
	source?: { label: string; href: string } | null;
	/** Detail panels rendered under the KPI grid (tables, lists). */
	children?: React.ReactNode;
}

// Same default as lib/metrics/sheetsClient.ts (the 2026 CEO Metrics sheet).
const DEFAULT_SPREADSHEET_ID = '1zKEEqnsDMXrKcFW8KvnCMM0MGubO38gQzZ37PKaYqIY';

export default function DepartmentDashboard({
	dashboardKey,
	title,
	subtitle,
	metrics,
	daily,
	sections,
	period = 'daily',
	visible,
	hidden,
	source,
	children,
}: Props) {
	const sheetUrl = `https://docs.google.com/spreadsheets/d/${
		process.env.METRICS_SPREADSHEET_ID ?? DEFAULT_SPREADSHEET_ID
	}`;
	const sourceLink =
		source === null ? null : (source ?? { label: 'Open CEO Metrics sheet ↗', href: sheetUrl });

	const dayPending = daily != null && !daily.hasRequestedDay;
	const focusLabel =
		period === 'weekly' ? `Weekly · ${metrics.weekLabel ?? '—'}` : `Daily · ${daily?.requestedDay ?? '—'}`;

	return (
		<>
			<EditableDashboardProvider
				dashboardKey={dashboardKey}
				variant="department"
				initialVisible={visible}
				initialHidden={hidden}
			>
				<div className="flex flex-wrap items-end justify-between gap-4 mb-5">
					<div>
						<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
							{title}
						</h1>
						<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
							{subtitle}
							{sourceLink && (
								<>
									{' · '}
									<a
										href={sourceLink.href}
										target="_blank"
										rel="noreferrer"
										className="text-primary-600 dark:text-primary-400 hover:underline"
									>
										{sourceLink.label}
									</a>
								</>
							)}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{daily && (
							<PeriodTabs
								basePath={`/dashboard/${dashboardKey}`}
								period={period}
								dayLabel={dayPending ? `${daily.requestedDay} (pending)` : daily.requestedDay}
								weekLabel={metrics.weekLabel}
							/>
						)}
						<EditButton />
					</div>
				</div>

				{metrics.error && (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Failed to load metrics:</strong> {metrics.error}
						</p>
					</Card>
				)}

				{daily?.error && (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Failed to load daily metrics:</strong> {daily.error}
						</p>
					</Card>
				)}

				{dayPending && !daily?.error && (
					<Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">
							<strong>No data for {daily.requestedDay} yet.</strong> The sheet&apos;s Daily tab
							is filled in arrears
							{daily.latestFilledDay ? ` — last filled day: ${daily.latestFilledDay}` : ''}. Daily
							numbers stay empty until yesterday&apos;s column is filled in; the weekly column is
							unaffected.
						</p>
					</Card>
				)}

				{daily && (
					<div className="flex items-center gap-3 mb-3">
						<h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
							Pinned KPIs
						</h2>
						<span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
							{focusLabel}
						</span>
						<div className="flex-1 h-px bg-slate-200 dark:bg-slate-700/60" />
					</div>
				)}

				<EditableGrid />

				{children}

				{sections && daily && (
					<MetricTable
						dashboardKey={dashboardKey}
						sections={sections}
						period={period}
						dayLabel={daily.requestedDay}
						prevDayLabel={daily.prevDayLabel}
						weekLabel={metrics.weekLabel}
						prevWeekLabel={metrics.prevWeekLabel}
						dayPending={dayPending}
					/>
				)}
			</EditableDashboardProvider>
		</>
	);
}
