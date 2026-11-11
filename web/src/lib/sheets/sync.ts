// Sync engine for sheet_sources -> sheet_snapshots (0001).
//
// One sheet_snapshots row per (source, tab, row index), row_data holding two
// generations of the row so the Snapshots tab can highlight what changed
// without a second table:
//
//   { cells: Cell[], prev: Cell[] | null, changed_at: iso | null }
//
// cells is the row as of the last sync. prev is the row as it was before the
// last detected change (null for a row that has never changed since it was
// first seen), changed_at is when that change was detected. A row whose
// cells are text identical to the stored ones is not written at all, so a
// 30 minute sync of a static 2,000 row sheet costs one select and zero
// upserts. A row that disappears from the sheet is kept for one more sync
// with cells [] (so its deletion shows as a change) and then removed.
//
// Writes go through the service role: sheet_snapshots has no insert policy
// for authenticated (read only for users, the sync writes). Callers gate.

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Cell } from '@/lib/metrics/sheetsClient';
import { getSpreadsheetMeta, getTabValues } from './client';

export interface SheetSourceRow {
	id: string;
	google_sheet_id: string;
	display_name: string;
	tabs: string[];
	sync_interval_minutes: number | null;
	last_synced_at: string | null;
	last_sync_status: 'ok' | 'partial' | 'error' | null;
	last_sync_error: string | null;
}

export interface SnapshotRowData {
	cells: Cell[];
	prev: Cell[] | null;
	changed_at: string | null;
}

export interface TabSyncResult {
	tab: string;
	rows: number;
	changed: number;
	error: string | null;
}

export interface SourceSyncResult {
	sourceId: string;
	status: 'ok' | 'partial' | 'error';
	error: string | null;
	tabs: TabSyncResult[];
}

const CHUNK = 500;
const PAGE = 1000;

function cellText(v: Cell): string {
	return v == null ? '' : typeof v === 'string' ? v : String(v);
}

function sameRow(a: Cell[], b: Cell[]): boolean {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) if (cellText(a[i]) !== cellText(b[i])) return false;
	return true;
}

/** Parse a stored row_data, tolerating rows written before this shape. */
export function readRowData(raw: unknown): SnapshotRowData {
	if (raw && typeof raw === 'object' && Array.isArray((raw as SnapshotRowData).cells)) {
		const r = raw as SnapshotRowData;
		return {
			cells: r.cells,
			prev: Array.isArray(r.prev) ? r.prev : null,
			changed_at: typeof r.changed_at === 'string' ? r.changed_at : null,
		};
	}
	if (Array.isArray(raw)) return { cells: raw as Cell[], prev: null, changed_at: null };
	return { cells: [], prev: null, changed_at: null };
}

type Service = ReturnType<typeof createServiceRoleClient>;

async function loadExisting(
	supabase: Service,
	sourceId: string,
	tab: string,
): Promise<Map<number, SnapshotRowData>> {
	const out = new Map<number, SnapshotRowData>();
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await supabase
			.from('sheet_snapshots')
			.select('row_index, row_data')
			.eq('source_id', sourceId)
			.eq('tab', tab)
			.order('row_index', { ascending: true })
			.range(from, from + PAGE - 1);
		if (error) throw new Error(`sheet_snapshots read failed: ${error.message}`);
		for (const r of data ?? []) out.set(r.row_index as number, readRowData(r.row_data));
		if (!data || data.length < PAGE) break;
	}
	return out;
}

async function syncTab(
	supabase: Service,
	sourceId: string,
	tab: string,
	grid: Cell[][],
	now: string,
): Promise<TabSyncResult> {
	const existing = await loadExisting(supabase, sourceId, tab);
	const upserts: { source_id: string; tab: string; row_index: number; row_data: SnapshotRowData; synced_at: string }[] = [];
	const deletes: number[] = [];
	let changed = 0;

	for (let i = 0; i < grid.length; i++) {
		const cells = grid[i] ?? [];
		const old = existing.get(i);
		if (old && sameRow(old.cells, cells)) continue;
		changed++;
		upserts.push({
			source_id: sourceId,
			tab,
			row_index: i,
			row_data: { cells, prev: old ? old.cells : null, changed_at: now },
			synced_at: now,
		});
	}

	// Rows past the end of the sheet: one sync as an empty row, then gone.
	for (const [index, old] of existing) {
		if (index < grid.length) continue;
		if (old.cells.length === 0) {
			deletes.push(index);
		} else {
			changed++;
			upserts.push({
				source_id: sourceId,
				tab,
				row_index: index,
				row_data: { cells: [], prev: old.cells, changed_at: now },
				synced_at: now,
			});
		}
	}

	for (let i = 0; i < upserts.length; i += CHUNK) {
		const { error } = await supabase
			.from('sheet_snapshots')
			.upsert(upserts.slice(i, i + CHUNK), { onConflict: 'source_id,tab,row_index' });
		if (error) throw new Error(`sheet_snapshots write failed: ${error.message}`);
	}
	for (let i = 0; i < deletes.length; i += CHUNK) {
		const { error } = await supabase
			.from('sheet_snapshots')
			.delete()
			.eq('source_id', sourceId)
			.eq('tab', tab)
			.in('row_index', deletes.slice(i, i + CHUNK));
		if (error) throw new Error(`sheet_snapshots cleanup failed: ${error.message}`);
	}

	return { tab, rows: grid.length, changed, error: null };
}

