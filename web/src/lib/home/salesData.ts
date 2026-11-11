// Self → Sales loader (spec §2, §4, §5). Runs only for viewers with an
// active rev_lanes_people row; everyone else gets null and Self renders as
// before with one cheap query spent. Reads only — no writes, no schema.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig, loadDailyMetrics, loadGhlBaseUrl, loadLanes, loadMyDay } from '@/lib/revenue/server';
import { ghlContactUrl } from '@/lib/revenue/ghlImport';
import { chicagoDay, rangeFor, sumBy } from '@/lib/revenue/metrics';
import { LANE_LABELS, type DispositionRow, type Lane, type PipelineRow, type StageRow } from '@/lib/revenue/shared';
import {
	matchCallsToDeals, pickTargets, salesCallEmails, todayCallDeals,
	type CallMatch, type SalesCallEvent, type SalesRow, type TargetTile,
} from './sales';

type Db = SupabaseClient;

export const SALES_QUEUE_LIMIT = 200;
const CHUNK = 100;

export interface SalesData {
	lanes: string[];
	laneLabel: string;
	rows: SalesRow[];
	truncated: boolean;
	targets: TargetTile[];
	goalMinutes: number;
	/** eventId → deal, for the agenda. */
	calls: Record<string, CallMatch>;
	/** dealId → today's earliest call start, for the "Calls today" group. */
	callDeals: Record<string, string>;
	dispositions: DispositionRow[];
	stages: StageRow[];
	pipelines: PipelineRow[];
}

function chunks<T>(xs: T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
	return out;
}

type Extra = { id: string; primary_person_id: string | null; pipeline_id: string | null; stage_id: string | null; ghl_location_id: string | null; ghl_contact_id: string | null };
type CallDeal = { id: string; title: string; primary_person_id: string | null; updated_at: string };

export async function loadSalesData(db: Db, userId: string, events: SalesCallEvent[]): Promise<SalesData | null> {
	const { data: laneRows, error } = await db.from('rev_lanes_people').select('lane').eq('user_id', userId).eq('is_active', true);
	if (error || !laneRows || laneRows.length === 0) return null;
	const lanes = [...new Set((laneRows as { lane: string }[]).map((r) => r.lane))];

	const today = chicagoDay();
	const week = rangeFor('week', today);
	const emails = salesCallEmails(events);
	const [queue, config, lanesAll, dayRows, weekRows, ghlBase, peopleRes] = await Promise.all([
		loadMyDay(db, userId, SALES_QUEUE_LIMIT),
		loadConfig(db),
		loadLanes(db),
		loadDailyMetrics(db, today, today, userId),
		loadDailyMetrics(db, week.from, week.to, userId),
		loadGhlBaseUrl(db),
		// email_key = lower(btrim(email)) (0121): rev_people.email keeps whatever case it was typed in.
		emails.length ? db.from('rev_people').select('id, email_key').in('email_key', emails) : Promise.resolve({ data: [] as { id: string; email_key: string | null }[] }),
	]);
	if (config.notApplied) return null;

	const ids = queue.map((r) => r.deal_id);
	const newIds = queue.filter((r) => r.reason === 'new lead').map((r) => r.deal_id);
	const people = ((peopleRes.data ?? []) as { id: string; email_key: string | null }[]).map((p) => ({ id: p.id, email: p.email_key }));

	const [extraRes, answeredRes, callDealsRes] = await Promise.all([
		Promise.all(chunks(ids).map((c) => db.from('rev_deals').select('id, primary_person_id, pipeline_id, stage_id, ghl_location_id, ghl_contact_id').in('id', c))),
		newIds.length ? db.from('rev_activities').select('deal_id').in('deal_id', newIds).eq('direction', 'outbound') : Promise.resolve({ data: [] as { deal_id: string }[] }),
		people.length
			? db.from('rev_deals').select('id, title, primary_person_id, updated_at').in('primary_person_id', people.map((p) => p.id)).eq('status', 'open')
			: Promise.resolve({ data: [] as CallDeal[] }),
	]);

	const extra = new Map<string, Extra>();
	for (const res of extraRes) for (const x of (res.data ?? []) as Extra[]) extra.set(x.id, x);
	const answered = new Set(((answeredRes.data ?? []) as { deal_id: string }[]).map((a) => a.deal_id));

	const rows: SalesRow[] = queue.map((r) => {
		const x = extra.get(r.deal_id);
		return {
			...r,
			person_id: x?.primary_person_id ?? null,
			pipeline_id: x?.pipeline_id ?? null,
			stage_id: x?.stage_id ?? null,
			answered: answered.has(r.deal_id),
			ghl_url: ghlContactUrl(ghlBase, x?.ghl_location_id, x?.ghl_contact_id),
		};
	});

	const calls = matchCallsToDeals(events, people, (callDealsRes.data ?? []) as CallDeal[]);
	const goal = lanesAll.rules.find((r) => r.key === 'speed_to_lead_goal')?.value ?? 5;

	return {
		lanes,
		laneLabel: lanes.map((l) => LANE_LABELS[l as Lane] ?? l).join(' + '),
		rows,
		truncated: queue.length >= SALES_QUEUE_LIMIT,
		targets: pickTargets(lanesAll.targets, lanes, userId, sumBy(dayRows), sumBy(weekRows)),
		goalMinutes: goal,
		calls,
		callDeals: todayCallDeals(events, calls, new Date()),
		dispositions: config.dispositions.filter((d) => d.is_active),
		stages: config.stages,
		pipelines: config.pipelines,
	};
}
