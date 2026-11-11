// Media-opp monthly counts: the pure aggregation behind
// /api/cron/opp-months (ported from scripts/import-opp-months.ts so the
// health score's opps_vs_goal factor is fed daily rather than by a script
// someone last ran on 2026-08-24). BOT_ROSTER_SYNTHESIS Tier A #2.
//
// Counting rule (openronin-decisions.md R3, Alex 2026-08-24):
//   secured  = status in the secured or client_lost buckets, never bare
//              Date Secured (filled on ~96% of rows incl. declines).
//   month    = Date Sent to Client, else Date Secured, else Date Added,
//              taken only AFTER the bucket filter.
//   live     = Live Link non-empty, attributed to Live Date's month.
// Explicit zeros: every in-scope contract gets a row for every window month,
// so a missing row means "not synced" and a zero means zero.

// R3 buckets: keep in lockstep with web/src/lib/media/status.ts
export const SECURED_STATUSES: ReadonlySet<string> = new Set([
	'Warm lead (responded)', 'Product Request', 'Sent Product', 'Paid Opp', 'Scheduled',
	'Waiting to go Live', 'Live – Pending Client Approval', 'Secured Coverage',
	'Client Decline', 'Client Unresponsive', 'Client Missed Deadline',
]);

export const WINDOW_MONTHS = 14;

export type OppRecord = {
	status: string;
	clientName: string | null;
	dateSent?: string;
	dateSecured?: string;
	dateAdded?: string;
	liveLink?: string;
	liveDate?: string;
};

export type OppMonthRow = { airtable_contract_id: string; month: string; secured_count: number; live_count: number; synced_at: string };

export type OppAggregate = {
	rows: OppMonthRow[];
	skipped: { no_client_name: number; unresolved_name: number; client_not_in_scope: number; multi_contract_ambiguous: number };
	unresolved_names: Array<[string, number]>;
	secured_month_basis: { date_sent: number; date_secured: number; date_added: number; none: number };
};

export const fold = (s: string) =>
	s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function monthOf(d: string | undefined): string | null {
	return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) + '-01' : null;
}

/** name -> clients_v2.id from display names + aliases; folded matches only when unique. */
export function buildNameResolver(clients: Array<{ id: string; display_name: string }>, aliases: Array<{ client_id: string; raw_name: string }>): (raw: string) => string | undefined {
	const exact = new Map<string, string>();
	const foldCounts = new Map<string, Set<string>>();
	const add = (name: string, id: string, exactWins: boolean) => {
		const lk = name.toLowerCase().trim();
		if (exactWins || !exact.has(lk)) exact.set(lk, id);
		const k = fold(name);
		if (!foldCounts.has(k)) foldCounts.set(k, new Set());
		foldCounts.get(k)!.add(id);
	};
	for (const c of clients) add(c.display_name, c.id, true);
	for (const a of aliases) add(a.raw_name, a.client_id, false);
	const folded = new Map<string, string>();
	for (const [k, ids] of foldCounts) if (ids.size === 1) folded.set(k, [...ids][0]);
	return (raw) => exact.get(raw.toLowerCase().trim()) ?? folded.get(fold(raw));
}

export function windowMonths(now: Date, n = WINDOW_MONTHS): string[] {
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 10));
	return out;
}

export function aggregateOppMonths(
	opps: OppRecord[],
	resolveName: (raw: string) => string | undefined,
	contractsByClient: Map<string, string[]>,
	now: Date,
): OppAggregate {
	const counts = new Map<string, { secured: number; live: number }>();
	const bump = (contract: string, month: string, kind: 'secured' | 'live') => {
		const k = `${contract}|${month}`;
		if (!counts.has(k)) counts.set(k, { secured: 0, live: 0 });
		counts.get(k)![kind]++;
	};
	const skipped = { no_client_name: 0, unresolved_name: 0, client_not_in_scope: 0, multi_contract_ambiguous: 0 };
	const unresolved = new Map<string, number>();
	const basis = { date_sent: 0, date_secured: 0, date_added: 0, none: 0 };

	for (const o of opps) {
		if (!o.clientName) { skipped.no_client_name++; continue; }
		const clientId = resolveName(o.clientName);
		if (!clientId) { skipped.unresolved_name++; unresolved.set(o.clientName, (unresolved.get(o.clientName) ?? 0) + 1); continue; }
		const ids = contractsByClient.get(clientId) ?? [];
		if (ids.length === 0) { skipped.client_not_in_scope++; continue; }
		if (ids.length > 1) { skipped.multi_contract_ambiguous++; continue; }
		const contract = ids[0];
		if (SECURED_STATUSES.has(o.status.trim())) {
			const sent = monthOf(o.dateSent), secured = monthOf(o.dateSecured), added = monthOf(o.dateAdded);
			const m = sent ?? secured ?? added;
			if (sent) basis.date_sent++; else if (secured) basis.date_secured++; else if (added) basis.date_added++; else basis.none++;
			if (m) bump(contract, m, 'secured');
		}
		const liveMonth = monthOf(o.liveDate);
		if (typeof o.liveLink === 'string' && o.liveLink.trim() && liveMonth) bump(contract, liveMonth, 'live');
	}

	const months = windowMonths(now);
	const windowSet = new Set(months);
	const synced_at = now.toISOString();
	const rows: OppMonthRow[] = [];
	for (const ids of contractsByClient.values()) {
		if (ids.length !== 1) continue;
		for (const month of months) {
			const c = counts.get(`${ids[0]}|${month}`);
			rows.push({ airtable_contract_id: ids[0], month, secured_count: c?.secured ?? 0, live_count: c?.live ?? 0, synced_at });
		}
	}
	for (const [k, c] of counts) {
		const [contract, month] = k.split('|');
		if (!windowSet.has(month)) rows.push({ airtable_contract_id: contract, month, secured_count: c.secured, live_count: c.live, synced_at });
	}
	return { rows, skipped, unresolved_names: [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12), secured_month_basis: basis };
}
