// Overview "placement trend" card: the trailing 12 months from
// v_portfolio_opp_trend (0071), the same view /clients/analytics draws.
// Replaces the "Monthly placement trend (12-week rolling)" line in the
// Coming next list (WIP_BUILD_PLAN.md idea 9). Reads with the session, so
// it renders nothing but a pointer if the views are not applied yet.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import { LineChart } from '@/components/dashboard/charts';
import { createClient } from '@/lib/supabase/server';
import { alignToMonths, monthLabel, trendMonths, type PortfolioTrendRow } from '@/lib/clients/analytics';
import { formatNumber } from '@/lib/format';

export default async function PlacementTrendCard() {
	const supabase = await createClient();
	const months = trendMonths();
	const { data, error } = await supabase
		.from('v_portfolio_opp_trend')
		.select('month, secured_count, live_count, goal_total, contracts_synced, contracts_in_scope, contracts_with_goal, secured_toward_goal, secured_pct_of_goal, synced_at')
		.gte('month', months[0])
		.order('month');

	const trend = alignToMonths((data ?? []) as PortfolioTrendRow[], months);
	const latest = [...trend].reverse().find((r) => r != null) ?? null;

	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Placement trend · trailing 12 months</h2>
				<Link href="/clients/analytics" className="text-xs text-primary-700 dark:text-primary-400 hover:underline">
					Client Analytics
				</Link>
			</div>
			{error ? (
				<p className="text-xs text-slate-500 dark:text-slate-400">Placement trends aren&apos;t switched on yet. Ask Ops to enable client analytics.</p>
			) : trend.some((r) => r != null) ? (
				<>
					<LineChart
						series={[
							{ label: 'Secured', values: trend.map((r) => r?.secured_count ?? null), tone: 'primary' },
							{ label: 'Live', values: trend.map((r) => r?.live_count ?? null), tone: 'success' },
						]}
						labels={months.map(monthLabel)}
						height={140}
						title="Secured and live opportunities per month from the mirror"
					/>
					<p className="mt-1 text-2xs text-slate-600 dark:text-slate-400">
						{latest ? `${monthLabel(latest.month)}: ${formatNumber(latest.secured_count)} secured, ${formatNumber(latest.live_count)} live across ${latest.contracts_synced} contracts` : ''}
						{' · '}mirror (client_opp_months), not Airtable
					</p>
				</>
			) : (
				<p className="text-xs text-slate-500 dark:text-slate-400">No months synced in client_opp_months yet; run scripts/import-opp-months.ts.</p>
			)}
		</Card>
	);
}