/**
 * Which tabs to sync. Empty means every tab. A configured list where NOTHING
 * matches is treated the same way and written back to the row: the 0001 seed
 * listed "Sheet1" for all four sources and none of them has a tab by that
 * name, and a source that can never sync is worse than one that syncs
 * everything. A list where some tabs match syncs those and reports the
 * missing ones as a partial (the rename lesson from sheetsClient).
 */
export function resolveTabs(configured: string[], live: string[]): { tabs: string[]; healed: boolean } {
	if (configured.length === 0) return { tabs: live, healed: false };
	const present = new Set(live);
	const matches = configured.filter((t) => present.has(t));
	if (matches.length === 0) return { tabs: live, healed: true };
	return { tabs: configured, healed: false };
}

/**
 * Sync one source: every tab it lists (or every tab in the spreadsheet when
 * the list is empty), then record the outcome on the sheet_sources row.
 * Never throws; the outcome is the return value and the row.
 */
export async function syncSource(source: SheetSourceRow, now = new Date()): Promise<SourceSyncResult> {
	const supabase = createServiceRoleClient();
	const iso = now.toISOString();
	const results: TabSyncResult[] = [];
	let fatal: string | null = null;
	let healedTabs: string[] | null = null;

	try {
		const meta = await getSpreadsheetMeta(source.google_sheet_id);
		const liveTabs = meta.tabs.map((t) => t.title);
		const { tabs, healed } = resolveTabs(source.tabs ?? [], liveTabs);
		if (healed) healedTabs = liveTabs;
		const grids = await getTabValues(source.google_sheet_id, tabs, meta);
		for (let i = 0; i < tabs.length; i++) {
			const grid = grids[i];
			if (grid instanceof Error) {
				results.push({ tab: tabs[i], rows: 0, changed: 0, error: grid.message });
				continue;
			}
			try {
				results.push(await syncTab(supabase, source.id, tabs[i], grid, iso));
			} catch (e) {
				results.push({ tab: tabs[i], rows: 0, changed: 0, error: e instanceof Error ? e.message : String(e) });
			}
		}
	} catch (e) {
		fatal = e instanceof Error ? e.message : String(e);
	}

	const failed = results.filter((r) => r.error);
	const status: SourceSyncResult['status'] =
		fatal || (results.length > 0 && failed.length === results.length)
			? 'error'
			: failed.length > 0
				? 'partial'
				: 'ok';
	const error =
		fatal ??
		(failed.length > 0 ? failed.map((r) => `${r.tab}: ${r.error}`).join('; ').slice(0, 1000) : null);

	const { error: updateError } = await supabase
		.from('sheet_sources')
		.update({
			last_synced_at: iso,
			last_sync_status: status,
			last_sync_error: error,
			...(healedTabs ? { tabs: healedTabs } : {}),
		})
		.eq('id', source.id);
	if (updateError) console.error('[sheets/sync] status write failed:', updateError.message);

	return { sourceId: source.id, status, error, tabs: results };
}

/** A source is due when it has never synced or its interval has elapsed. */
export function isDue(source: SheetSourceRow, now: Date): boolean {
	if (!source.last_synced_at) return true;
	const minutes = source.sync_interval_minutes ?? 30;
	return now.getTime() - new Date(source.last_synced_at).getTime() >= minutes * 60_000;
}

/** Every source, or only the due ones; sequential so one bad sheet cannot fan out. */
export async function syncSources(opts: { onlyDue: boolean; now?: Date }): Promise<SourceSyncResult[]> {
	const now = opts.now ?? new Date();
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase
		.from('sheet_sources')
		.select('id, google_sheet_id, display_name, tabs, sync_interval_minutes, last_synced_at, last_sync_status, last_sync_error')
		.order('display_name');
	if (error) throw new Error(`sheet_sources read failed: ${error.message}`);
	const sources = (data ?? []) as SheetSourceRow[];
	const out: SourceSyncResult[] = [];
	for (const s of sources) {
		if (opts.onlyDue && !isDue(s, now)) continue;
		out.push(await syncSource(s, now));
	}
	return out;
}
