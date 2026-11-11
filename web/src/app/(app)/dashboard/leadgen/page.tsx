// /dashboard/leadgen — Lead Gen metrics from the 2026 CEO Metrics sheet.
// Four pinned KPI cards (period-switchable) + the full metric table
// (KPI | Daily | Δ daily | Weekly | Δ weekly | Bi-weekly). Tiles and rows are
// both generated from the sheet — see lib/dashboard/sheetCatalog.ts.

import DepartmentDashboard from '@/components/dashboard/DepartmentDashboard';
import { loadLayout, resolveLayout, type DashboardPeriod } from '@/lib/dashboard/layout';
import { buildSheetCatalog, buildSheetSections } from '@/lib/dashboard/sheetCatalog';
import { getSheetMetrics } from '@/lib/metrics/sheets';

export const dynamic = 'force-dynamic';

// Cards a first-time viewer gets; anyone can pin/unpin from the edit mode.
const PINNED = ['ghl_contacts_added', 'linkedin_dms_sent', 'leadhype_sent', 'd:crm.organic-leads'];

export default async function LeadgenDashboardPage({
	searchParams,
}: {
	searchParams: Promise<{ period?: string }>;
}) {
	const [{ weekly, daily }, savedLayout, sp] = await Promise.all([
		getSheetMetrics(),
		loadLayout('leadgen'),
		searchParams,
	]);
	const period: DashboardPeriod = sp?.period === 'weekly' ? 'weekly' : 'daily';

	const opts = { daily, weekly, period, sections: ['Lead Gen', 'CRM'] };

	const { visible, hidden } = resolveLayout(buildSheetCatalog<null>(opts), savedLayout, null, {
		dailyPrevLabel: daily.prevDayLabel,
		period,
		defaultVisible: PINNED,
	});

	return (
		<DepartmentDashboard
			dashboardKey="leadgen"
			title="Lead Gen"
			subtitle="Outbound + CRM pipeline"
			metrics={weekly}
			daily={daily}
			period={period}
			sections={buildSheetSections(opts)}
			visible={visible}
			hidden={hidden}
		/>
	);
}
