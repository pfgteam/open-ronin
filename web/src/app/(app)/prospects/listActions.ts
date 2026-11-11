'use server';

// Board "Load more" (spec 2026-10-15-prospects-lists-design.md §4.4): the
// next 50 cards of one column, same filters as the page. Reads only; RLS on
// rev_deals is the guard.

import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadStageColumn, sanitizeDealQuery, type DealQuery } from '@/lib/revenue/lists';
import type { DealCard } from '@/lib/revenue/shared';

export async function loadMoreStage(input: { query: DealQuery; stageId: string; offset: number }): Promise<DealCard[]> {
	if (!(await getAuthProfile())) return [];
	const supabase = await createClient();
	// The query comes from the browser: rebuild it from validated parts (RLS still applies either way).
	const query = sanitizeDealQuery(input.query as unknown as Record<string, unknown>);
	const stageId = sanitizeDealQuery({ stageId: input.stageId }).stageId;
	if (!stageId) return [];
	const offset = Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset)) : 0;
	const { deals, error } = await loadStageColumn(supabase, query, stageId, offset);
	if (error) throw new Error(error);
	return deals;
}
