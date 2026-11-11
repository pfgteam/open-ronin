// Contract renewal alerts (BOT_ROSTER_SYNTHESIS Tier B #12, Wildes). Pure
// so it is unit-testable; the cron route wires it to the notifications table.
//
// A contract crosses a window when its days-to-renewal is <= the window and
// it has not crossed it before. Idempotency is the dedupe key
// (contract-renewal:<contract_id>:<window>) on (user_id, dedupe_key): a daily
// run that finds the same contract inside the same window inserts nothing.

import { renewalWindow, type ContractOut } from '@/lib/mcp/mappers/finance';

export type RenewalWindow = '30' | '60' | '90';

export function renewalDedupeKey(contractId: string, window: RenewalWindow): string {
	return `contract-renewal:${contractId}:${window}`;
}

export function renewalCopy(c: ContractOut): { title: string; body: string } {
	const days = c.days_to_renewal ?? 0;
	const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
	return {
		title: `${c.client_name ?? 'A client'} contract renews ${when}`,
		body: `${c.package ?? 'Contract'}${c.per_month_usd ? ` at $${c.per_month_usd.toLocaleString('en-US')}/mo` : ''}, renewal date ${c.renewal_on}. Review terms, notice period and the renewal conversation before it rolls.`,
	};
}

/** Contracts inside a 30/60/90 window, with the window they sit in. */
export function contractsToAlert(rows: ContractOut[]): Array<{ contract: ContractOut; window: RenewalWindow }> {
	const out: Array<{ contract: ContractOut; window: RenewalWindow }> = [];
	for (const c of rows) {
		if (c.status !== 'active') continue;
		const w = renewalWindow(c.days_to_renewal);
		if (w) out.push({ contract: c, window: w });
	}
	return out;
}
