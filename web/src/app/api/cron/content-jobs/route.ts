// GET /api/cron/content-jobs. Vercel Cron, every minute (web/vercel.json).
//
// Thin by design: the state machine lives in lib/providers/advance.ts so
// the Run now and Test buttons on /admin/providers drive exactly the same
// code, and so a queued job moves on localhost where Vercel cron never
// fires. Up to 20 jobs per state per tick, one vendor call each.
//
// Service role on purpose: the job runs on nobody's behalf and 0065 has no
// update policy for sessions. CRON_SECRET gates the route and fails closed.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { advanceContentJobs } from '@/lib/providers/advance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/content-jobs', async () => {
		const log = await advanceContentJobs(createServiceRoleClient());
		return NextResponse.json(log);
	});
}
