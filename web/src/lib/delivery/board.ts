// The board's row model. Pure: takes the three mirror reads the server
// loader makes (in-scope contracts, per-month trend rows, latest health) and
// returns sorted, filterable rows. Every number here is a column of a 0046 /
// 0071 read — the only arithmetic added is pace and a percentage.

import type { ClientTrendRow, ContractRow } from '@/lib/clients/analytics';
import { type Pace, paceOf } from './pace';

export type PaceFilter = Pace | 'zero' | 'all';
/** Sort buckets, in display order. `zero` = behind with nothing secured at all. */
export type Bucket = 'behind' | 'zero' | 'nogoal' | 'onpace' | 'met';

export interface HealthLatest {
	airtable_contract_id: string;
	/** numeric comes back as a string from PostgREST */
	total_score: number | string | null;
}

export interface BoardRow {
	clientId: string;
	contractId: string;
	airtableContractId: string;
	name: string;
	package: string | null;
	packageFamily: string;
	status: string;
	goal: number | null;
	goalSource: string | null;
	secured: number;
	live: number;
	/** false when the mirror has no row for this contract-month: 0 is then "not synced", not a real zero. */
	synced: boolean;
	pace: Pace;
	bucket: Bucket;
	pctOfGoal: number | null;
	/** secured per month, oldest first, aligned to the `months` window */
	trend: number[];
	lastSecuredMonth: string | null;
	health: number | null;
}

const BUCKET_ORDER: Record<Bucket, number> = { behind: 0, zero: 1, nogoal: 2, onpace: 3, met: 4 };

/** Beacon is a separate portfolio with no opps quota (R1); it keeps its own table. */
export function isBeaconPackage(pkg: string | null | undefined): boolean {
	return !!pkg && /beacon/i.test(pkg);
}

function toNumber(v: number | string | null | undefined): number | null {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

export function buildBoardRows(
	contracts: ContractRow[],
	trend: ClientTrendRow[],
	health: HealthLatest[],
	months: string[],
	month: string,
	asOf: Date,
): BoardRow[] {
	const monthKey = `${month}-01`;
	const byContract = new Map<string, Map<string, ClientTrendRow>>();
	for (const t of trend) {
		let m = byContract.get(t.airtable_contract_id);
		if (!m) byContract.set(t.airtable_contract_id, (m = new Map()));
		m.set(t.month, t);
	}
	const healthBy = new Map(health.map((h) => [h.airtable_contract_id, toNumber(h.total_score)]));

	return contracts.map((c) => {
		const rows = byContract.get(c.airtable_contract_id);
		const cur = rows?.get(monthKey);
		const goal = cur?.goal ?? c.current_month_goal ?? null;
		const secured = cur?.secured_count ?? 0;
		const pace = paceOf(secured, goal, asOf);
		const bucket: Bucket = pace === 'behind' && secured === 0 ? 'zero' : pace;
		return {
			clientId: c.client_id,
			contractId: c.contract_id,
			airtableContractId: c.airtable_contract_id,
			name: c.display_name,
			package: c.package,
			packageFamily: c.package_family,
			status: c.status,
			goal,
			goalSource: cur?.goal_source ?? c.current_month_goal_source ?? null,
			secured,
			live: cur?.live_count ?? 0,
			synced: cur != null,
			pace,
			bucket,
			pctOfGoal: goal && goal > 0 ? Math.round((secured / goal) * 100) : null,
			trend: months.map((m) => rows?.get(m)?.secured_count ?? 0),
			lastSecuredMonth: c.last_secured_month,
			health: healthBy.get(c.airtable_contract_id) ?? null,
		};
	});
}

/** Attention first: behind (lowest pct first) → zero → no goal → on pace → met; name breaks ties. */
export function sortBoardRows(rows: BoardRow[]): BoardRow[] {
	return [...rows].sort(
		(a, b) =>
			BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
			(a.bucket === 'behind' ? (a.pctOfGoal ?? 0) - (b.pctOfGoal ?? 0) : 0) ||
			a.name.localeCompare(b.name),
	);
}

export function filterBoardRows(rows: BoardRow[], f: PaceFilter): BoardRow[] {
	if (f === 'all') return rows;
	if (f === 'zero') return rows.filter((r) => r.bucket === 'zero');
	return rows.filter((r) => r.pace === f);
}

export function countBoardRows(rows: BoardRow[]): Record<PaceFilter, number> {
	const c: Record<PaceFilter, number> = { all: rows.length, behind: 0, zero: 0, nogoal: 0, onpace: 0, met: 0 };
	for (const r of rows) {
		c[r.pace]++;
		if (r.bucket === 'zero') c.zero++;
	}
	return c;
}
