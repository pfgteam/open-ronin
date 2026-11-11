// Cron health for the Dev Dashboard: the schedules in web/vercel.json joined
// to the cron_health view (migration 0067, fed by withCronRun in
// lib/cron/auth.ts). Reads with the service role because cron_runs is
// admin-read only and the page already sits behind the Dashboards module
// gate; nothing here is per viewer.

import vercelConfig from '../../../vercel.json';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CronRouteHealth, CronSnapshot } from './types';

interface CronEntry {
	path: string;
	schedule: string;
}

interface HealthRow {
	route: string;
	last_started_at: string | null;
	last_finished_at: string | null;
	last_status: 'running' | 'ok' | 'error' | null;
	last_http_status: number | null;
	last_duration_ms: number | null;
	last_error: string | null;
	last_ok_at: string | null;
}

export function cronEntries(): CronEntry[] {
	return ((vercelConfig as { crons?: CronEntry[] }).crons ?? []).slice();
}

/**
 * Minutes between ticks for the five field schedules Vercel accepts. Only the
 * shapes this repo uses need to be exact (every minute, every N minutes,
 * hourly at a minute, daily at a time); anything else reads as daily so a
 * weekly job is never falsely flagged mid week.
 */
export function periodMinutes(schedule: string): number {
	const [minute = '*', hour = '*'] = schedule.trim().split(/\s+/);
	if (minute === '*') return 1;
	const everyN = /^\*\/(\d+)$/.exec(minute);
	if (everyN) return Math.max(1, Number(everyN[1]));
	if (hour === '*') return 60;
	const everyNHours = /^\*\/(\d+)$/.exec(hour);
	if (everyNHours) return 60 * Math.max(1, Number(everyNHours[1]));
	return 1440;
}

/** A route is stale when it never ran or its last tick is older than two periods plus five minutes. */
export function isStale(schedule: string, lastStartedAt: string | null, now = Date.now()): boolean {
	if (!lastStartedAt) return true;
	const allowance = (2 * periodMinutes(schedule) + 5) * 60_000;
	return now - Date.parse(lastStartedAt) > allowance;
}

export function joinHealth(entries: CronEntry[], rows: HealthRow[], now = Date.now()): CronSnapshot {
	const byRoute = new Map(rows.map((r) => [r.route, r]));
	const routes: CronRouteHealth[] = entries.map((e) => {
		const r = byRoute.get(e.path);
		return {
			route: e.path,
			schedule: e.schedule,
			lastStartedAt: r?.last_started_at ?? null,
			lastFinishedAt: r?.last_finished_at ?? null,
			lastStatus: r?.last_status ?? null,
			lastHttpStatus: r?.last_http_status ?? null,
			lastDurationMs: r?.last_duration_ms ?? null,
			lastError: r?.last_error ?? null,
			lastOkAt: r?.last_ok_at ?? null,
			stale: isStale(e.schedule, r?.last_started_at ?? null, now),
		};
	});
	const unhealthy = routes.filter((r) => r.stale || r.lastStatus === 'error').length;
	return { routes, healthy: routes.length - unhealthy, unhealthy };
}

export async function fetchCronSnapshot(now = Date.now()): Promise<CronSnapshot> {
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.from('cron_health').select('*');
	if (error) {
		// Until 0067 is applied the view does not exist; the tile then shows
		// every route as never logged rather than the page failing.
		console.error('[dev-dashboard] cron_health read failed:', error.message);
		return joinHealth(cronEntries(), [], now);
	}
	return joinHealth(cronEntries(), (data ?? []) as HealthRow[], now);
}
