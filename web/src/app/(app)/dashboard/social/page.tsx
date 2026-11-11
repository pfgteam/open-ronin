// /dashboard/social — Social metrics from the 2026 CEO Metrics sheet.
// Four pinned KPI cards (period-switchable) + the full metric table
// (KPI | Daily | Δ daily | Weekly | Δ weekly | Bi-weekly). Tiles and rows are
// both generated from the sheet — see lib/dashboard/sheetCatalog.ts.

import DepartmentDashboard from '@/components/dashboard/DepartmentDashboard';
import { loadLayout, resolveLayout, type DashboardPeriod } from '@/lib/dashboard/layout';
import { buildSheetCatalog, buildSheetSections } from '@/lib/dashboard/sheetCatalog';
import { getSheetMetrics } from '@/lib/metrics/sheets';

export const dynamic = 'force-dynamic';

// Cards a first-time viewer gets; anyone can pin/unpin from the edit mode.
const PINNED = ['or_ig_followers', 'or_fb_followers', 'heather_ig_followers', 'beacon_ig_followers'];

export default async function SocialDashboardPage({
	searchParams,
}: {
	searchParams: Promise<{ period?: string }>;
}) {
	const [{ weekly, daily }, savedLayout, sp] = await Promise.all([
		getSheetMetrics(),
		loadLayout('social'),
		searchParams,
	]);
	const period: DashboardPeriod = sp?.period === 'weekly' ? 'weekly' : 'daily';

	const opts = { daily, weekly, period, sections: ['Social'] };

	const { visible, hidden } = resolveLayout(buildSheetCatalog<null>(opts), savedLayout, null, {
		dailyPrevLabel: daily.prevDayLabel,
		period,
		defaultVisible: PINNED,
	});

	return (
		<DepartmentDashboard
			dashboardKey="social"
			title="Social"
			subtitle="Follower growth — internal + client accounts"
			metrics={weekly}
			daily={daily}
			period={period}
			sections={buildSheetSections(opts)}
			visible={visible}
			hidden={hidden}
		/>
	);
}
