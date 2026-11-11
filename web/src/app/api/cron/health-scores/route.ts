// GET /api/cron/health-scores — Vercel Cron, daily (see web/vercel.json).
//
// Thin by design: the entire calculation lives in SQL
// (compute_health_scores(), migration 0042) per MIGRATION_READINESS rule 6 —
// the engine ports with a pg_dump; this route is just the scheduler pg_cron
// would have been (rule 5: jobs run outside the database).
//
// Idempotent: the function upserts on (airtable_contract_id, period_month)
// and escalation notifications dedupe on (user_id, dedupe_key), so the daily
// run refreshes the current month in place.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
// compute_health_scores() walks every contract x month, so this is not a
// 10-second job. Without an explicit ceiling it inherited the platform
// default and a truncated run was invisible: the upserts are idempotent, so
// half a month simply refreshed and nothing errored.
export const maxDuration = 300;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/health-scores', async () => {
		const supabase = createServiceRoleClient();
		const { data, error } = await supabase.rpc('compute_health_scores');
		if (error) {
			console.error('[cron/health-scores] compute failed:', error.message);
			return NextResponse.json({ error: 'compute_health_scores failed.' }, { status: 500 });
		}
		return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>) });
	});
}
