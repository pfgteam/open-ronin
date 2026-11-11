// /dashboard/marketing — Marketing metrics from the 2026 CEO Metrics sheet.
// Four pinned KPI cards (period-switchable) + the full metric table
// (KPI | Daily | Δ daily | Weekly | Δ weekly | Bi-weekly). Tiles and rows are
// both generated from the sheet — see lib/dashboard/sheetCatalog.ts.

import { DollarSign, PhoneCall } from 'lucide-react';

import DepartmentDashboard from '@/components/dashboard/DepartmentDashboard';
import { loadLayout, resolveLayout, type DashboardPeriod } from '@/lib/dashboard/layout';
import { buildSheetCatalog, buildSheetSections } from '@/lib/dashboard/sheetCatalog';
import { pickDaily, sumDailyPoints } from '@/lib/metrics/daily';
import { getSheetMetrics } from '@/lib/metrics/sheets';

export const dynamic = 'force-dynamic';

// Cards a first-time viewer gets; anyone can pin/unpin from the edit mode.
const PINNED = ['total_ad_spend', 'calls_booked_ads', 'meta_leads', 'meta_cost_per_conv'];

export default async function MarketingDashboardPage({
	searchParams,
}: {
	searchParams: Promise<{ period?: string }>;
}) {
	const [{ weekly, daily }, savedLayout, sp] = await Promise.all([
		getSheetMetrics(),
		loadLayout('marketing'),
		searchParams,
	]);
	const period: DashboardPeriod = sp?.period === 'weekly' ? 'weekly' : 'daily';

	// The Daily tab has no total rows (the Weekly tab computes them), so the two
	// overview cards are summed from the platform rows.
	const googleSpend = pickDaily(daily, { section: 'Marketing', g1: 'Google Ads', label: 'Spend' });
	const metaSpend = pickDaily(daily, { section: 'Marketing', g1: 'Meta Ads', label: 'Spend' });
	const googleCalls = pickDaily(daily, { section: 'Marketing', label: 'Calls booked Gads' });
	const metaCalls = pickDaily(daily, {
		section: 'Marketing',
		g1: 'Meta Ads',
		label: 'Calls Booked',
	});

	const opts = {
		daily,
		weekly,
		period,
		sections: ['Marketing'],
		derived: [
			{
				key: 'total_ad_spend',
				label: 'Total ad spend',
				section: 'Overview',
				icon: DollarSign,
				format: 'currency2' as const,
				deltaTone: 'neutral' as const,
				daily: sumDailyPoints(googleSpend, metaSpend),
				weeklyLabel: 'Total Ad Spend',
				subtitleNote: 'Google + Meta',
			},
			{
				key: 'calls_booked_ads',
				label: 'Calls booked from ads',
				section: 'Overview',
				icon: PhoneCall,
				daily: sumDailyPoints(googleCalls, metaCalls),
				weeklyLabel: 'Calls Booked From Ads Total',
				subtitleNote: 'Google + Meta',
			},
		],
	};

	const { visible, hidden } = resolveLayout(buildSheetCatalog<null>(opts), savedLayout, null, {
		dailyPrevLabel: daily.prevDayLabel,
		period,
		defaultVisible: PINNED,
	});

	return (
		<DepartmentDashboard
			dashboardKey="marketing"
			title="Marketing"
			subtitle="Paid ads performance"
			metrics={weekly}
			daily={daily}
			period={period}
			sections={buildSheetSections(opts)}
			visible={visible}
			hidden={hidden}
		/>
	);
}
