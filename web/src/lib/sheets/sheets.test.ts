import { describe, expect, it } from 'vitest';
import { columnLabel, diffGrids, parseSpreadsheetId, toCsv } from './client';
import { buildSnapshotView, toTable, type SnapshotRow } from './snapshot';
import { isDue, readRowData, resolveTabs, type SheetSourceRow } from './sync';

describe('parseSpreadsheetId', () => {
	const id = '1zKEEqnsDMXrKcFW8KvnCMM0MGubO38gQzZ37PKaYqIY';
	it('reads a full URL with edit, gid and query', () => {
		expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing#gid=123`)).toBe(id);
	});
	it('reads the /u/0/ account form', () => {
		expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/u/0/d/${id}/edit`)).toBe(id);
	});
	it('accepts a bare id and trims', () => {
		expect(parseSpreadsheetId(`  ${id}  `)).toBe(id);
	});
	it('rejects prose and other Google URLs', () => {
		expect(parseSpreadsheetId('my finance sheet')).toBeNull();
		expect(parseSpreadsheetId('https://docs.google.com/document/d/abc')).toBeNull();
		expect(parseSpreadsheetId('')).toBeNull();
	});
});

describe('columnLabel', () => {
	it('matches the sheet lettering', () => {
		expect(columnLabel(0)).toBe('A');
		expect(columnLabel(25)).toBe('Z');
		expect(columnLabel(26)).toBe('AA');
		expect(columnLabel(27)).toBe('AB');
		expect(columnLabel(701)).toBe('ZZ');
	});
});

describe('toCsv', () => {
	it('quotes commas, quotes and newlines and pads ragged rows', () => {
		const csv = toCsv([
			['Name', 'Note', 'N'],
			['Acme, Inc', 'said "hi"', 3],
			['Short'],
		]);
		expect(csv.split('\r\n')).toEqual(['Name,Note,N', '"Acme, Inc","said ""hi""",3', 'Short,,']);
	});
});

describe('diffGrids', () => {
	it('names changed, added and removed cells', () => {
		const changed = diffGrids(
			[
				['a', 'b'],
				['c', 'd'],
			],
			[
				['a', 'B'],
				['c', 'd'],
				['e'],
			],
		);
		expect([...changed].sort()).toEqual(['0:1', '2:0']);
	});
	it('treats null and empty string as the same', () => {
		expect(diffGrids([['', null]], [[null, '']]).size).toBe(0);
	});
});

describe('isDue', () => {
	const base: SheetSourceRow = {
		id: 'x',
		google_sheet_id: 'y',
		display_name: 'z',
		tabs: [],
		sync_interval_minutes: 30,
		last_synced_at: null,
		last_sync_status: null,
		last_sync_error: null,
	};
	const now = new Date('2026-09-12T12:00:00Z');
	it('never synced is due', () => {
		expect(isDue(base, now)).toBe(true);
	});
	it('respects the interval on the row', () => {
		expect(isDue({ ...base, last_synced_at: '2026-09-12T11:45:00Z' }, now)).toBe(false);
		expect(isDue({ ...base, last_synced_at: '2026-09-12T11:30:00Z' }, now)).toBe(true);
		expect(isDue({ ...base, last_synced_at: '2026-09-12T11:45:00Z', sync_interval_minutes: 10 }, now)).toBe(true);
	});
});

describe('resolveTabs', () => {
	it('empty config means every live tab', () => {
		expect(resolveTabs([], ['A', 'B'])).toEqual({ tabs: ['A', 'B'], healed: false });
	});
	it('heals a config with no matching tab (the 0001 Sheet1 seed)', () => {
		expect(resolveTabs(['Sheet1'], ['Team Basics'])).toEqual({ tabs: ['Team Basics'], healed: true });
	});
	it('keeps a partial match so the missing tab is reported', () => {
		expect(resolveTabs(['Weekly', 'Gone'], ['Weekly', 'Daily'])).toEqual({ tabs: ['Weekly', 'Gone'], healed: false });
	});
});

describe('readRowData', () => {
	it('accepts the new shape and a legacy bare array', () => {
		expect(readRowData({ cells: [1, 'a'], prev: null, changed_at: null })).toEqual({ cells: [1, 'a'], prev: null, changed_at: null });
		expect(readRowData(['x'])).toEqual({ cells: ['x'], prev: null, changed_at: null });
		expect(readRowData(null)).toEqual({ cells: [], prev: null, changed_at: null });
	});
});

describe('buildSnapshotView + toTable', () => {
	// The done test in miniature: a sheet with a header and two rows is
	// synced, then B2 changes in Google and the next sync records it. The
	// view must show the new value with exactly that cell highlighted.
	const t1 = '2026-09-12T10:00:00Z';
	const t2 = '2026-09-12T10:30:00Z';
	const rows: SnapshotRow[] = [
		{ row_index: 0, row_data: { cells: ['Client', 'Package'], prev: null, changed_at: t1 }, synced_at: t1 },
		{ row_index: 1, row_data: { cells: ['Acme', 'Kickstarter'], prev: ['Acme', 'Maintenance'], changed_at: t2 }, synced_at: t2 },
		{ row_index: 2, row_data: { cells: ['Globex', 'Grow'], prev: null, changed_at: t1 }, synced_at: t1 },
	];

	it('highlights only the cell that changed in the latest sync', () => {
		const view = buildSnapshotView(rows);
		expect(view.changedAt).toBe(t2);
		expect(view.syncedAt).toBe(t2);
		expect(view.changedKeys).toEqual(['r1:B']);
		expect(view.grid[1]).toEqual(['Acme', 'Kickstarter']);
		expect(view.previous[1]).toEqual(['Acme', 'Maintenance']);
	});

	it('shapes the grid for BaseExplorerTable with header names and stable ids', () => {
		const { table, records } = toTable(buildSnapshotView(rows), { tabName: 'Sheet1', headerRow: true });
		expect(table.fields.map((f) => [f.id, f.name])).toEqual([
			['A', 'Client'],
			['B', 'Package'],
		]);
		expect(records.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(records[0].fields).toEqual({ Client: 'Acme', Package: 'Kickstarter' });
	});

	it('keeps the header as data when asked and disambiguates repeated headers', () => {
		const view = buildSnapshotView([
			{ row_index: 0, row_data: { cells: ['Name', 'Name', ''], prev: null, changed_at: null }, synced_at: t1 },
			{ row_index: 1, row_data: { cells: ['a', 'b', 'c'], prev: null, changed_at: null }, synced_at: t1 },
		]);
		const withHeader = toTable(view, { tabName: 'T', headerRow: true });
		expect(withHeader.table.fields.map((f) => f.name)).toEqual(['Name', 'Name (B)', 'C']);
		const asData = toTable(view, { tabName: 'T', headerRow: false });
		expect(asData.table.fields.map((f) => f.name)).toEqual(['A', 'B', 'C']);
		expect(asData.records).toHaveLength(2);
	});

	it('shows a deleted row once as empty then drops it', () => {
		const view = buildSnapshotView([
			{ row_index: 0, row_data: { cells: ['h'], prev: null, changed_at: t1 }, synced_at: t1 },
			{ row_index: 1, row_data: { cells: [], prev: ['gone'], changed_at: t2 }, synced_at: t2 },
		]);
		expect(view.changedKeys).toEqual(['r1:A']);
		const { records } = toTable(view, { tabName: 'T', headerRow: true });
		expect(records).toHaveLength(1);
		expect(records[0].fields).toEqual({ h: null });
	});
});
