// /dashboard — Overview KPIs pulled live from Airtable.

//
// Tile catalog lives in lib/dashboard/catalog.ts. Each user's customization
// (order + visibility + renames) is persisted in user_dashboard_layout (Supabase).
// First-time users get the catalog default order.

import Card from '@/components/ui/Card';
import {
	EditableDashboardProvider,
	EditButton,
	EditableGrid,
} from '@/components/dashboard/EditableDashboard';
import { unstable_cache } from 'next/cache';
import { getAdapter, BASE_IDS, type DataRecord } from '@/lib/data';
import { overviewCatalog, type OverviewKpis } from '@/lib/dashboard/catalog';
import { loadLayout, resolveLayout } from '@/lib/dashboard/layout';
import { formatNumber } from '@/lib/format';
import PlacementTrendCard from './PlacementTrendCard';

export const metadata = { title: 'Dashboard' };

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = ['Active', '30-day', '60-day'];

interface ContractFields {
	'Client Status'?: string;
	'Per Month'?: number;
	Packages?: string[];
}

interface OverviewResult extends OverviewKpis {
	totalContracts: number;
	error: string | null;
}

// Paginate every contract page with `noCache` — a cached page-1 response can
// carry an expired Airtable offset, which 422s page 2 with
// LIST_RECORDS_ITERATOR_NOT_AVAILABLE (same rationale as /dashboard/delivery).
// If the iterator still expires mid-loop, restart pagination once.
// Cross-request load is kept low by the unstable_cache wrapper below, not by
// the per-fetch cache.
async function fetchAllContracts(): Promise<DataRecord<ContractFields>[]> {
	const adapter = getAdapter();
	for (let attempt = 0; ; attempt++) {
		try {
			const contracts: DataRecord<ContractFields>[] = [];
			let cursor: string | undefined;
			let safety = 50;
			do {
				const r = await adapter.list<ContractFields>(
					BASE_IDS.CLIENT_CENTRAL,
					'Contract Agreement',
					{
						pageSize: 100,
						cursor,
						noCache: true,
						fields: ['Client Status', 'Per Month', 'Packages'],
					},
				);
				contracts.push(...r.rows);
				cursor = r.cursor;
				safety--;
			} while (cursor && safety > 0);
			return contracts;
		} catch (e) {
			const details = JSON.stringify((e as { details?: unknown })?.details ?? '');
			const msg = `${e instanceof Error ? e.message : String(e)} ${details}`;
			if (attempt === 0 && msg.includes('LIST_RECORDS_ITERATOR_NOT_AVAILABLE')) continue;
			throw e;
		}
	}
}

// Walks every page of the 30-day placements read. `capped` is only true when
// the safety valve (50 pages = 5,000 rows) ran out before the cursor did, so
// the "+" suffix on the tile now means "genuinely truncated", not "more than
// one page".
async function fetchRecentPlacements(): Promise<{ count: number; capped: boolean }> {
	// Tolerate failure independently — a media-base error shouldn't blank the
	// contract KPIs (same behavior as before the parallelization).
	try {
		const adapter = getAdapter();
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		const dateStr = thirtyDaysAgo.toISOString().slice(0, 10);
		let count = 0;
		let cursor: string | undefined;
		let safety = 50;
		do {
			const r = await adapter.list(BASE_IDS.CLIENT_MEDIA, 'Media Opportunities', {
				pageSize: 100,
				cursor,
				noCache: true,
				filter: `IS_AFTER({Live Date}, "${dateStr}")`,
				fields: ['Live Date'],
			});
			count += r.rows.length;
			cursor = r.cursor;
			safety--;
		} while (cursor && safety > 0);
		return { count, capped: !!cursor };
	} catch {
		return { count: 0, capped: false };
	}
}

// Throws on failure so unstable_cache never stores an error snapshot.
async function computeKPIs(): Promise<OverviewResult> {
	// Contracts pagination and the placements lookup are independent — run
	// them concurrently instead of in series.
	const [contracts, placements] = await Promise.all([
		fetchAllContracts(),
		fetchRecentPlacements(),
	]);

	const isBeacon = (c: DataRecord<ContractFields>) =>
		(c.fields.Packages ?? []).some((p) => /beacon/i.test(p));

	const isActive = (c: DataRecord<ContractFields>) =>
		ACTIVE_STATUSES.includes(c.fields['Client Status'] ?? '');

	// Both tiles are "current MRR": Beacon gets the same status gate as the
	// core book, otherwise every churned/cancelled Beacon sub ever created is
	// summed into the tile (~$123k instead of ~$6k).
	const active = contracts.filter((c) => isActive(c) && !isBeacon(c));
	const beacon = contracts.filter((c) => isActive(c) && isBeacon(c));

	const activeMrr = active.reduce((sum, c) => sum + (c.fields['Per Month'] ?? 0), 0);
	const beaconMrr = beacon.reduce((sum, c) => sum + (c.fields['Per Month'] ?? 0), 0);

	return {
		activeCount: active.length,
		activeMrr,
		beaconCount: beacon.length,
		beaconMrr,
		totalContracts: contracts.length,
		recentPlacements: placements.count,
		recentPlacementsCapped: placements.capped,
		error: null,
	};
}

// Company-wide KPIs are identical for every viewer — compute once per TTL and
// share across all requests. (Route-level ISR is impossible here: the page
// reads auth cookies via loadLayout, so caching the *data* is the fix.)
const computeKPIsCached = unstable_cache(computeKPIs, ['dashboard-overview-kpis'], {
	revalidate: 120,
});

async function fetchKPIs(): Promise<OverviewResult> {
	try {
		return await computeKPIsCached();
	} catch (e) {
		return {
			activeCount: 0,
			activeMrr: 0,
			beaconCount: 0,
			beaconMrr: 0,
			totalContracts: 0,
			recentPlacements: 0,
			recentPlacementsCapped: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

function getGreeting(): string {
	const h = new Date().getHours();
	if (h < 12) return 'morning';
	if (h < 17) return 'afternoon';
	return 'evening';
}

export default async function DashboardPage() {
	const [kpis, savedLayout] = await Promise.all([fetchKPIs(), loadLayout('overview')]);
	const { visible, hidden } = resolveLayout(overviewCatalog, savedLayout, kpis);
	const greeting = getGreeting();

	return (
		<>
			<EditableDashboardProvider
				dashboardKey="overview"
				variant="overview"
				initialVisible={visible}
				initialHidden={hidden}
			>
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
							Good {greeting}
						</h1>
						<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
							Live from Airtable · {formatNumber(kpis.totalContracts)} contracts on file
						</p>
					</div>
					<EditButton />
				</div>

				{kpis.error && (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Failed to load some KPIs:</strong> {kpis.error}
						</p>
					</Card>
				)}

				<EditableGrid />

				<div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
					<div className="lg:col-span-2">
						<PlacementTrendCard />
					</div>
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
							Coming next
						</h2>
						<ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside">
							<li>Pipeline funnel from GHL (deferred per scope)</li>
							<li>Team utilization heatmap</li>
							<li>AR / past-due invoices summary</li>
						</ul>
					</Card>
				</div>
			</EditableDashboardProvider>
		</>
	);
}
