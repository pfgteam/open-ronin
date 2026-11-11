// Client Analytics readers. Every number here comes from the 0071 views; the
// page holds no arithmetic beyond formatting (MIGRATION_READINESS.md rule 6).
// No Airtable: if a figure is missing, the importer that feeds the mirror is
// what needs fixing, and the page says so.
//
// Reads run with the caller's session (security_invoker views), so RLS on
// client_opp_months, payments, contracts and live_links decides visibility.

import { createClient } from '@/lib/supabase/server';
import { format, startOfMonth } from 'date-fns';
import { alignToMonths, trendMonths } from './analyticsShared';
import { isAirtableRecordId, primaryContract } from './key';

export { TREND_MONTHS, alignToMonths, monthLabel, trendMonths } from './analyticsShared';

export interface ContractRow {
	contract_id: string;
	client_id: string;
	display_name: string;
	airtable_contract_id: string;
	status: string;
	package: string | null;
	package_family: string;
	package_quota: number | null;
	current_month_goal: number | null;
	current_month_goal_source: string | null;
	per_month_cents: number | null;
	starts_on: string | null;
	ends_on: string | null;
	term_months: number | null;
	renewal_on: string | null;
	last_secured_month: string | null;
	last_live_month: string | null;
	days_since_last_secured: number | null;
	opps_synced_at: string | null;
}

export interface PortfolioTrendRow {
	month: string;
	contracts_synced: number;
	contracts_in_scope: number;
	secured_count: number;
	live_count: number;
	goal_total: number | null;
	contracts_with_goal: number;
	secured_toward_goal: number | null;
	secured_pct_of_goal: number | null;
	synced_at: string | null;
}

export interface ClientTrendRow {
	airtable_contract_id: string;
	month: string;
	secured_count: number;
	live_count: number;
	goal: number | null;
	goal_source: string | null;
	secured_pct_of_goal: number | null;
	synced_at: string | null;
}

export interface PackageMixRow {
	package_family: string;
	contracts: number;
	clients: number;
	monthly_quota_each: number | null;
	monthly_quota_total: number | null;
	per_month_cents_total: number | null;
}

export interface PaymentRow {
	client_id: string;
	display_name: string;
	airtable_contract_id: string;
	on_time_count: number;
	late_count: number;
	unpaid_late_count: number;
	on_time_pct: number | null;
	measured: boolean;
	last_paid_on: string | null;
	next_due_on: string | null;
	payments_on_file: number;
}

export interface PortfolioPaymentRow {
	on_time_count: number;
	late_count: number;
	unpaid_late_count: number;
	contracts_measured: number;
	contracts_in_scope: number;
	on_time_pct: number | null;
}

export interface LiveLinksWeekRow {
	week_start: string;
	week_end: string;
	live_links: number;
	tier_one_links: number;
	contracts_with_links: number;
	reach: number | null;
	est_value_cents: number | null;
}

export interface TierShareRow {
	month: string;
	live_links: number;
	tier_one_links: number;
	tier_one_pct: number | null;
}

export interface TopOutletRow {
	airtable_contract_id: string;
	outlet: string;
	live_links: number;
	last_live_on: string | null;
	reach: number | null;
}

function windowStart(months: string[]): string {
	return months[0] ?? format(startOfMonth(new Date()), 'yyyy-MM-dd');
}

export interface PortfolioAnalytics {
	months: string[];
	trend: (PortfolioTrendRow | null)[];
	packageMix: PackageMixRow[];
	payments: PortfolioPaymentRow | null;
	liveLinksWeekly: LiveLinksWeekRow[];
	tierShare: (TierShareRow | null)[];
	contracts: ContractRow[];
	error: string | null;
}

