// The three reads behind the Delivery board and tab. Server only.
//
// Board and tab KPIs read the Supabase mirror with the caller's session —
// security-invoker views, so RLS on client_opp_months / contracts /
// health_scores decides visibility — and never Airtable. The tab's
// opportunity LIST reads the native media_opportunities table (0116) with
// the caller's session, and falls back to the Airtable read only where the
// native table has nothing for the client yet (AIRTABLE_SUNSET_PLAN.md 2.2).

import { format } from 'date-fns';
import { BASE_IDS, DataAdapterError, getAdapter } from '@/lib/data';
import { alignToMonths, trendMonths, type ClientTrendRow, type ContractRow } from '@/lib/clients/analytics';
import { isAirtableRecordId, primaryContract } from '@/lib/clients/key';
import { businessToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { buildBoardRows, countBoardRows, isBeaconPackage, sortBoardRows, type BoardRow, type HealthLatest, type PaceFilter } from './board';
import { asOfForMonth } from './pace';
import { NATIVE_OPP_SELECT, OPP_FIELDS, monthBounds, nativeToOppRow, oppsFormula, toOppRow, type NativeOppRow, type OppFields, type OppRow } from './opps';

/** Trend window on the board: the selected month and the three before it. */
export const BOARD_MONTHS = 4;

export function currentMonth(now: Date = new Date()): string {
	return businessToday(now).slice(0, 7);
}

export function isMonthParam(v: string | undefined): v is string {
	return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** "September 2026" for a `YYYY-MM`. */
export function monthTitle(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return format(new Date(y, m - 1, 1), 'MMMM yyyy');
}

/** First-of-month ISO dates ending at `month`, oldest first. */
function windowEndingAt(month: string, count: number): string[] {
	const [y, m] = month.split('-').map(Number);
	return trendMonths(new Date(y, m - 1, 15), count);
}

function errorMessage(e: unknown): string {
	if (e instanceof DataAdapterError) return `${e.status} — ${e.message}`;
	return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------

export interface DeliveryBoard {
	month: string;
	months: string[];
	rows: BoardRow[];
	counts: Record<PaceFilter, number>;
	syncedAt: string | null;
	error: string | null;
}

export async function loadDeliveryBoard(month: string, now: Date = new Date()): Promise<DeliveryBoard> {
	const supabase = await createClient();
	const months = windowEndingAt(month, BOARD_MONTHS);
	const from = months[0];
	const to = months[months.length - 1];

	const [contractsRes, trendRes, healthRes] = await Promise.all([
		supabase.from('v_client_analytics_contracts').select('*').order('display_name').returns<ContractRow[]>(),
		supabase.from('v_client_opp_trend').select('*').gte('month', from).lte('month', to).returns<ClientTrendRow[]>(),
		// Latest score per contract: newest period first, dedupe below.
		supabase
			.from('health_scores')
			.select('airtable_contract_id, total_score, period_month')
			.order('period_month', { ascending: false })
			.returns<HealthLatest[]>(),
	]);

	const error = [contractsRes, trendRes, healthRes].map((r) => r.error?.message).find(Boolean) ?? null;

	// Open Ronin only: Beacon has no opps quota (R1) and keeps its own tracker table.
	const contracts = (contractsRes.data ?? []).filter((c) => !isBeaconPackage(c.package));
	const trend = trendRes.data ?? [];
	const seen = new Set<string>();
	const health: HealthLatest[] = [];
	for (const h of healthRes.data ?? []) {
		if (seen.has(h.airtable_contract_id)) continue;
		seen.add(h.airtable_contract_id);
		health.push(h);
	}

	const rows = sortBoardRows(buildBoardRows(contracts, trend, health, months, month, asOfForMonth(month, now)));
	const syncedAt = trend.reduce<string | null>(
		(acc, t) => (t.synced_at && (!acc || t.synced_at > acc) ? t.synced_at : acc),
		null,
	);

	return { month, months, rows, counts: countBoardRows(rows), syncedAt, error };
}

// ---------------------------------------------------------------------------

export interface ClientDelivery {
	month: string;
	months: string[];
	contract: ContractRow | null;
	/** Twelve months ending at `month`, null where the mirror has no row. */
	trend: (ClientTrendRow | null)[];
	secured: number;
	live: number;
	goal: number | null;
	goalSource: string | null;
	synced: boolean;
	error: string | null;
}

export async function loadClientDelivery(clientId: string, month: string): Promise<ClientDelivery> {
	const supabase = await createClient();
	const months = windowEndingAt(month, 12);
	const empty = (contract: ContractRow | null, error: string | null): ClientDelivery => ({
		month,
		months,
		contract,
		trend: alignToMonths([], months),
		secured: 0,
		live: 0,
		goal: contract?.current_month_goal ?? null,
		goalSource: contract?.current_month_goal_source ?? null,
		synced: false,
		error,
	});

	const contractQ = supabase.from('v_client_analytics_contracts').select('*');
	const { data: contractRows, error: contractErr } = isAirtableRecordId(clientId)
		? await contractQ.eq('airtable_contract_id', clientId).limit(1).returns<ContractRow[]>()
		: await contractQ.eq('client_id', clientId).returns<ContractRow[]>();
	const contract = primaryContract(contractRows ?? []);
	if (!contract) return empty(null, contractErr?.message ?? null);

	const { data, error } = await supabase
		.from('v_client_opp_trend')
		.select('*')
		.eq('airtable_contract_id', contract.airtable_contract_id)
		.gte('month', months[0])
		.lte('month', months[months.length - 1])
		.order('month')
		.returns<ClientTrendRow[]>();
	const trend = alignToMonths(data ?? [], months);
	const cur = trend[trend.length - 1];

	return {
		month,
		months,
		contract,
		trend,
		secured: cur?.secured_count ?? 0,
		live: cur?.live_count ?? 0,
		goal: cur?.goal ?? contract.current_month_goal ?? null,
		goalSource: cur?.goal_source ?? contract.current_month_goal_source ?? null,
		synced: cur != null,
		error: error?.message ?? contractErr?.message ?? null,
	};
}

// ---------------------------------------------------------------------------

export interface ClientDeliveryOpps {
	rows: OppRow[];
	/** Where the rows came from: the native table (0116) or the Airtable fallback. */
	source: 'native' | 'airtable';
	error: string | null;
}

/**
 * Every Media Opportunity of the client in `month`, newest secured first.
 *
 * Reads the native media_opportunities table (0116) by client id, matching
 * the month on any of the three dates the KPI importer keys by. Falls back
 * to Airtable — the same name-matched formula as before — only when the
 * native table is not there yet (migration pending) or holds no rows for
 * this client (not seeded yet, a name the seed could not resolve, or a
 * Beacon client whose rows live in Beacon). The fallback goes away with
 * the Airtable base; it is the loader boundary AIRTABLE_SUNSET_PLAN names.
 */
export async function loadClientDeliveryOpps(clientId: string, clientName: string, month: string): Promise<ClientDeliveryOpps> {
	const native = await loadNativeOpps(clientId, month);
	if (native) return native;
	return loadAirtableOpps(clientName, month);
}

async function loadNativeOpps(clientId: string, month: string): Promise<ClientDeliveryOpps | null> {
	if (!clientId || isAirtableRecordId(clientId)) return null;
	const supabase = await createClient();
	const { from, to } = monthBounds(month);
	const inMonth = (col: string) => `and(${col}.gte.${from},${col}.lte.${to})`;
	const { data, error } = await supabase
		.from('media_opportunities')
		.select(NATIVE_OPP_SELECT)
		.eq('client_id', clientId)
		.or([inMonth('date_sent_to_client'), inMonth('date_secured'), inMonth('live_date')].join(','))
		.order('date_secured', { ascending: false, nullsFirst: false })
		.returns<NativeOppRow[]>();
	if (error) {
		// 42P01 / PGRST205: table not created yet. Anything else is a real error.
		if (/media_opportunities/.test(error.message) && /not exist|schema cache|relation/.test(error.message)) return null;
		return { rows: [], source: 'native', error: error.message };
	}
	if (data && data.length) return { rows: data.map(nativeToOppRow), source: 'native', error: null };
	// Nothing this month: native only if the client has rows at all.
	const { count } = await supabase.from('media_opportunities').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
	return count && count > 0 ? { rows: [], source: 'native', error: null } : null;
}

/**
 * Walks the Airtable cursor to exhaustion: one page (100) would silently
 * drop the rest of a busy month — Acme Snacks alone had 42 rows in September.
 */
async function loadAirtableOpps(clientName: string, month: string): Promise<ClientDeliveryOpps> {
	if (!clientName) return { rows: [], source: 'airtable', error: null };
	const adapter = getAdapter();
	const rows: OppRow[] = [];
	let cursor: string | undefined;
	try {
		do {
			const page = await adapter.list<OppFields>(BASE_IDS.CLIENT_MEDIA, 'Media Opportunities', {
				filter: oppsFormula(clientName, month),
				fields: OPP_FIELDS,
				sort: [{ field: 'Date Secured', direction: 'desc' }],
				pageSize: 100,
				cursor,
			});
			for (const r of page.rows) rows.push(toOppRow(r));
			cursor = page.cursor ?? undefined;
		} while (cursor);
		return { rows, source: 'airtable', error: null };
	} catch (e) {
		return { rows: [], source: 'airtable', error: errorMessage(e) };
	}
}
