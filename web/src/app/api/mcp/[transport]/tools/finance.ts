import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError, MAX_SCAN } from '@/lib/mcp/tooling';
import { businessToday } from '@/lib/format';
import {
	CONTRACT_COLUMNS, PAYMENT_COLUMNS, TIMELINESS_COLUMNS, mapContract, mapPayment, summarizeMrr,
	type ContractRow, type PaymentRow, type PortfolioRow, type TimelinessRow,
} from '@/lib/mcp/mappers/finance';

// The `finance:read` family (Sterling, business_finance identity) and the
// `contracts:read` family (Wildes, legal_contracts identity). Both are views
// over tables that already exist; nothing here writes. Read-only by design:
// a finance or contract change is a person's job in the app (or Airtable,
// until the sunset), never an agent proposal.

const LIMIT = z.number().int().min(1).max(200).default(50);

async function contractsFor(filter: { status?: string; client_id?: string; airtable_contract_id?: string; package_family?: string }): Promise<ContractRow[]> {
	const supabase = createServiceRoleClient();
	let q = supabase.from('v_client_analytics_contracts').select(CONTRACT_COLUMNS).limit(MAX_SCAN);
	if (filter.status) q = q.eq('status', filter.status);
	if (filter.client_id) q = q.eq('client_id', filter.client_id);
	if (filter.airtable_contract_id) q = q.eq('airtable_contract_id', filter.airtable_contract_id);
	if (filter.package_family) q = q.eq('package_family', filter.package_family);
	const { data, error } = await q.returns<ContractRow[]>();
	if (error) throw error;
	return data ?? [];
}

