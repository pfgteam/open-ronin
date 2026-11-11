// GHL backfill runner (0155). Server-only. One ghl_backfill_runs row per
// (connection, GHL pipeline, GHL status); each call advances the next run
// page by page (100 opportunities, one rev_ghl_import_rows call per page)
// until the time budget is spent, and stores the cursor so the Admin button
// and the revenue cron resume where the last call stopped. Idempotent: an
// opportunity already imported comes back 'exists'.
//
// Does NOT import ghlSync (ghlSync imports this file for the webhook path).

import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlFetch } from '@/lib/ghl/client';
import { BACKFILL_STATUSES, backfillSince, countResults, nextRun, pageFinished, pageRows, type BackfillRunRow, type GhlOpportunity, type ImportResult } from './ghlImport';

type Db = SupabaseClient;

const RUN_COLUMNS = 'id, connection_id, ghl_pipeline_id, ghl_status, since, state, cursor_after, cursor_after_id, fetched, imported, existed, skipped, failed, last_error, created_at, finished_at';
const PAGE = 100;

export async function fetchUserEmails(connectionId: string, locationId: string): Promise<Record<string, string>> {
	try {
		const r = await ghlFetch<{ users?: { id: string; email?: string | null }[] }>(connectionId, `/users/?locationId=${encodeURIComponent(locationId)}`);
		const out: Record<string, string> = {};
		for (const u of r.users ?? []) if (u.email) out[u.id] = u.email.toLowerCase();
		return out;
	} catch {
		return {};
	}
}

export async function startBackfill(db: Db, connection: { id: string; ghl_location_id: string | null } | null, startedBy: string | null): Promise<{ ok: true; runs: number } | { ok: false; error: string }> {
	if (!connection?.ghl_location_id) return { ok: false, error: 'Connect the Open Ronin location first (Sub-account connections, org Open Ronin).' };
	const { data: map, error } = await db.from('ghl_stage_map').select('ghl_pipeline_id');
	if (error) return { ok: false, error: error.message };
	const pipelines = [...new Set(((map ?? []) as { ghl_pipeline_id: string }[]).map((r) => r.ghl_pipeline_id))];
	const since = backfillSince();
	const rows = pipelines.flatMap((pid) => BACKFILL_STATUSES.map((st) => ({ connection_id: connection.id, ghl_pipeline_id: pid, ghl_status: st, since: st === 'open' ? null : since, started_by: startedBy })));
	const { error: e2 } = await db.from('ghl_backfill_runs').upsert(rows, { onConflict: 'connection_id,ghl_pipeline_id,ghl_status', ignoreDuplicates: true });
	if (e2) return { ok: false, error: e2.message };
	// a failed run resumes from its cursor
	await db.from('ghl_backfill_runs').update({ state: 'queued', last_error: null }).eq('state', 'failed');
	return { ok: true, runs: rows.length };
}

export interface BackfillChunk {
	run_id: string;
	ghl_pipeline_id: string;
	ghl_status: string;
	fetched: number;
	imported: number;
	existed: number;
	skipped: number;
	failed: number;
	done: boolean;
	error: string | null;
}

interface SearchPage {
	opportunities?: GhlOpportunity[];
	meta?: { startAfter?: number | null; startAfterId?: string | null };
}

export async function runBackfillChunk(db: Db, opts: { budgetMs: number }): Promise<BackfillChunk | null> {
	const t0 = Date.now();
	const { data: runs } = await db.from('ghl_backfill_runs').select(RUN_COLUMNS).in('state', ['queued', 'running']);
	const run = nextRun((runs ?? []) as BackfillRunRow[]);
	if (!run) return null;
	// Claim the run so the cron and the Admin button never work the same cursor
	// at once: a 'running' run is free again only after 2 minutes of silence.
	const stale = new Date(Date.now() - 120_000).toISOString();
	const { data: claimed } = await db
		.from('ghl_backfill_runs')
		.update({ state: 'running' })
		.eq('id', run.id)
		.or(`state.eq.queued,updated_at.lt.${stale}`)
		.select('id');
	if (!claimed || claimed.length === 0) return { run_id: run.id, ghl_pipeline_id: run.ghl_pipeline_id, ghl_status: run.ghl_status, fetched: 0, imported: 0, existed: 0, skipped: 0, failed: 0, done: false, error: 'busy: another worker holds this run' };
	const out: BackfillChunk = { run_id: run.id, ghl_pipeline_id: run.ghl_pipeline_id, ghl_status: run.ghl_status, fetched: 0, imported: 0, existed: 0, skipped: 0, failed: 0, done: false, error: null };

	const { data: conn } = await db.from('ghl_connections').select('id, ghl_location_id').eq('id', run.connection_id).maybeSingle();
	const c = conn as { id: string; ghl_location_id: string | null } | null;
	if (!c?.ghl_location_id) {
		out.error = 'connection has no location';
		await db.from('ghl_backfill_runs').update({ state: 'failed', last_error: out.error }).eq('id', run.id);
		return out;
	}
	const userEmails = await fetchUserEmails(c.id, c.ghl_location_id);
	let after = run.cursor_after;
	let afterId = run.cursor_after_id;

	while (!out.done && Date.now() - t0 < opts.budgetMs) {
		const qs = new URLSearchParams({ location_id: c.ghl_location_id, pipeline_id: run.ghl_pipeline_id, status: run.ghl_status, limit: String(PAGE), order: 'added_desc' });
		if (after != null && afterId) {
			qs.set('startAfter', String(after));
			qs.set('startAfterId', afterId);
		}
		let page: SearchPage;
		try {
			page = await ghlFetch<SearchPage>(c.id, `/opportunities/search?${qs.toString()}`);
		} catch (e) {
			out.error = (e as Error).message.slice(0, 1000);
			break;
		}
		const opps = page.opportunities ?? [];
		out.fetched += opps.length;
		const { rows, reachedSince } = pageRows(opps, { locationId: c.ghl_location_id, userEmails, since: run.since });
		if (rows.length) {
			const { data, error } = await db.rpc('rev_ghl_import_rows', { p_rows: rows });
			if (error) {
				out.error = error.message;
				break;
			}
			const t = countResults((data ?? []) as ImportResult[]);
			out.imported += t.imported;
			out.existed += t.existed;
			out.skipped += t.skipped;
			out.failed += t.failed;
		}
		after = page.meta?.startAfter ?? null;
		afterId = page.meta?.startAfterId ?? null;
		out.done = pageFinished({ count: opps.length, reachedSince, after, afterId });
	}

	await db
		.from('ghl_backfill_runs')
		.update({
			// a paused run goes back to 'queued' so the next caller can claim it
			state: out.error ? 'failed' : out.done ? 'done' : 'queued',
			cursor_after: after,
			cursor_after_id: afterId,
			fetched: run.fetched + out.fetched,
			imported: run.imported + out.imported,
			existed: run.existed + out.existed,
			skipped: run.skipped + out.skipped,
			failed: run.failed + out.failed,
			last_error: out.error,
			finished_at: out.done ? new Date().toISOString() : null,
		})
		.eq('id', run.id);
	return out;
}