export async function loadPortfolio(now: Date = new Date()): Promise<PortfolioAnalytics> {
	const supabase = await createClient();
	const months = trendMonths(now);
	const from = windowStart(months);

	const [trend, mix, pay, weekly, tier, contracts] = await Promise.all([
		supabase.from('v_portfolio_opp_trend').select('*').gte('month', from).order('month'),
		supabase.from('v_portfolio_package_mix').select('*').order('contracts', { ascending: false }),
		supabase.from('v_portfolio_payment_timeliness').select('*').maybeSingle(),
		supabase.from('v_live_links_weekly').select('*').order('week_start'),
		supabase.from('v_portfolio_tier_share').select('*').gte('month', from).order('month'),
		supabase.from('v_client_analytics_contracts').select('*').order('display_name'),
	]);

	const error = [trend, mix, pay, weekly, tier, contracts].map((r) => r.error?.message).find(Boolean) ?? null;

	return {
		months,
		trend: alignToMonths((trend.data ?? []) as PortfolioTrendRow[], months),
		packageMix: (mix.data ?? []) as PackageMixRow[],
		payments: (pay.data ?? null) as PortfolioPaymentRow | null,
		liveLinksWeekly: (weekly.data ?? []) as LiveLinksWeekRow[],
		tierShare: alignToMonths((tier.data ?? []) as TierShareRow[], months),
		contracts: (contracts.data ?? []) as ContractRow[],
		error,
	};
}

export interface ClientAnalytics {
	months: string[];
	contract: ContractRow | null;
	trend: (ClientTrendRow | null)[];
	payments: PaymentRow | null;
	topOutlets: TopOutletRow[];
	liveLinkCount: number;
	error: string | null;
}

/**
 * `client` is the clients_v2.id (the key /clients/[id] uses since the rekey).
 * The 0071 views are per contract, so the client's in-scope contract is found
 * through v_client_analytics_contracts.client_id and its airtable_contract_id
 * keys the rest. A legacy Airtable record id is still accepted and resolved
 * the old way so old links keep working (the page 308s them to the client id).
 */
export async function loadClient(clientOrContractId: string, now: Date = new Date()): Promise<ClientAnalytics> {
	const supabase = await createClient();
	const months = trendMonths(now);
	const from = windowStart(months);

	const byRec = isAirtableRecordId(clientOrContractId);
	const contractQ = supabase.from('v_client_analytics_contracts').select('*');
	const { data: contractRows, error: contractErr } = byRec
		? await contractQ.eq('airtable_contract_id', clientOrContractId).limit(1).returns<ContractRow[]>()
		: await contractQ.eq('client_id', clientOrContractId).returns<ContractRow[]>();
	// A client with two in-scope contracts (rare: 17 clients hold two rows,
	// almost all closed) shows the one that best represents it.
	const contractRow = primaryContract(contractRows ?? []);
	const airtableContractId = contractRow?.airtable_contract_id ?? null;

	if (!airtableContractId) {
		return { months, contract: null, trend: alignToMonths([], months), payments: null, topOutlets: [], liveLinkCount: 0, error: contractErr?.message ?? null };
	}

	const [trend, pay, outlets, links] = await Promise.all([
		supabase
			.from('v_client_opp_trend')
			.select('*')
			.eq('airtable_contract_id', airtableContractId)
			.gte('month', from)
			.order('month'),
		supabase.from('v_client_payment_timeliness').select('*').eq('airtable_contract_id', airtableContractId).maybeSingle(),
		supabase
			.from('v_client_top_outlets')
			.select('*')
			.eq('airtable_contract_id', airtableContractId)
			.order('live_links', { ascending: false })
			.limit(10),
		supabase
			.from('live_links')
			.select('id', { count: 'exact', head: true })
			.eq('airtable_contract_id', airtableContractId),
	]);

	const error = [trend, pay, outlets, links].map((r) => r.error?.message).find(Boolean) ?? contractErr?.message ?? null;

	return {
		months,
		contract: contractRow,
		trend: alignToMonths((trend.data ?? []) as ClientTrendRow[], months),
		payments: (pay.data ?? null) as PaymentRow | null,
		topOutlets: (outlets.data ?? []) as TopOutletRow[],
		liveLinkCount: links.count ?? 0,
		error,
	};
}
