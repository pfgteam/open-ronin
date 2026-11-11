// GET /api/cron/the-work-metrics — Vercel Cron, daily (see web/vercel.json).
//
// Thin by design: the whole calculation is compute_the_work_metrics() in
// migration 0049, per MIGRATION_READINESS rule 6 (calculations in SQL, not
// hidden in the app) and following compute_health_scores() in 0042. This route
// is only the scheduler that pg_cron would have been — rule 5 keeps scheduled
// work outside the database.
//
// Idempotent: the function upserts on
// (subject_type, subject_key, metric_key, period, source), so the daily run
// refreshes the current month in place rather than accumulating.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
// compute_the_work_metrics() is called twice in one request (current period
// and the trailing one), and it scans the whole work tree. Without an
// explicit ceiling this inherited the platform default and a timeout left the
// period half-refreshed with no error anywhere.
export const maxDuration = 300;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/the-work-metrics', async () => {

		const supabase = createServiceRoleClient();
		// Current month (the function's default) AND the previous one. The daily
		// 15:15 UTC run means a month's last run happens hours before it actually
		// ends — anything completed after that would be frozen short forever.
		// Recomputing the closed month once a day is idempotent and closes that
		// gap; it also picks up items reopened-and-recompleted across the boundary.
		const { data: current, error } = await supabase.rpc('compute_the_work_metrics');
		if (error) {
			console.error('[cron/the-work-metrics] compute failed:', error.message);
			return NextResponse.json({ error: 'compute_the_work_metrics failed.' }, { status: 500 });
		}

		const prevPeriod = new Date();
		prevPeriod.setUTCDate(1);
		prevPeriod.setUTCMonth(prevPeriod.getUTCMonth() - 1);
		const { data: previous, error: prevError } = await supabase.rpc('compute_the_work_metrics', {
			p_period: prevPeriod.toISOString().slice(0, 10),
		});
		if (prevError) {
			// The current month landed; report the partial failure without a 500 so
			// Vercel does not mark the whole run failed and mask the good half.
			console.error('[cron/the-work-metrics] previous-month compute failed:', prevError.message);
		}

		const summary = { current: current ?? {}, previous: previous ?? null };
		console.log('[cron/the-work-metrics]', JSON.stringify(summary));
		return NextResponse.json({ ok: true, ...summary });
	});
}
