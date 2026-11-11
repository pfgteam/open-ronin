// GET /api/cron/automations. Vercel Cron, every minute (web/vercel.json).
//
// Thin by design: the engine lives in lib/automations/engine.ts so "Run now"
// on the builder drives exactly the same code, and so a queued run moves on
// localhost where Vercel cron never fires. Bounded per tick (25 schedules,
// 100 events, 25 runs, 20 s of step time per run).
//
// Service role on purpose: runs execute on nobody's behalf and 0101 has no
// session update policy on automation_runs. CRON_SECRET gates the route.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { advanceAutomations } from '@/lib/automations/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/automations', async () => {
		const log = await advanceAutomations(createServiceRoleClient());
		return NextResponse.json(log);
	});
}