export function registerFinanceTools(server: McpServer): void {
	server.registerTool(
		'finance_portfolio_summary',
		{
			title: 'Finance portfolio summary',
			description:
				'One call for the numbers Sterling asks for first: MRR from active contracts (total and by package family), portfolio payment timeliness (on-time %, late, unpaid-late counts; late = due date + 10 days unpaid), late unpaid invoices by client, and contracts renewing in 30/60/90 days. Client money only; never compensation.',
			inputSchema: {},
		},
		async (_args, extra) =>
			audited('finance_portfolio_summary', 'finance:read', extra.authInfo, {}, 'the finance summary', async () => {
				const supabase = createServiceRoleClient();
				const today = businessToday();
				const [contracts, { data: portfolio, error: pErr }, { data: timeliness, error: tErr }] = await Promise.all([
					contractsFor({}),
					supabase.from('v_portfolio_payment_timeliness').select('*').maybeSingle<PortfolioRow>(),
					supabase.from('v_client_payment_timeliness').select(TIMELINESS_COLUMNS).gt('unpaid_late_count', 0).order('unpaid_late_count', { ascending: false }).limit(50).returns<TimelinessRow[]>(),
				]);
				if (pErr) throw pErr;
				if (tErr) throw tErr;
				const mrr = summarizeMrr(contracts);
				const mapped = contracts.map((c) => mapContract(c, today));
				const renewing = { '30': 0, '60': 0, '90': 0 };
				for (const c of mapped) if (c.renewal_window) renewing[c.renewal_window] += 1;
				const payload = {
					as_of: today,
					mrr,
					payment_timeliness: portfolio ?? null,
					late_unpaid_by_client: (timeliness ?? []).map((t) => ({ client_id: t.client_id, client_name: t.display_name, unpaid_late_count: t.unpaid_late_count, late_count: t.late_count, on_time_pct: t.on_time_pct, next_due_on: t.next_due_on })),
					renewing_contracts: renewing,
					contracts_total: contracts.length,
				};
				return { payload, rows: 1 + (timeliness?.length ?? 0) };
			}),
	);

	server.registerTool(
		'list_payments',
		{
			title: 'List payments',
			description:
				'Invoices/payments (payments table, 586 rows synced from Airtable) with paid/late flags. Filter by client (clients_v2 id or Airtable contract id), late-only (unpaid past due + 10 days), unpaid-only, type, or due date range. Newest due date first.',
			inputSchema: {
				client_id: z.string().uuid().optional(),
				airtable_contract_id: z.string().optional(),
				late_only: z.boolean().default(false),
				unpaid_only: z.boolean().default(false),
				type: z.string().max(60).optional(),
				due_from: z.string().date().optional(),
				due_to: z.string().date().optional(),
				limit: LIMIT,
			},
		},
		async ({ client_id, airtable_contract_id, late_only, unpaid_only, type, due_from, due_to, limit }, extra) =>
			audited('list_payments', 'finance:read', extra.authInfo, { client_id, airtable_contract_id, late_only, unpaid_only, type, due_from, due_to, limit }, 'payments', async () => {
				const supabase = createServiceRoleClient();
				const today = businessToday();
				let contractIds: string[] | null = null;
				if (client_id) {
					const cs = await contractsFor({ client_id });
					contractIds = cs.map((c) => c.airtable_contract_id).filter((v): v is string => !!v);
					if (contractIds.length === 0) throw userError(`No contracts found for client ${client_id}.`);
				} else if (airtable_contract_id) {
					contractIds = [airtable_contract_id];
				}
				let q = supabase.from('payments').select(PAYMENT_COLUMNS).order('due_on', { ascending: false, nullsFirst: false }).limit(MAX_SCAN);
				if (contractIds) q = q.in('airtable_contract_id', contractIds);
				if (type) q = q.eq('type', type);
				if (due_from) q = q.gte('due_on', due_from);
				if (due_to) q = q.lte('due_on', due_to);
				if (unpaid_only || late_only) q = q.neq('status', 'Paid').is('paid_on', null);
				const { data, error } = await q.returns<PaymentRow[]>();
				if (error) throw error;
				const names = await clientNamesByContract((data ?? []).map((p) => p.airtable_contract_id));
				let rows = (data ?? []).map((p) => mapPayment(p, names.get(p.airtable_contract_id ?? '') ?? null, today));
				if (late_only) rows = rows.filter((r) => r.is_late);
				const truncated = rows.length > limit || (data ?? []).length >= MAX_SCAN;
				const page = rows.slice(0, limit);
				return { payload: { rows: page, count: rows.length, truncated }, rows: page.length };
			}),
	);

	server.registerTool(
		'get_client_billing',
		{
			title: 'Get one client billing view',
			description: 'For one client (clients_v2 id): its contracts (package, monthly value, term, renewal), payment timeliness, and the last 24 invoices. The per-client input Pulse and Sterling both asked for.',
			inputSchema: { client_id: z.string().uuid() },
		},
		async ({ client_id }, extra) =>
			audited('get_client_billing', 'finance:read', extra.authInfo, { client_id }, 'this client billing', async () => {
				const supabase = createServiceRoleClient();
				const today = businessToday();
				const contracts = await contractsFor({ client_id });
				if (contracts.length === 0) throw userError(`No contracts found for client ${client_id}.`);
				const ids = contracts.map((c) => c.airtable_contract_id).filter((v): v is string => !!v);
				const [{ data: timeliness }, { data: payments, error }] = await Promise.all([
					supabase.from('v_client_payment_timeliness').select(TIMELINESS_COLUMNS).eq('client_id', client_id).returns<TimelinessRow[]>(),
					supabase.from('payments').select(PAYMENT_COLUMNS).in('airtable_contract_id', ids).order('due_on', { ascending: false, nullsFirst: false }).limit(24).returns<PaymentRow[]>(),
				]);
				if (error) throw error;
				const name = contracts[0].display_name;
				const payload = {
					client_id,
					client_name: name,
					contracts: contracts.map((c) => mapContract(c, today)),
					mrr_usd: summarizeMrr(contracts).mrr_usd,
					payment_timeliness: timeliness ?? [],
					recent_payments: (payments ?? []).map((p) => mapPayment(p, name, today)),
				};
				return { payload, rows: contracts.length + (payments?.length ?? 0) };
			}),
	);
}

