// Catalogs of available KPI tiles per dashboard. Each TileSpec is keyed by a
// stable `key` that is persisted in user_dashboard_layout.layout[].tile_key.
//
// Adding a new tile: append a TileSpec here. Existing users will see it
// appended to the end of their dashboard (or in the Add-a-tile picker if they
// have a saved custom layout — see resolveLayout in ./layout.ts).
//
// Removing a tile: delete the TileSpec; any saved layout that references the
// missing key is silently filtered out at render time.
//
// Sheet-fed tiles expose one of two raw points, and resolveLayout() turns it
// into the card body:
//   • `dailyPoint` (Daily tab, D-1) — used by the department dashboards:
//     yesterday's value + day-over-day delta + 7-day average. Weekly numbers
//     for those sections live in the WeeklyComparisonTable below the grid.
//   • `point` (Weekly tab) — value + week-over-week delta + target progress.
//     Still used by /dashboard/ops, whose metrics only exist weekly.
// `section` groups tiles into titled sub-grids within the page.

import {
	Award,
	CheckCircle,
	Clock,
	DollarSign,
	FileText,
	Headphones,
	Lightbulb,
	Newspaper,
	Sparkles,
	Star,
	TrendingUp,
	UserCheck,
	UserPlus,
	Users,
	type LucideIcon,
} from 'lucide-react';

import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import type { DailyPoint } from '@/lib/metrics/daily';
import type { MetricPoint } from '@/lib/metrics/sheets';

export interface OverviewKpis {
	activeCount: number;
	activeMrr: number;
	beaconCount: number;
	beaconMrr: number;
	recentPlacements: number;
	recentPlacementsCapped: boolean;
}

export interface DeliveryKpis {
	liveCount30: number;
	reach30: number;
	securedCount30: number;
	tier1Last30: number;
	podcastsLast30: number;
	avgDeliveryPct: number;
}

export type TileFormat = 'number' | 'currency' | 'currency2' | 'percent';

export interface TileSpec<Data> {
	key: string;
	defaultLabel: string;
	icon: LucideIcon;
	href?: string;
	/** Thematic group within the page (e.g. "Funnel"). Omit for a flat grid. */
	section?: string;
	/** How to format the metric's numbers (defaults to 'number'). */
	format?: TileFormat;
	/**
	 * Raw week metric backing this tile. When set, resolveLayout() computes the
	 * week-over-week delta + target progress and the tile renders the rich card.
	 */
	point?: (data: Data) => MetricPoint;
	/**
	 * Raw daily metric backing this tile (Daily tab, D-1). When set it WINS over
	 * `point`: the card shows yesterday's value with a day-over-day delta, and
	 * the week-over-week numbers move to the weekly comparison table below the
	 * grid. Weekly targets don't apply to a single day, so no target bar.
	 */
	dailyPoint?: (data: Data) => DailyPoint;
	/**
	 * How to color the week-over-week delta:
	 *  - 'normal' (default): up = green, down = red
	 *  - 'inverted': down = green (cost-per-X metrics)
	 *  - 'neutral': always gray (spend totals — no inherent good/bad)
	 */
	deltaTone?: 'normal' | 'inverted' | 'neutral';
	render: (data: Data) => string;
	subtitle: (data: Data) => string;
}

export const overviewCatalog: TileSpec<OverviewKpis>[] = [
	{
		key: 'active_clients',
		defaultLabel: 'Active Clients',
		icon: Users,
		href: '/clients',
		render: (d) => formatNumber(d.activeCount),
		subtitle: () => 'Active + 30/60-day, non-Beacon',
	},
	{
		key: 'active_mrr',
		defaultLabel: 'Active MRR',
		icon: DollarSign,
		href: '/clients',
		render: (d) => formatCurrency(d.activeMrr),
		subtitle: () => 'Sum of monthly retainers',
	},
	{
		key: 'beacon_subscribers',
		defaultLabel: 'Beacon Subscribers',
		icon: Sparkles,
		href: '/clients',
		render: (d) => formatNumber(d.beaconCount),
		subtitle: (d) => `${formatCurrency(d.beaconMrr)} MRR`,
	},
	{
		key: 'recent_placements',
		defaultLabel: 'Recent Placements',
		icon: Newspaper,
		href: '/media',
		render: (d) => `${formatNumber(d.recentPlacements)}${d.recentPlacementsCapped ? '+' : ''}`,
		subtitle: () => 'Live Date in last 30 days',
	},
];

// ---------------------------------------------------------------------------
// Department dashboards fed by the 2026 CEO Metrics Google Sheet.
// Marketing / Lead Gen / Sales / Social (and the daily block of Delivery) no
// longer list their tiles here — every metric row of the sheet becomes a card,
// so those catalogs are GENERATED at request time by ./sheetCatalog.ts.
// What stays hand-written: Overview (Supabase), Delivery (Airtable) and Ops
// (whose metrics only exist on the Weekly tab).
// The sheet is hand-maintained, so any cell can be blank — formatters render
// "—" for null. `render` = the big value; `subtitle` = the bottom line.
// ---------------------------------------------------------------------------

