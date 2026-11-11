// /dashboard/delivery — Delivery department KPIs.
// Source: Client Media → Media Opportunities + Client Central → Beacon Delivery
// Tracker, PLUS the daily block generated from the 2026 CEO Metrics sheet
// (Daily tab, sections Media / Podcasts / Influencers) — the sheet's numbers are
// what leadership reviews, so they sit next to the Airtable-computed cards
// instead of in a separate page.
// Per-user tile layout via lib/dashboard/catalog.ts + user_dashboard_layout.

import Card from '@/components/ui/Card';
import {
	EditableDashboardProvider,
	EditButton,
	EditableGrid,
} from '@/components/dashboard/EditableDashboard';
import { unstable_cache } from 'next/cache';
import { BASE_IDS } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { deliveryCatalog, type DeliveryKpis } from '@/lib/dashboard/catalog';
import { loadLayout, resolveLayout } from '@/lib/dashboard/layout';
import { buildSheetCatalog, buildSheetSections } from '@/lib/dashboard/sheetCatalog';
import MetricTable from '@/components/dashboard/MetricTable';
import PeriodTabs from '@/components/dashboard/PeriodTabs';
import type { DashboardPeriod } from '@/lib/dashboard/layout';
import type { DashboardLayout } from '@/lib/dashboard/types';
import { getSheetMetrics } from '@/lib/metrics/sheets';
import { countsTowardGoal, isLive } from '@/lib/media/status';

export const dynamic = 'force-dynamic';

interface OppFields {
	Status?: string;
	Reach?: number;
	'Live Date'?: string;
	'Live Link'?: string;
	'Date Secured'?: string;
	'Media Tier'?: string;
}

interface DeliveryFields {
	'Progress %'?: number;
}

interface DeliveryResult extends DeliveryKpis {
	/** The underlying reads hit their page ceiling — every number here is a floor. */
	truncated: boolean;
	error: string | null;
}

/** Every Airtable-computed card on this page is a 30-day window. */
const WINDOW_DAYS = 30;

function windowStartIso(): string {
	const d = new Date();
	d.setDate(d.getDate() - WINDOW_DAYS);
	return d.toISOString().slice(0, 10);
}

// Throws on failure so unstable_cache never stores an error snapshot.
async function computeDeliveryStats(): Promise<DeliveryResult> {
	// Narrow the read instead of raising the page ceiling: the cards only ever
	// look at opps that went live or were secured inside the window, so ask
	// Airtable for just those rows. Media Opportunities is ~10k rows in total;
	// a 30-day slice is a few hundred, well inside one or two pages.
	const sinceIso = windowStartIso();
	const windowFilter = `OR(IS_AFTER({Live Date}, "${sinceIso}"), IS_AFTER({Date Secured}, "${sinceIso}"))`;
	const [oppsResult, deliveriesResult] = await Promise.all([
		listFullTable<OppFields>(BASE_IDS.CLIENT_MEDIA, 'Media Opportunities', {
			fields: ['Status', 'Reach', 'Live Date', 'Live Link', 'Date Secured', 'Media Tier'],
			filter: windowFilter,
		}),
		listFullTable<DeliveryFields>(BASE_IDS.CLIENT_CENTRAL, 'Beacon Delivery Tracker', {
			fields: ['Progress %'],
		}),
	]);

	const opps = oppsResult.rows;
	const deliveries = deliveriesResult.rows;
	// Every tile below is a count or a sum over these rows, so a partial read
	// makes all of them read LOW. With the windowed filter this should never
	// trip, but the flag stays honest if the 30-day slice ever outgrows the
	// ceiling.
	const truncated = oppsResult.truncated || deliveriesResult.truncated;

	const since = Date.now() - WINDOW_DAYS * 86400000;

	// Live is a PROPERTY (Live Link non-empty), not a status token — the old
	// Status === 'Live' test matched nothing in Airtable's 17-value vocabulary
	// and pinned these tiles at zero (planning synthesis finding 3).
	const live = opps.filter(
		(o) =>
			isLive(o.fields['Live Link']) &&
			o.fields['Live Date'] &&
			Date.parse(o.fields['Live Date']) > since,
	);
	// Counted per R3's bucket rule — bare Date Secured is filled on ~96% of
	// rows including declines and pending, which overcounts by ~40%.
	const secured = opps.filter(
		(o) =>
			countsTowardGoal(o.fields.Status) &&
			o.fields['Date Secured'] &&
			Date.parse(o.fields['Date Secured']) > since,
	);

	const reach = live.reduce((s, o) => s + (o.fields.Reach ?? 0), 0);

	const tier1 = live.filter((o) => /tier\s*1|top/i.test(o.fields['Media Tier'] ?? '')).length;

	const podcasts = live.filter((o) => /podcast/i.test(o.fields['Media Tier'] ?? '')).length;

	const avgDeliveryPct =
		deliveries.length > 0
			// Airtable's Progress % formula stores percent-scale numbers (81.8);
			// formatPercent multiplies by 100 — divide here or the tile reads 8,177.7%.
			? deliveries.reduce((s, d) => s + (d.fields['Progress %'] ?? 0), 0) /
				deliveries.length /
				100
			: 0;

	return {
		liveCount30: live.length,
		reach30: reach,
		securedCount30: secured.length,
		tier1Last30: tier1,
		podcastsLast30: podcasts,
		avgDeliveryPct,
		truncated,
		error: null,
	};
}

