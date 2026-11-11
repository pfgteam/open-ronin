// /dashboard/dev — engineering health, split by org (Alex, 2026-09-14):
//
//   Open Ronin  GitHub your-org/open-ronin, Vercel project open-ronin, this
//             Supabase project, plus the cron routes and the migration ledger
//             diff (the folder in this deploy vs production).
//   Beacon    A different org, repo, Vercel project and database. Every
//             identifier is an env var (BEACON_*, docs/ENV.md); until Alex
//             sets them each source renders "Not connected" naming the
//             variable. Nothing about Beacon is guessed.
//
// Server rendered; every source is read server side with an env token and
// cached five minutes (lib/dev/load.ts). A source that errors renders
// "Unavailable" with the reason. The page itself never fails on a missing
// integration. No Sentry: the error rate tile says so and names the
// variable it would need (WIP_BUILD_PLAN.md, module 3).
//
// Tiles reuse the department dashboard grid (editable, per user layout under
// dashboard_key 'dev'); the detail tables below are plain server markup.

import Link from 'next/link';
import { clsx } from 'clsx';
import DepartmentDashboard from '@/components/dashboard/DepartmentDashboard';
import DevPanels, { BeaconPanels } from '@/components/dev/DevPanels';
import PageHeader from '@/components/ui/PageHeader';
import { loadLayout, resolveLayout } from '@/lib/dashboard/layout';
import { devCatalog } from '@/lib/dev/catalog';
import { DEV_CACHE_SECONDS, loadDevDashboard, loadBeaconDashboard } from '@/lib/dev/load';
import { EMPTY_WEEKLY_METRICS } from '@/lib/metrics/sheets';

export const dynamic = 'force-dynamic';

type Org = 'main' | 'beacon';

function OrgTabs({ active }: { active: Org }) {
	const tabs: { key: Org; label: string; note: string }[] = [
		{ key: 'main', label: 'Open Ronin', note: 'this app' },
		{ key: 'beacon', label: 'Beacon', note: 'separate org' },
	];
	return (
		<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 mb-4">
			{tabs.map((t) => (
				<Link
					key={t.key}
					href={t.key === 'main' ? '/dashboard/dev' : `/dashboard/dev?org=${t.key}`}
					aria-current={t.key === active ? 'page' : undefined}
					className={clsx(
						'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2',
						t.key === active
							? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
							: 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
					)}
				>
					{t.label}
					<span className="text-2xs text-slate-600 dark:text-slate-400">{t.note}</span>
				</Link>
			))}
		</div>
	);
}

export default async function DevDashboardPage({
	searchParams,
}: {
	searchParams: Promise<{ org?: string }>;
}) {
	const sp = await searchParams;
	const org: Org = sp?.org === 'beacon' ? 'beacon' : 'main';

	if (org === 'beacon') {
		const data = await loadBeaconDashboard();
		return (
			<>
				<PageHeader
					title="Dev · Beacon"
					description={`GitHub, Vercel and Supabase health for the Beacon org · refreshed every ${DEV_CACHE_SECONDS / 60} minutes`}
					actions={
						data.repo ? (
							<a
								href={`https://github.com/${data.repo}`}
								target="_blank"
								rel="noreferrer"
								className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
							>
								Open repo ↗
							</a>
						) : null
					}
				/>
				<OrgTabs active="beacon" />
				<BeaconPanels data={data} />
			</>
		);
	}

	const [data, savedLayout] = await Promise.all([loadDevDashboard(), loadLayout('dev')]);

	const { visible, hidden } = resolveLayout(devCatalog, savedLayout, data);
	// The dev tiles carry their own status chip (green in sync, red mismatch)
	// instead of a sheet delta; attach it after the generic resolve.
	const statsFor = new Map(devCatalog.map((t) => [t.key, t.stats]));
	const withStats = (tiles: typeof visible) =>
		tiles.map((t) => {
			const stats = statsFor.get(t.key)?.(data);
			return stats ? { ...t, stats } : t;
		});

	return (
		<DepartmentDashboard
			dashboardKey="dev"
			title="Dev · Open Ronin"
			subtitle={`GitHub, Vercel and Supabase health · refreshed every ${DEV_CACHE_SECONDS / 60} minutes`}
			metrics={EMPTY_WEEKLY_METRICS}
			visible={withStats(visible)}
			hidden={withStats(hidden)}
			source={{ label: 'Open repo ↗', href: 'https://github.com/your-org/open-ronin' }}
		>
			<OrgTabs active="main" />
			<DevPanels data={data} />
		</DepartmentDashboard>
	);
}
