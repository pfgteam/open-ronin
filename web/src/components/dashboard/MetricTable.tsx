// The metric table under the KPI cards: every metric of the page's sheet
// sections, one row each, with both periods side by side.
//
// Columns: KPI | Daily | Δ daily | Weekly | Δ weekly | Bi-weekly
//
// Why a table and not more cards: a department carries 15-57 metrics and all of
// them matter at some point. Cards for all of them is 4+ screens with no
// hierarchy; the handful that matter every day are the cards above, and this is
// the complete list in one screen. Both period columns are always present — the
// period switch only changes which pair is emphasized, so comparing the day
// against the week never costs a click.
//
// This file is the server half: it formats every cell and computes the deltas
// (same rules as the cards) into plain serializable rows, then hands them to
// MetricExplorer, the client half that owns search, filters and collapsing.

import MetricExplorer, { type SectionView } from '@/components/dashboard/MetricExplorer';
import { dailyDelta, weeklyDelta, type DashboardPeriod } from '@/lib/dashboard/layout';
import { formatValue, type SheetSection } from '@/lib/dashboard/sheetCatalog';

interface Props {
	/** Storage key for the user's collapse/filter preferences. */
	dashboardKey: string;
	sections: SheetSection[];
	period: DashboardPeriod;
	dayLabel: string;
	prevDayLabel: string;
	weekLabel: string | null;
	prevWeekLabel: string | null;
	/** True when the sheet has no column for the requested day yet. */
	dayPending: boolean;
	className?: string;
}

// A metric nobody is moving: no number (or a zero) in either period. Uses the
// raw values, not the rendered ones, so a pending day doesn't make the whole
// table look idle.
function isIdle(daily: SheetSection['rows'][number]['daily'], weekly: SheetSection['rows'][number]['weekly']) {
	const values = [daily?.day, daily?.prevDay, weekly?.week, weekly?.prevWeek];
	return values.every((v) => v == null || v === 0);
}

export default function MetricTable({
	dashboardKey,
	sections,
	period,
	dayLabel,
	prevDayLabel,
	weekLabel,
	prevWeekLabel,
	dayPending,
	className,
}: Props) {
	if (sections.length === 0) return null;

	const views: SectionView[] = sections.map((section) => ({
		title: section.title,
		weeklyOnly: section.weeklyOnly,
		rows: section.rows.map((row) => ({
			key: row.key,
			label: row.label,
			dayText: row.daily && !dayPending ? formatValue(row.daily.day, row.format) : '—',
			dayDelta: row.daily && !dayPending ? dailyDelta(row.daily, row.format, row.tone, prevDayLabel) : null,
			weekText: row.weekly ? formatValue(row.weekly.week, row.format) : '—',
			weekDelta: row.weekly ? weeklyDelta(row.weekly, row.format, row.tone) : null,
			series: row.daily ? row.daily.series : null,
			idle: isIdle(row.daily, row.weekly),
		})),
	}));

	return (
		<MetricExplorer
			dashboardKey={dashboardKey}
			sections={views}
			period={period}
			dayLabel={dayLabel}
			prevDayLabel={prevDayLabel}
			weekLabel={weekLabel}
			prevWeekLabel={prevWeekLabel}
			className={className}
		/>
	);
}