export function registerContractTools(server: McpServer): void {
	server.registerTool(
		'list_contracts',
		{
			title: 'List contracts',
			description:
				'The contract register (contracts + clients_v2, via v_client_analytics_contracts): package, family, monthly value, start/end, term, computed renewal date and a 30/60/90-day renewal window flag. Defaults to active contracts; filter by status, package family, client, or renewing_within days. Sorted by renewal date, soonest first.',
			inputSchema: {
				status: z.string().max(40).optional(),
				package_family: z.string().max(60).optional(),
				client_id: z.string().uuid().optional(),
				renewing_within_days: z.number().int().min(1).max(365).optional(),
				limit: LIMIT,
			},
		},
		async ({ status, package_family, client_id, renewing_within_days, limit }, extra) =>
			audited('list_contracts', 'contracts:read', extra.authInfo, { status, package_family, client_id, renewing_within_days, limit }, 'contracts', async () => {
				const today = businessToday();
				const contracts = await contractsFor({ status: status ?? 'active', package_family, client_id });
				let rows = contracts.map((c) => mapContract(c, today));
				if (renewing_within_days) rows = rows.filter((r) => r.days_to_renewal !== null && r.days_to_renewal >= 0 && r.days_to_renewal <= renewing_within_days);
				rows.sort((a, b) => (a.renewal_on ?? '9999').localeCompare(b.renewal_on ?? '9999'));
				const truncated = rows.length > limit || contracts.length >= MAX_SCAN;
				const page = rows.slice(0, limit);
				return { payload: { rows: page, count: rows.length, truncated }, rows: page.length };
			}),
	);

	server.registerTool(
		'get_contract',
		{
			title: 'Get one contract',
			description: 'One contract by id (contracts.id) or Airtable contract id, with the client legal name and notice period from client_meta when present. Read-only.',
			inputSchema: { id: z.string().uuid().optional(), airtable_contract_id: z.string().optional() },
		},
		async ({ id, airtable_contract_id }, extra) =>
			audited('get_contract', 'contracts:read', extra.authInfo, { id, airtable_contract_id }, 'this contract', async () => {
				if (!id && !airtable_contract_id) throw userError('Pass id or airtable_contract_id.');
				const supabase = createServiceRoleClient();
				const today = businessToday();
				let q = supabase.from('v_client_analytics_contracts').select(CONTRACT_COLUMNS);
				q = id ? q.eq('contract_id', id) : q.eq('airtable_contract_id', airtable_contract_id!);
				const { data, error } = await q.maybeSingle<ContractRow>();
				if (error) throw error;
				if (!data) throw userError(`No contract matches ${id ?? airtable_contract_id}.`);
				const { data: meta } = data.airtable_contract_id
					? await supabase.from('client_meta').select('contract_legal_name, notice_period_days, brand_anniversary').eq('airtable_contract_id', data.airtable_contract_id).maybeSingle<{ contract_legal_name: string | null; notice_period_days: number | null; brand_anniversary: string | null }>()
					: { data: null };
				return { payload: { contract: mapContract(data, today), legal_name: meta?.contract_legal_name ?? null, notice_period_days: meta?.notice_period_days ?? null, brand_anniversary: meta?.brand_anniversary ?? null }, rows: 1 };
			}),
	);
}

async function clientNamesByContract(ids: Array<string | null>): Promise<Map<string, string>> {
	const wanted = [...new Set(ids.filter((v): v is string => !!v))];
	if (wanted.length === 0) return new Map();
	const supabase = createServiceRoleClient();
	const { data } = await supabase.from('v_client_analytics_contracts').select('airtable_contract_id, display_name').in('airtable_contract_id', wanted).returns<{ airtable_contract_id: string; display_name: string | null }[]>();
	return new Map((data ?? []).filter((r) => r.display_name).map((r) => [r.airtable_contract_id, r.display_name as string]));
}
