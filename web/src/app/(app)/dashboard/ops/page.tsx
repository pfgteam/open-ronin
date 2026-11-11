// /dashboard/ops — Operations, hiring, and team-health KPIs from the 2026
// CEO Metrics sheet, Weekly tab, "Operations", "Hiring" and "Human" sections.

import DepartmentDashboard from '@/components/dashboard/DepartmentDashboard';
import { opsCatalog, type OpsKpis } from '@/lib/dashboard/catalog';
import { loadLayout, resolveLayout } from '@/lib/dashboard/layout';
import { getWeeklyMetrics, pick } from '@/lib/metrics/sheets';

export const dynamic = 'force-dynamic';

export default async function OpsDashboardPage() {
	const [metrics, savedLayout] = await Promise.all([
		getWeeklyMetrics(),
		loadLayout('ops'),
	]);

	const kpis: OpsKpis = {
		projectsCompleted: pick(metrics, { section: 'Operations', label: 'Projects Completed' }),
		reportsGenerated: pick(metrics, { section: 'Operations', label: 'Reports Generated' }),
		insightsImplemented: pick(metrics, {
			section: 'Operations',
			label: 'Insights Implemented',
		}),
		cultureFitsCompleted: pick(metrics, {
			section: 'Hiring',
			label: 'Culture Fits Completed',
		}),
		finalsCompleted: pick(metrics, { section: 'Hiring', label: 'Finals Completed' }),
		teamHired: pick(metrics, { section: 'Hiring', label: 'Team Hired' }),
		wklyReportingOnTime: pick(metrics, {
			section: 'Human',
			label: 'Wkly Reporting On Time',
		}),
	};

	const { visible, hidden } = resolveLayout(opsCatalog, savedLayout, kpis);

	return (
		<DepartmentDashboard
			dashboardKey="ops"
			title="Ops"
			subtitle="Operations, hiring + team health"
			metrics={metrics}
			visible={visible}
			hidden={hidden}
		/>
	);
}
