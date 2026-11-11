// Shared gate for every /api/cron/* route.
//
// A cron route is a public URL like any other: without this, anyone who
// discovers /api/cron/checkin-reminders can fire the job at will (67 pings at
// 3am, as many times as they like).
//
// Vercel sends `Authorization: Bearer *** on every scheduled
// invocation, automatically, whenever that env var exists on the project.
//
// FAILS CLOSED: if CRON_SECRET is unset, every request is refused rather than
// every request being allowed. A missing secret must never mean "open".
//
// LOGGING: withCronRun() wraps a route handler and writes one public.cron_runs
// row per tick (migration 0067): inserted as 'running' before the handler,
// closed as 'ok' or 'error' after. The Dev Dashboard reads the cron_health
// view. Logging is best effort: a failed log write is reported to the console
// and never turns a working tick into a 500, and until 0067 is applied the
// insert simply fails quietly.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	// timingSafeEqual throws on length mismatch, which is itself a length
	// oracle — compare lengths first and keep the comparison constant-time
	// only for equal-length inputs.
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/**
 * Returns a 401 response when the caller is not Vercel Cron (or someone
 * holding the secret), or null when the request may proceed.
 */
export function denyUnlessCron(request: Request): NextResponse | null {
	const secret = process.env.CRON_SECRET;
	if (!secret) {
		console.error('[cron] CRON_SECRET is not set — refusing the request');
		return NextResponse.json({ error: 'Cron is not configured.' }, { status: 401 });
	}
	const header = request.headers.get('authorization') ?? '';
	if (!safeEqual(header, `Bearer ${secret}`)) {
		return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
	}
	return null;
}

/** Route path as it appears in web/vercel.json, e.g. "/api/cron/scrapers". */
export type CronRoute = `/api/cron/${string}`;

const SUMMARY_LIMIT = 4000;

// The response body, trimmed, so the dashboard can show what a tick did
// without cron_runs turning into a second copy of every job log.
function trimSummary(value: unknown): unknown {
	try {
		const text = JSON.stringify(value ?? null);
		if (text.length <= SUMMARY_LIMIT) return value ?? null;
		return { truncated: true, head: text.slice(0, SUMMARY_LIMIT) };
	} catch {
		return null;
	}
}

async function readBody(response: Response): Promise<unknown> {
	try {
		const text = await response.clone().text();
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch {
			return text.slice(0, SUMMARY_LIMIT);
		}
	} catch {
		return null;
	}
}

/**
 * Gate plus log for a cron route. Usage:
 *
 *   export async function GET(request: Request) {
 *     return withCronRun(request, '/api/cron/scrapers', async () => {
 *       ...
 *       return NextResponse.json(log);
 *     });
 *   }
 *
 * A 401 from the gate is returned before any row is written, so probing the
 * URL without the secret leaves no trace in cron_runs. A handler that throws
 * is logged as 'error' and rethrown; a handler that returns a non 2xx status
 * is logged as 'error' with the response body as the error text.
 */
export async function withCronRun(
	request: Request,
	route: CronRoute,
	handler: () => Promise<Response>,
): Promise<Response> {
	const denied = denyUnlessCron(request);
	if (denied) return denied;

	const supabase = createServiceRoleClient();
	const startedAt = Date.now();
	let runId: string | null = null;
	// started_at is stamped by Postgres (`default now()`), but finished_at is
	// computed here on the edge. When the two clocks disagree by even a few ms
	// the row can close with finished_at < started_at, which violates the
	// cron_runs_finished_after_start CHECK (0067): the UPDATE is rejected and
	// the row stays 'running' forever, so a job that succeeded reads as hung
	// on the Dev Dashboard. Two rows were stuck this way on 2026-09-15.
	// Reading back the value the database actually wrote lets close() clamp
	// against it instead of trusting the local clock.
	let dbStartedAtMs: number | null = null;

	try {
		const { data, error } = await supabase
			.from('cron_runs')
			.insert({ route, status: 'running' })
			.select('id, started_at')
			.single();
		if (error) console.error(`[cron] could not open cron_runs row for ${route}:`, error.message);
		else {
			const row = data as { id: string; started_at: string } | null;
			runId = row?.id ?? null;
			const parsed = row?.started_at ? Date.parse(row.started_at) : NaN;
			dbStartedAtMs = Number.isNaN(parsed) ? null : parsed;
		}
	} catch (e) {
		console.error(`[cron] could not open cron_runs row for ${route}:`, e);
	}

	const close = async (patch: {
		status: 'ok' | 'error';
		http_status: number | null;
		summary: unknown;
		error: string | null;
	}) => {
		if (!runId) return;
		try {
			// Never let finished_at precede the started_at Postgres recorded —
			// see dbStartedAtMs above. Clamping keeps the CHECK satisfied even
			// when the edge clock lags the database.
			const nowMs = Date.now();
			const finishedMs =
				dbStartedAtMs !== null && nowMs < dbStartedAtMs ? dbStartedAtMs : nowMs;
			const { error } = await supabase
				.from('cron_runs')
				.update({
					...patch,
					finished_at: new Date(finishedMs).toISOString(),
					duration_ms: Math.max(0, nowMs - startedAt),
				})
				.eq('id', runId);
			if (error) console.error(`[cron] could not close cron_runs row for ${route}:`, error.message);
		} catch (e) {
			console.error(`[cron] could not close cron_runs row for ${route}:`, e);
		}
	};

	let response: Response;
	try {
		response = await handler();
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await close({ status: 'error', http_status: null, summary: null, error: message.slice(0, 2000) });
		throw e;
	}

	const body = await readBody(response);
	const ok = response.status >= 200 && response.status < 300;
	await close({
		status: ok ? 'ok' : 'error',
		http_status: response.status,
		summary: ok ? trimSummary(body) : null,
		error: ok ? null : JSON.stringify(body ?? null).slice(0, 2000),
	});
	return response;
}
