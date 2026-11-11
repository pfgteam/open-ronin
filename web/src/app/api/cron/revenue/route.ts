// GET /api/cron/revenue. Vercel Cron, every 10 minutes (web/vercel.json).
// Enriches up to 10 pending brands per tick (website probe + AI summary when
// a text provider is configured; vendor stubs when their keys land), then
// releases prospects whose no-show delay has passed (delay_until in the
// past -> null + rescore). CRON_SECRET gates the route; service role inside.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { enrichPending } from '@/lib/revenue/enrichment';
import { pushEligible } from '@/lib/revenue/ghlSync';
import { advanceCalls } from '@/lib/revenue/ai';
import { runBackfillChunk } from '@/lib/revenue/ghlBackfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/revenue', async () => {
		const db = createServiceRoleClient();
		const enriched = await enrichPending(db, 10);
		const { data: released } = await db.from('rev_deals').update({ delay_until: null }).lt('delay_until', new Date().toISOString()).select('id');
		for (const d of (released ?? []) as { id: string }[]) await db.rpc('rev_rescore', { p_deal: d.id });
		// 0123: push eligible deals to GHL (no-op while push_prospects is off)
		const pushed = await pushEligible(db, 25);
		// 0155: GHL backfill, ~20s per tick, resumable (no-op when no run is queued)
		const backfill = await runBackfillChunk(db, { budgetMs: 20_000 });
		// 0124: SLA breach bells (one per deal per stage entry)
		const { data: slaBells } = await db.rpc('rev_sla_sweep');
		// 0125: zoom pulls, transcript analyses, pre-call briefs
		const calls = await advanceCalls(db);
		return NextResponse.json({
			enriched: enriched.length,
			done: enriched.filter((e) => e.status === 'done').length,
			skipped: enriched.filter((e) => e.status === 'skipped').length,
			failed: enriched.filter((e) => e.status === 'failed').map((e) => ({ brand_id: e.brand_id, error: e.error })),
			delays_released: (released ?? []).length,
			ghl_pushed: pushed.filter((p) => p.status === 'pushed').length,
			ghl_failed: pushed.filter((p) => p.status === 'failed').map((p) => ({ deal_id: p.deal_id, error: p.error })),
			backfill,
			sla_bells: slaBells ?? 0,
			calls,
		});
	});
}
