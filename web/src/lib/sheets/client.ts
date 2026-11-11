// Generic, spreadsheet agnostic reads for the Data Spreadsheets module.
//
// lib/metrics/sheetsClient.ts is pinned to the CEO Metrics sheet (its tab
// cache and batchGet are keyed to one spreadsheet id). The sync in
// lib/sheets/sync.ts walks every sheet_sources row, so it needs the same
// auth with the spreadsheet id as a parameter. Auth and the cell helpers
// stay in sheetsClient; only the per spreadsheet fetches live here.
//
// Pure helpers (URL parsing, CSV) are exported for unit tests and have no
// network or env dependency.

import { a1, getAccessToken, type Cell } from '@/lib/metrics/sheetsClient';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface SpreadsheetMeta {
	title: string;
	tabs: { sheetId: number; title: string }[];
}

/**
 * Pull the spreadsheet id out of anything a person pastes: a full URL
 * (with or without /edit, #gid=, ?usp=), or the bare id. Returns null when
 * nothing id shaped is present. Ids are the URL safe base64 alphabet plus
 * hyphen, 20 or more characters.
 */
export function parseSpreadsheetId(input: string): string | null {
	const s = input.trim();
	if (!s) return null;
	const fromUrl = /\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/.exec(s);
	if (fromUrl) return fromUrl[1];
	if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
	return null;
}

export function spreadsheetUrl(id: string): string {
	return `https://docs.google.com/spreadsheets/d/${id}`;
}

async function sheetsFetch(url: string): Promise<Response> {
	const token = await getAccessToken();
	return fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
		cache: 'no-store',
	});
}

/** Friendlier wording for the two errors people actually hit. */
async function describeFailure(r: Response, what: string): Promise<string> {
	const text = await r.text();
	if (r.status === 403) {
		return `Google returned 403 for ${what}. Share the sheet with the service account email (Viewer is enough).`;
	}
	if (r.status === 404) {
		return `Google returned 404 for ${what}. Check the spreadsheet id; the sheet may have been deleted or the URL may be for a different document.`;
	}
	return `Sheets API ${r.status} (${what}): ${text.slice(0, 300)}`;
}

/** Title plus the tab list for any spreadsheet the service account can read. */
export async function getSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
	const fields = encodeURIComponent('properties.title,sheets.properties(sheetId,title)');
	const r = await sheetsFetch(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
	if (!r.ok) throw new Error(await describeFailure(r, 'metadata'));
	const json = (await r.json()) as {
		properties?: { title?: string };
		sheets?: { properties?: { sheetId?: number; title?: string } }[];
	};
	const tabs = (json.sheets ?? [])
		.map((s) => s.properties)
		.filter((p): p is { sheetId: number; title: string } =>
			typeof p?.sheetId === 'number' && typeof p?.title === 'string',
		);
	return { title: json.properties?.title ?? spreadsheetId, tabs };
}

/**
 * Every value on the named tabs, one grid per tab in the same order.
 * A tab that no longer exists comes back as an Error in its slot instead of
 * failing the whole batch, so one renamed tab cannot blank a sheet's other
 * tabs (the 2026-08-18 lesson from sheetsClient).
 */
export async function getTabValues(
	spreadsheetId: string,
	tabTitles: string[],
	meta?: SpreadsheetMeta,
): Promise<(Cell[][] | Error)[]> {
	if (tabTitles.length === 0) return [];
	const live = meta ?? (await getSpreadsheetMeta(spreadsheetId));
	const present = new Set(live.tabs.map((t) => t.title));
	const wanted = tabTitles.map((t) => (present.has(t) ? t : null));
	const found = wanted.filter((t): t is string => t !== null);

	let grids: Cell[][][] = [];
	if (found.length > 0) {
		const qs = found
			.map((title) => `ranges=${encodeURIComponent(a1(title, 'A1:ZZ'))}`)
			.concat('valueRenderOption=UNFORMATTED_VALUE', 'dateTimeRenderOption=FORMATTED_STRING')
			.join('&');
		const r = await sheetsFetch(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}`);
		if (!r.ok) throw new Error(await describeFailure(r, 'values'));
		const json = (await r.json()) as { valueRanges?: { values?: Cell[][] }[] };
		const out = json.valueRanges ?? [];
		grids = found.map((_, i) => out[i]?.values ?? []);
	}

	let cursor = 0;
	return wanted.map((t, i) =>
		t === null
			? new Error(
					`Tab "${tabTitles[i]}" is not in the spreadsheet (tabs present: ${live.tabs.map((x) => x.title).join(', ') || 'none'})`,
				)
			: grids[cursor++],
	);
}

// ---------------------------------------------------------------------------
// Grid helpers shared by sync and the Snapshots tab
// ---------------------------------------------------------------------------

/** Column label the way the sheet shows it: A, B, ..., Z, AA, AB. */
export function columnLabel(index: number): string {
	let n = index + 1;
	let label = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		label = String.fromCharCode(65 + rem) + label;
		n = Math.floor((n - 1) / 26);
	}
	return label;
}

/** Widest row wins; ragged rows are padded with empty strings on read. */
export function gridWidth(grid: Cell[][]): number {
	return grid.reduce((w, row) => Math.max(w, row.length), 0);
}

function cellText(v: Cell): string {
	if (v == null) return '';
	if (typeof v === 'string') return v;
	return String(v);
}

/** RFC 4180 style: quote when the value has a comma, quote, or newline. */
export function toCsv(grid: Cell[][]): string {
	const width = gridWidth(grid);
	return grid
		.map((row) =>
			Array.from({ length: width }, (_, i) => {
				const s = cellText(row[i]);
				return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
			}).join(','),
		)
		.join('\r\n');
}

/**
 * Cells that differ between two grids, keyed "row:col" (zero based). A cell
 * missing from one side counts as empty on that side, so an added row shows
 * every non empty cell as changed and a deleted row the same.
 */
export function diffGrids(prev: Cell[][], next: Cell[][]): Set<string> {
	const changed = new Set<string>();
	const rows = Math.max(prev.length, next.length);
	const cols = Math.max(gridWidth(prev), gridWidth(next));
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			if (cellText(prev[r]?.[c]) !== cellText(next[r]?.[c])) changed.add(`${r}:${c}`);
		}
	}
	return changed;
}
