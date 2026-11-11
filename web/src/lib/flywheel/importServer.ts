// Flywheel F8 server side: read a tracker (Google Sheet tab through the
// app's service account, or a pasted CSV), plan it with lib/flywheel/import
// and write the plan through the caller's Supabase client (RLS engaged).
//
// Writes are idempotent on import_ref: pages and citations upsert, the
// review list refreshes its reason per source row. Nothing is deleted.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSpreadsheetMeta, getTabValues } from '@/lib/sheets/client';
import { getServiceAccountEmail, type Cell } from '@/lib/metrics/sheetsClient';
import { parseCsv } from '@/lib/imports/parse';
import { gridToRows, planImport, type ApplyCounts, type ImportBatchRow, type ImportPlan, type ImportReviewRow, type PlanContext } from './import';

export type { ApplyCounts, ImportBatchRow, ImportReviewRow };

type Db = SupabaseClient;

export interface TrackerSource {
	kind: 'sheets' | 'csv';
	/** sheets: Google spreadsheet id. csv: `csv:<batch id>` once the batch row exists, see importRefPrefix. */
	spreadsheetId: string;
	tab: string;
	fileName?: string | null;
	headers: string[];
	rows: (string | number | null)[][];
}

export function sheetsConfigured(): boolean {
	return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function serviceAccountEmail(): string | null {
	return getServiceAccountEmail();
}

/** Tabs on a spreadsheet the service account can see. Throws a readable error when it cannot. */
export async function listTrackerTabs(spreadsheetId: string): Promise<{ title: string; tabs: string[] }> {
	if (!sheetsConfigured()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set in this environment, so Google Sheets cannot be read. Paste the tab as CSV instead.');
	const meta = await getSpreadsheetMeta(spreadsheetId);
	return { title: meta.title, tabs: meta.tabs.map((t) => t.title) };
}

const toCell = (v: Cell): string | number | null => (v == null ? null : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v);

/** Read one tab: first non-empty row is the header, the rest are data rows (sheet row = index + 2). */
export async function readSheetTab(spreadsheetId: string, tab: string): Promise<TrackerSource> {
	if (!sheetsConfigured()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set in this environment, so Google Sheets cannot be read. Paste the tab as CSV instead.');
	const [grid] = await getTabValues(spreadsheetId, [tab]);
	if (grid instanceof Error) throw grid;
	return gridToSource({ kind: 'sheets', spreadsheetId, tab }, grid.map((r) => r.map(toCell)));
}

export function csvToSource(text: string, fileName: string | null, batchId: string): TrackerSource {
	const parsed = parseCsv(text);
	return gridToSource({ kind: 'csv', spreadsheetId: `csv:${batchId}`, tab: fileName?.replace(/\.csv$/i, '') || 'csv', fileName }, [parsed.headers, ...parsed.rows]);
}

function gridToSource(base: Omit<TrackerSource, 'headers' | 'rows'>, grid: (string | number | null)[][]): TrackerSource {
	return { ...base, ...gridToRows(grid) };
}

export async function loadPlanContext(db: Db, programId: string): Promise<PlanContext> {
	const [{ data: program }, { data: channels }, { data: clusters }, { data: pages }, { data: citations }] = await Promise.all([
		db.from('fw_programs').select('id, primary_url').eq('id', programId).maybeSingle(),
		db.from('fw_channels').select('key, label, poster_default').eq('is_active', true).order('sort'),
		db.from('fw_clusters').select('id, number, anchor_keyword, status').eq('program_id', programId).order('number'),
		db.from('fw_pages').select('id, cluster_id, number, keyword, live_url, import_ref').eq('program_id', programId),
		db.from('fw_citations').select('id, url, import_ref').eq('program_id', programId).not('url', 'is', null),
	]);
	if (!program) throw new Error('Program not found.');
	const byUrl = new Map<string, { id: string; import_ref: string | null }>();
	for (const c of (citations ?? []) as { id: string; url: string; import_ref: string | null }[]) byUrl.set(c.url.toLowerCase(), { id: c.id, import_ref: c.import_ref });
	return {
		programId,
		primaryUrl: (program as { primary_url: string | null }).primary_url,
		channels: (channels ?? []) as PlanContext['channels'],
		clusters: (clusters ?? []) as PlanContext['clusters'],
		pages: (pages ?? []) as PlanContext['pages'],
		citationsByUrl: byUrl,
	};
}

export function planTracker(src: TrackerSource, ctx: PlanContext): ImportPlan {
	return planImport({ spreadsheetId: src.spreadsheetId, tab: src.tab, headers: src.headers, rows: src.rows, ctx });
}

/**
 * Write a plan. Pages first (so same-run citations can resolve their page),
 * then citations, then the review list. Each upsert is keyed on import_ref.
 */
export async function applyPlan(db: Db, programId: string, batchId: string, plan: ImportPlan, actorId: string): Promise<ApplyCounts> {
	const counts: ApplyCounts = { rows: plan.pages.length + plan.citations.length + plan.review.length + plan.blank, pages_inserted: 0, pages_updated: 0, citations_inserted: 0, citations_updated: 0, review: 0, blank: plan.blank };
	const pageIdByRef = new Map<string, string>();

	for (const p of plan.pages) {
		const row = {
			program_id: programId,
			cluster_id: p.cluster_id,
			number: p.number,
			kind: 'question',
			keyword: p.keyword,
			title: p.title,
			status: p.status,
			live_url: p.live_url,
			live_at: p.live_at,
			notes_md: p.notes_md,
			source: 'import',
			import_ref: p.import_ref,
		};
		if (p.existing_id) {
			const { error } = await db.from('fw_pages').update({ keyword: row.keyword, title: row.title, status: row.status, live_url: row.live_url, live_at: row.live_at, notes_md: row.notes_md }).eq('id', p.existing_id);
			if (error) throw new Error(`page row ${p.row_number}: ${error.message}`);
			pageIdByRef.set(p.import_ref, p.existing_id);
			counts.pages_updated += 1;
		} else {
			const { data, error } = await db.from('fw_pages').insert({ ...row, created_by: actorId }).select('id').single();
			if (error) throw new Error(`page row ${p.row_number}: ${error.message}`);
			pageIdByRef.set(p.import_ref, (data as { id: string }).id);
			counts.pages_inserted += 1;
		}
	}

	const existingRefs = new Set<string>();
	if (plan.citations.length) {
		const { data } = await db.from('fw_citations').select('import_ref').eq('program_id', programId).in('import_ref', plan.citations.map((c) => c.import_ref));
		for (const r of (data ?? []) as { import_ref: string }[]) existingRefs.add(r.import_ref);
	}
	for (const c of plan.citations) {
		const page_id = c.page_id ?? (c.page_import_ref ? pageIdByRef.get(c.page_import_ref) ?? null : null);
		const row = {
			program_id: programId,
			cluster_id: c.cluster_id,
			page_id,
			channel_key: c.channel_key,
			status: c.status,
			title: c.title,
			url: c.url,
			posted_on: c.posted_on,
			keyword: c.keyword,
			poster_handle: c.poster_handle,
			poster_kind: c.poster_kind,
			notes_md: c.notes_md,
			source: 'import',
			import_ref: c.import_ref,
		};
		if (existingRefs.has(c.import_ref)) {
			const { error } = await db.from('fw_citations').update({ cluster_id: row.cluster_id, page_id: row.page_id, channel_key: row.channel_key, status: row.status, title: row.title, url: row.url, posted_on: row.posted_on, keyword: row.keyword, poster_handle: row.poster_handle, poster_kind: row.poster_kind, notes_md: row.notes_md }).eq('import_ref', c.import_ref);
			if (error) throw new Error(`citation row ${c.row_number}: ${error.message}`);
			counts.citations_updated += 1;
		} else {
			const { error } = await db.from('fw_citations').insert({ ...row, created_by: actorId });
			if (error) {
				if (error.message.includes('fw_citations_url_uq')) {
					plan.review.push({ import_ref: c.import_ref, row_number: c.row_number, raw: { url: c.url ?? '' }, reason: 'URL is already on the ledger for this program' });
					continue;
				}
				throw new Error(`citation row ${c.row_number}: ${error.message}`);
			}
			counts.citations_inserted += 1;
		}
	}

	for (const r of plan.review) {
		// status is left out on purpose: a new row defaults to 'unmatched', an
		// existing one keeps what the team set (an Ignored row stays ignored
		// when the same tracker is imported again; only the reason refreshes).
		const { error } = await db.from('fw_import_rows').upsert({ program_id: programId, batch_id: batchId, import_ref: r.import_ref, row_number: r.row_number, raw: r.raw, reason: r.reason }, { onConflict: 'import_ref' });
		if (error) throw new Error(`review row ${r.row_number}: ${error.message}`);
		counts.review += 1;
	}
	// A row that was on the review list and is now placed: mark it resolved.
	const placed = [...plan.pages.map((p) => ({ ref: p.import_ref, kind: 'page' as const, id: pageIdByRef.get(p.import_ref) ?? null })), ...plan.citations.map((c) => ({ ref: c.import_ref, kind: 'citation' as const, id: null }))];
	if (placed.length) {
		const { data: open } = await db.from('fw_import_rows').select('import_ref').eq('program_id', programId).eq('status', 'unmatched').in('import_ref', placed.map((p) => p.ref));
		for (const o of (open ?? []) as { import_ref: string }[]) {
			const hit = placed.find((p) => p.ref === o.import_ref)!;
			await db.from('fw_import_rows').update({ status: 'resolved', resolved_kind: hit.kind, resolved_id: hit.id, resolved_by: actorId, resolved_at: new Date().toISOString() }).eq('import_ref', o.import_ref);
		}
	}
	return counts;
}

export async function loadImportState(db: Db, programId: string): Promise<{ batches: ImportBatchRow[]; review: ImportReviewRow[]; imported: { pages: number; citations: number } }> {
	const [{ data: batches }, { data: review }, { count: pages }, { count: citations }] = await Promise.all([
		db.from('fw_import_batches').select('*').eq('program_id', programId).order('created_at', { ascending: false }).limit(20),
		db.from('fw_import_rows').select('*').eq('program_id', programId).order('status').order('row_number').limit(500),
		db.from('fw_pages').select('id', { count: 'exact', head: true }).eq('program_id', programId).eq('source', 'import'),
		db.from('fw_citations').select('id', { count: 'exact', head: true }).eq('program_id', programId).eq('source', 'import'),
	]);
	return { batches: (batches ?? []) as ImportBatchRow[], review: (review ?? []) as ImportReviewRow[], imported: { pages: pages ?? 0, citations: citations ?? 0 } };
}
