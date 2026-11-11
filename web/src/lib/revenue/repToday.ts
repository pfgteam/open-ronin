// "Today by rep" (spec §6): the manager's replacement for My Day's "View as".
// Same grouping rules as the rep's own Sales tab, counted instead of listed.
// Answered state is unknown here (no per-deal outbound read), so every new
// lead counts as unanswered — the dashboard errs toward flagging.

import { salesGroupOf, slowNewLeads, type SalesRow } from '@/lib/home/sales';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MyDayRow } from './server';

const asSales = (r: MyDayRow): SalesRow => ({ ...r, person_id: null, pipeline_id: null, stage_id: null, answered: false, ghl_url: null });

export function summarizeRep(rows: MyDayRow[], now: Date, goalMinutes: number): { queue: number; slowNew: number; overdue: number; noNext: number } {
	const s = rows.map(asSales);
	let overdue = 0;
	let noNext = 0;
	for (const r of s) {
		const g = salesGroupOf(r, now, {});
		if (g === 'overdue') overdue++;
		else if (g === 'none') noNext++;
	}
	return { queue: s.length, slowNew: slowNewLeads(s, now, goalMinutes), overdue, noNext };
}

/**
 * Latest activity per rep. One `limit(1)` read per rep (≈10 people): a single
 * team-wide "latest N" read is flooded by the setters' ~100 dials a day and
 * drops a closer whose last call was yesterday.
 */
export async function loadLastActivity(db: SupabaseClient, users: string[]): Promise<Map<string, { kind: string; occurred_at: string }>> {
	const rows = await Promise.all(
		users.map((u) => db.from('rev_activities').select('actor_id, kind, occurred_at').eq('actor_id', u).order('occurred_at', { ascending: false }).limit(1)),
	);
	const out = new Map<string, { kind: string; occurred_at: string }>();
	rows.forEach((res, i) => {
		const a = ((res.data ?? []) as { kind: string; occurred_at: string }[])[0];
		if (a) out.set(users[i], { kind: a.kind, occurred_at: a.occurred_at });
	});
	return out;
}