// These KPIs are identical for every viewer — compute once per TTL and share
// the snapshot across all requests.
const computeDeliveryStatsCached = unstable_cache(
	computeDeliveryStats,
	['dashboard-delivery-kpis'],
	{ revalidate: 120 },
);

async function fetchDeliveryStats(): Promise<DeliveryResult> {
	try {
		return await computeDeliveryStatsCached();
	} catch (e) {
		return {
			liveCount30: 0,
			reach30: 0,
			securedCount30: 0,
			tier1Last30: 0,
			podcastsLast30: 0,
			avgDeliveryPct: 0,
			truncated: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

// The Tier-1 and Podcasts tiles were 90-day cards until the 30-day
// standardisation; saved layouts still carry the old keys. Map them forward so
// nobody's pinned card silently drops to the hidden list.
const RENAMED_TILE_KEYS: Record<string, string> = {
	tier1_placements_90d: 'tier1_placements_30d',
	podcasts_90d: 'podcasts_30d',
};

function migrateDeliveryLayout(saved: DashboardLayout | null): DashboardLayout | null {
	if (!saved) return saved;
	return saved.map((item) =>
		RENAMED_TILE_KEYS[item.tile_key]
			? { ...item, tile_key: RENAMED_TILE_KEYS[item.tile_key] }
			: item,
	);
}

export default async function DeliveryDashboardPage({
	searchParams,
}: {
	searchParams: Promise<{ period?: string }>;
}) {
	const [kpis, { weekly, daily }, savedLayout, sp] = await Promise.all([
		fetchDeliveryStats(),
		getSheetMetrics(),
		loadLayout('delivery'),
		searchParams,
	]);
	const period: DashboardPeriod = sp?.period === 'weekly' ? 'weekly' : 'daily';

	// Airtable-computed cards first, then the sheet's delivery sections — as cards
	// for the Airtable ones and as the metric table below for the sheet rows.
	// Generated tiles ignore the data argument (they close over the sheet), so
	// both catalogs share the same type.
	const sheetOpts = {
		daily,
		weekly,
		period,
		sections: ['Media', 'Podcasts', 'Influencers'],
		weeklySections: ['Media Relations', 'Podcasts', 'Influencers'],
	};
	const catalog = [...deliveryCatalog, ...buildSheetCatalog<DeliveryKpis>(sheetOpts)];
	const { visible, hidden } = resolveLayout(catalog, migrateDeliveryLayout(savedLayout), kpis, {
		dailyPrevLabel: daily.prevDayLabel,
		period,
		// Pinned by default: the Airtable-computed cards this page always had. The
		// sheet's delivery metrics are all in the table below (and in "Add a tile").
		defaultVisible: deliveryCatalog.map((t) => t.key),
	});
	const dayPending = !daily.hasRequestedDay;

	return (
		<>
			<EditableDashboardProvider
				dashboardKey="delivery"
				variant="delivery"
				initialVisible={visible}
				initialHidden={hidden}
			>
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
							Delivery
						</h1>
						<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
							Media placement + deliverable progress KPIs · all cards last 30 days
						</p>
					</div>
					<div className="flex items-center gap-2">
						<PeriodTabs
							basePath="/dashboard/delivery"
							period={period}
							dayLabel={dayPending ? `${daily.requestedDay} (pending)` : daily.requestedDay}
							weekLabel={weekly.weekLabel}
						/>
						<EditButton />
					</div>
				</div>

				{dayPending && (
					<Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">
							<strong>No sheet data for {daily.requestedDay} yet.</strong> The Daily tab is
							filled in arrears
							{daily.latestFilledDay ? ` — last filled day: ${daily.latestFilledDay}` : ''}. The
							sheet-fed cards stay empty until yesterday&apos;s column is filled in.
						</p>
					</Card>
				)}

				{kpis.error && (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Failed to load some KPIs:</strong> {kpis.error}
						</p>
					</Card>
				)}

				{kpis.truncated && (
					<Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">
							<strong>These numbers are a floor, not a total.</strong> The 30-day Airtable
							read hit its page ceiling, so every count and sum below is under-reported.
						</p>
					</Card>
				)}

				<EditableGrid />

				<MetricTable
					dashboardKey="delivery"
					sections={buildSheetSections(sheetOpts)}
					period={period}
					dayLabel={daily.requestedDay}
					prevDayLabel={daily.prevDayLabel}
					weekLabel={weekly.weekLabel}
					prevWeekLabel={weekly.prevWeekLabel}
					dayPending={dayPending}
					className="mb-6"
				/>

				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						Coming next: trend chart (12-week rolling), publicist leaderboard, average days-to-secure, response-rate per outlet.
					</p>
				</Card>
			</EditableDashboardProvider>
		</>
	);
}
