// Pure allowlist mappers for the finance:read and contracts:read MCP
// families. Both read tables that already exist (contracts, payments,
// clients_v2, v_client_analytics_contracts, v_client_payment_timeliness,
// v_portfolio_payment_timeliness); this is "a view over data that already
// exists", not new collection (Sterling's framing in the roster canvass).
//
// What never leaves: nothing here touches profiles.hourly_rate_cents,
// payroll_runs, comp_reconciliation or PAP. Money in this family is CLIENT
// money (contract value, invoices), never people's compensation.

export type ContractRow = {
	contract_id: string;
	client_id: string | null;
	display_name: string | null;
	airtable_contract_id: string | null;
	status: string;
	package: string | null;
	package_family: string | null;
	per_month_cents: number | null;
	starts_on: string | null;
	ends_on: string | null;
	term_months: number | null;
	renewal_on: string | null;
	last_secured_month: string | null;
	last_live_month: string | null;
	days_since_last_secured: number | null;
};

export const CONTRACT_COLUMNS =
	'contract_id, client_id, display_name, airtable_contract_id, status, package, package_family, per_month_cents, starts_on, ends_on, term_months, renewal_on, last_secured_month, last_live_month, days_since_last_secured';

export type ContractOut = {
	id: string;
	client_id: string | null;
	client_name: string | null;
	airtable_contract_id: string | null;
	status: string;
	package: string | null;
	package_family: string | null;
	per_month_usd: number | null;
	starts_on: string | null;
	ends_on: string | null;
	term_months: number | null;
	renewal_on: string | null;
	days_to_renewal: number | null;
	renewal_window: '30' | '60' | '90' | null;
	last_secured_month: string | null;
	last_live_month: string | null;
	days_since_last_secured: number | null;
	url: string | null;
};

export function daysBetween(fromIso: string, toIso: string): number {
	return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function renewalWindow(days: number | null): ContractOut['renewal_window'] {
	if (days === null || days < 0) return null;
	if (days <= 30) return '30';
	if (days <= 60) return '60';
	if (days <= 90) return '90';
	return null;
}

export function mapContract(raw: ContractRow, today: string): ContractOut {
	const days = raw.renewal_on ? daysBetween(today, raw.renewal_on) : null;
	return {
		id: raw.contract_id,
		client_id: raw.client_id,
		client_name: raw.display_name,
		airtable_contract_id: raw.airtable_contract_id,
		status: raw.status,
		package: raw.package,
		package_family: raw.package_family,
		per_month_usd: raw.per_month_cents === null ? null : Math.round(raw.per_month_cents) / 100,
		starts_on: raw.starts_on,
		ends_on: raw.ends_on,
		term_months: raw.term_months,
		renewal_on: raw.renewal_on,
		days_to_renewal: days,
		renewal_window: raw.status === 'active' ? renewalWindow(days) : null,
		last_secured_month: raw.last_secured_month,
		last_live_month: raw.last_live_month,
		days_since_last_secured: raw.days_since_last_secured,
		url: raw.client_id ? `/clients/${raw.client_id}` : null,
	};
}

export type PaymentRow = {
	id: string;
	airtable_contract_id: string | null;
	due_on: string | null;
	paid_on: string | null;
	status: string | null;
	type: string | null;
};

export const PAYMENT_COLUMNS = 'id, airtable_contract_id, due_on, paid_on, status, type';

/** decision 14: late at due date + 10 days, unpaid. */
export const LATE_GRACE_DAYS = 10;

export type PaymentOut = PaymentRow & {
	is_paid: boolean;
	is_late: boolean;
	days_overdue: number | null;
	client_name: string | null;
};

export function mapPayment(raw: PaymentRow, clientName: string | null, today: string): PaymentOut {
	const isPaid = raw.status === 'Paid' || !!raw.paid_on;
	const overdue = raw.due_on && !isPaid ? daysBetween(raw.due_on, today) : null;
	return {
		...raw,
		is_paid: isPaid,
		is_late: overdue !== null && overdue > LATE_GRACE_DAYS,
		days_overdue: overdue !== null && overdue > 0 ? overdue : null,
		client_name: clientName,
	};
}

export type TimelinessRow = {
	client_id: string | null;
	display_name: string | null;
	airtable_contract_id: string | null;
	on_time_count: number;
	late_count: number;
	unpaid_late_count: number;
	on_time_pct: number | null;
	measured: boolean;
	last_paid_on: string | null;
	next_due_on: string | null;
	payments_on_file: number;
};

export const TIMELINESS_COLUMNS =
	'client_id, display_name, airtable_contract_id, on_time_count, late_count, unpaid_late_count, on_time_pct, measured, last_paid_on, next_due_on, payments_on_file';

export type PortfolioRow = {
	on_time_count: number;
	late_count: number;
	unpaid_late_count: number;
	contracts_measured: number;
	contracts_in_scope: number;
	on_time_pct: number | null;
};

/** MRR from active contracts, by package family. Pure so it is testable. */
export function summarizeMrr(rows: ContractRow[]): { mrr_usd: number; active_contracts: number; by_family: Array<{ package_family: string; contracts: number; mrr_usd: number }> } {
	const active = rows.filter((r) => r.status === 'active');
	const fam = new Map<string, { contracts: number; cents: number }>();
	let cents = 0;
	for (const r of active) {
		const c = r.per_month_cents ?? 0;
		cents += c;
		const key = r.package_family ?? 'Other';
		const cur = fam.get(key) ?? { contracts: 0, cents: 0 };
		fam.set(key, { contracts: cur.contracts + 1, cents: cur.cents + c });
	}
	return {
		mrr_usd: Math.round(cents) / 100,
		active_contracts: active.length,
		by_family: [...fam.entries()]
			.map(([package_family, v]) => ({ package_family, contracts: v.contracts, mrr_usd: Math.round(v.cents) / 100 }))
			.sort((a, b) => b.mrr_usd - a.mrr_usd),
	};
}
