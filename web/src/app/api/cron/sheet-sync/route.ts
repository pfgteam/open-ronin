// GET /api/cron/sheet-sync: Vercel Cron, every 10 minutes (see web/vercel.json).
//
// Walks sheet_sources and syncs every source whose sync_interval_minutes has
// elapsed (lib/sheets/sync.ts). The interval lives on the row, so a sheet
// that needs hourly and one that needs every ten minutes share this one
// schedule. ?all=1 ignores the interval (used by Sync all on the page
// through the server action, never by the schedule).
//
// Same gate as every cron route (CRON_SECRET, fails closed), via withCronRun,
// which also logs one cron_runs row per tick for the Dev Dashboard.

import { NextResponse } from 'next/server';
import { withCronRun } from '@/lib/cron/auth';
import { syncSources } from '@/lib/sheets/sync';

export const dynamic = 'force-dynamic';
// A source is one metadata call plus one batchGet plus the row diff; four
// sources finish in seconds, but a 20,000 row sheet or a slow Google day
// should not be cut off by the platform default.
export const maxDuration = 300;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/sheet-sync', () => run(request));
}

async function run(request: Request): Promise<Response> {
	const all = new URL(request.url).searchParams.get('all') === '1';
	try {
		const results = await syncSources({ onlyDue: !all });
		const summary = {
			synced: results.length,
			succeeded: results.filter((r) => r.status === 'ok').length,
			partial: results.filter((r) => r.status === 'partial').length,
			error: results.filter((r) => r.status === 'error').length,
			rows: results.reduce((n, r) => n + r.tabs.reduce((m, t) => m + t.rows, 0), 0),
			changed: results.reduce((n, r) => n + r.tabs.reduce((m, t) => m + t.changed, 0), 0),
		};
		console.log('[cron/sheet-sync]', JSON.stringify(summary));
		return NextResponse.json({ ok: true, ...summary, results });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error('[cron/sheet-sync] failed:', message);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
