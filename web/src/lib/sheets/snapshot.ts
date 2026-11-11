// Shape sheet_snapshots rows into what the Snapshots tab and the CSV export
// need. Pure: no network, no env. The database read lives in the page and
// the export route (both with the user's session, sheet_snapshots_read_all).

import type { Cell } from '@/lib/metrics/sheetsClient';
import type { DataRecord, FieldSchema, TableSchema } from '@/lib/data';
import { columnLabel, gridWidth } from './client';
import { readRowData, type SnapshotRowData } from './sync';

export interface SnapshotRow {
	row_index: number;
	row_data: unknown;
	synced_at: string;
}

export interface SnapshotView {
	/** Current grid, row_index order, ragged rows kept as is. */
	grid: Cell[][];
	/** Grid as it was before the latest batch of changes (same shape rules). */
	previous: Cell[][];
	/** When the latest batch of changes was detected, or null when nothing has ever changed. */
	changedAt: string | null;
	/** "r<row>:<col letter>" for every cell that differs between previous and grid. */
	changedKeys: string[];
	syncedAt: string | null;
}

function cellText(v: Cell): string {
	return v == null ? '' : typeof v === 'string' ? v : String(v);
}

/**
 * The "previous snapshot" is the sheet as it stood before the most recent
 * sync that detected a change: every row carries its own prev generation and
 * changed_at, so the latest changed_at across the tab names that sync and
 * rows changed then are rolled back to prev; rows changed earlier keep their
 * current cells on both sides (they were already like that).
 */
export function buildSnapshotView(rows: SnapshotRow[]): SnapshotView {
	const parsed = rows
		.map((r) => ({ index: r.row_index, data: readRowData(r.row_data), syncedAt: r.synced_at }))
		.sort((a, b) => a.index - b.index);

	const changedAt = parsed.reduce<string | null>(
		(max, r) => (r.data.changed_at && (!max || r.data.changed_at > max) ? r.data.changed_at : max),
		null,
	);
	const syncedAt = parsed.reduce<string | null>((max, r) => (!max || r.syncedAt > max ? r.syncedAt : max), null);

	const top = parsed.length > 0 ? parsed[parsed.length - 1].index + 1 : 0;
	const grid: Cell[][] = Array.from({ length: top }, () => []);
	const previous: Cell[][] = Array.from({ length: top }, () => []);
	for (const r of parsed) {
		grid[r.index] = r.data.cells;
		previous[r.index] = r.data.changed_at === changedAt && r.data.prev ? r.data.prev : r.data.cells;
	}

	const changedKeys: string[] = [];
	const cols = Math.max(gridWidth(grid), gridWidth(previous));
	for (let r = 0; r < top; r++) {
		for (let c = 0; c < cols; c++) {
			if (cellText(grid[r]?.[c]) !== cellText(previous[r]?.[c])) changedKeys.push(`r${r}:${columnLabel(c)}`);
		}
	}

	return { grid, previous, changedAt, changedKeys, syncedAt };
}

/**
 * A TableSchema plus DataRecords for BaseExplorerTable. Field id is the
 * column letter (stable across renames); the name is the header row text
 * when `headerRow` is on and that cell is non empty, else the letter.
 * Record id is r<row_index> so the highlight keys line up.
 */
export function toTable(
	view: SnapshotView,
	opts: { tabName: string; headerRow: boolean },
): { table: TableSchema; records: DataRecord[] } {
	const width = Math.max(gridWidth(view.grid), 1);
	const header = opts.headerRow ? (view.grid[0] ?? []) : [];
	const fields: FieldSchema[] = Array.from({ length: width }, (_, c) => {
		const letter = columnLabel(c);
		const text = cellText(header[c]).trim();
		return {
			id: letter,
			name: text ? `${text}` : letter,
			type: 'singleLineText',
			description: text ? `Column ${letter}` : undefined,
		};
	});
	// Header labels must be unique keys in row.fields; disambiguate repeats.
	const seen = new Map<string, number>();
	for (const f of fields) {
		const n = seen.get(f.name) ?? 0;
		seen.set(f.name, n + 1);
		if (n > 0) f.name = `${f.name} (${f.id})`;
	}

	const start = opts.headerRow ? 1 : 0;
	const records: DataRecord[] = [];
	for (let r = start; r < view.grid.length; r++) {
		const cells = view.grid[r] ?? [];
		const previous = view.previous[r] ?? [];
		// A row that vanished from the sheet keeps its slot for one sync as
		// an empty row so the deletion shows; skip it entirely once it has no
		// history to show.
		if (cells.length === 0 && previous.length === 0) continue;
		const out: Record<string, unknown> = {};
		fields.forEach((f, c) => {
			const v = cells[c];
			out[f.name] = v == null ? null : typeof v === 'boolean' ? String(v) : v;
		});
		records.push({ id: `r${r}`, fields: out });
	}

	return {
		table: {
			id: opts.tabName,
			name: opts.tabName,
			primaryFieldId: fields[0]?.id ?? 'A',
			fields,
			views: [],
		},
		records,
	};
}

export type { SnapshotRowData };
