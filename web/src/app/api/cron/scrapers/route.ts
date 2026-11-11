// GET /api/cron/scrapers — Vercel Cron, every 5 minutes (web/vercel.json).
//
// Thin by design: the state machine lives in lib/scrapers/advance.ts so the
// "Run now" button on /media/lead-scraper drives exactly the same code. Vercel
// cron only fires on production deployments, so without that second caller the
// queue never moves on localhost.
//
// Service role is used deliberately — the job writes staging rows on nobody's
// behalf, and 0041 has no INSERT policy for authenticated users precisely so a
// person cannot plant rows into a review queue. The route is gated by
// CRON_SECRET, which fails closed.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { advanceScrapeJobs } from '@/lib/scrapers/advance';

export const dynamic = 'force-dynamic';
// Bounded work per tick, so this stays well inside any plan's ceiling.
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/scrapers', async () => {
		if (!process.env.APIFY_TOKEN) {
			console.error('[cron/scrapers] APIFY_TOKEN is not set');
			return NextResponse.json({ error: 'Scrapers are not configured.' }, { status: 500 });
		}

		const log = await advanceScrapeJobs(createServiceRoleClient());
		return NextResponse.json(log);
	});
}
