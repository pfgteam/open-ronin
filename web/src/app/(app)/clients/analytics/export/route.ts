// GET /clients/analytics/export[?client=rec…] — CSV of the current view.
//
// Portfolio: one row per month of the trailing 12 (v_portfolio_opp_trend),
// then a blank line and the in scope contracts (v_client_analytics_contracts).
// Per client: one row per month (v_client_opp_trend) with the goal beside it.
// Reads with the user's session like the page, so RLS decides.

import { NextResponse } from 'next/server';
import { loadClient, loadPortfolio } from '@/lib/clients/analytics';
import { toCsv } from '@/lib/clients/analyticsShared';

export const dynamic = 'force-dynamic';

function file(name: string, body: string) {
	return new NextResponse(body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${name}"`,
			'Cache-Control': 'no-store',
		},
	});
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	const client = url.searchParams.get('client');
	const stamp = new Date().toISOString().slice(0, 10);

	if (client) {
		const data = await loadClient(client);
		if (data.error) return NextResponse.json({ error: data.error }, { status: 500 });
		if (!data.contract) return NextResponse.json({ error: 'not an in scope contract' }, { status: 404 });
		const c = data.contract;
		const rows = data.months.map((m, i) => {
			const r = data.trend[i];
			return [m, r?.secured_count ?? '', r?.live_count ?? '', r?.goal ?? '', r?.goal_source ?? '', r?.secured_pct_of_goal ?? '', r ? 'synced' : 'not synced'];
		});
		const head = toCsv(
			['client', 'contract_id', 'package', 'package_family', 'package_quota', 'status', 'starts_on', 'ends_on', 'renewal_on', 'days_since_last_secured', 'payment_on_time_pct'],
			[[c.display_name, c.airtable_contract_id, c.package, c.package_family, c.package_quota, c.status, c.starts_on, c.ends_on, c.renewal_on, c.days_since_last_secured, data.payments?.on_time_pct ?? '']],
		);
		const body = head + '\r\n' + toCsv(['month', 'secured', 'live', 'goal', 'goal_source', 'secured_pct_of_goal', 'sync'], rows);
		const slug = c.display_name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'client';
		return file(`analytics-${slug}-${stamp}.csv`, body);
	}

	const data = await loadPortfolio();
	if (data.error) return NextResponse.json({ error: data.error }, { status: 500 });
	const trend = toCsv(
		['month', 'contracts_synced', 'contracts_in_scope', 'secured', 'live', 'goal_total', 'contracts_with_goal', 'secured_toward_goal', 'secured_pct_of_goal'],
		data.months.map((m, i) => {
			const r = data.trend[i];
			return r
				? [r.month, r.contracts_synced, r.contracts_in_scope, r.secured_count, r.live_count, r.goal_total, r.contracts_with_goal, r.secured_toward_goal, r.secured_pct_of_goal]
				: [m, '', '', '', '', '', '', '', ''];
		}),
	);
	const contracts = toCsv(
		['client', 'contract_id', 'package', 'package_family', 'package_quota', 'goal_this_month', 'goal_source', 'status', 'starts_on', 'ends_on', 'renewal_on', 'per_month_usd', 'last_secured_month', 'days_since_last_secured'],
		data.contracts.map((c) => [
			c.display_name,
			c.airtable_contract_id,
			c.package,
			c.package_family,
			c.package_quota,
			c.current_month_goal,
			c.current_month_goal_source,
			c.status,
			c.starts_on,
			c.ends_on,
			c.renewal_on,
			c.per_month_cents != null ? c.per_month_cents / 100 : '',
			c.last_secured_month,
			c.days_since_last_secured,
		]),
	);
	return file(`analytics-portfolio-${stamp}.csv`, trend + '\r\n' + contracts);
}