const wk = (p: MetricPoint, f: (n: number | null) => string) => f(p.week);
const num = (n: number | null) => formatNumber(n);
const pct = (n: number | null) => formatPercent(n);

// Fallback bottom line for sheet tiles without a target.
const noTarget = (p: MetricPoint, f: (n: number | null) => string) =>
	p.month != null ? `MTD ${f(p.month)} · no target set` : 'No target set';

export interface OpsKpis {
	projectsCompleted: MetricPoint;
	reportsGenerated: MetricPoint;
	insightsImplemented: MetricPoint;
	cultureFitsCompleted: MetricPoint;
	finalsCompleted: MetricPoint;
	teamHired: MetricPoint;
	wklyReportingOnTime: MetricPoint;
}

export const opsCatalog: TileSpec<OpsKpis>[] = [
	{
		key: 'projects_completed',
		defaultLabel: 'Projects completed',
		icon: CheckCircle,
		section: 'Execution',
		point: (d) => d.projectsCompleted,
		render: (d) => wk(d.projectsCompleted, num),
		subtitle: (d) => noTarget(d.projectsCompleted, num),
	},
	{
		key: 'reports_generated',
		defaultLabel: 'Reports generated',
		icon: FileText,
		section: 'Execution',
		point: (d) => d.reportsGenerated,
		render: (d) => wk(d.reportsGenerated, num),
		subtitle: (d) => noTarget(d.reportsGenerated, num),
	},
	{
		key: 'insights_implemented',
		defaultLabel: 'Insights implemented',
		icon: Lightbulb,
		section: 'Execution',
		point: (d) => d.insightsImplemented,
		render: (d) => wk(d.insightsImplemented, num),
		subtitle: (d) => noTarget(d.insightsImplemented, num),
	},
	{
		key: 'wkly_reporting_on_time',
		defaultLabel: 'Weekly reporting on time',
		icon: Clock,
		section: 'Execution',
		format: 'percent',
		point: (d) => d.wklyReportingOnTime,
		render: (d) => wk(d.wklyReportingOnTime, pct),
		subtitle: (d) => noTarget(d.wklyReportingOnTime, pct),
	},
	{
		key: 'culture_fits_completed',
		defaultLabel: 'Culture fits completed',
		icon: UserCheck,
		section: 'Hiring',
		point: (d) => d.cultureFitsCompleted,
		render: (d) => wk(d.cultureFitsCompleted, num),
		subtitle: (d) => noTarget(d.cultureFitsCompleted, num),
	},
	{
		key: 'finals_completed',
		defaultLabel: 'Final interviews',
		icon: Users,
		section: 'Hiring',
		point: (d) => d.finalsCompleted,
		render: (d) => wk(d.finalsCompleted, num),
		subtitle: (d) => noTarget(d.finalsCompleted, num),
	},
	{
		key: 'team_hired',
		defaultLabel: 'Team hired',
		icon: UserPlus,
		section: 'Hiring',
		point: (d) => d.teamHired,
		render: (d) => wk(d.teamHired, num),
		subtitle: (d) => noTarget(d.teamHired, num),
	},
];

export const deliveryCatalog: TileSpec<DeliveryKpis>[] = [
	{
		key: 'live_placements_30d',
		defaultLabel: 'Live placements (30d)',
		icon: Newspaper,
		section: 'Placements',
		render: (d) => formatNumber(d.liveCount30),
		subtitle: () => 'Live Link set, went live in the window',
	},
	{
		key: 'opps_secured_30d',
		defaultLabel: 'Opps secured (30d)',
		icon: Star,
		section: 'Placements',
		render: (d) => formatNumber(d.securedCount30),
		subtitle: () => 'R3 counting rule (interest shown)',
	},
	{
		key: 'tier1_placements_30d',
		defaultLabel: 'Tier-1 placements (30d)',
		icon: Award,
		section: 'Placements',
		render: (d) => formatNumber(d.tier1Last30),
		subtitle: () => 'Top-tier outlets',
	},
	{
		key: 'podcasts_30d',
		defaultLabel: 'Podcasts (30d)',
		icon: Headphones,
		section: 'Placements',
		render: (d) => formatNumber(d.podcastsLast30),
		subtitle: () => 'Within Live opps',
	},
	{
		key: 'reach_30d',
		defaultLabel: 'Reach (30d)',
		icon: TrendingUp,
		section: 'Performance',
		// Reach is an audience count, not money (finding 3: "Reach $0").
		render: (d) => formatNumber(d.reach30),
		subtitle: () => 'Summed across live placements',
	},
	{
		key: 'avg_delivery',
		defaultLabel: 'Avg delivery',
		icon: CheckCircle,
		section: 'Performance',
		render: (d) => formatPercent(d.avgDeliveryPct),
		subtitle: () => 'Across active trackers',
	},
];
