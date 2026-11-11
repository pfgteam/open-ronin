// Weekly CEO metrics from the "2026 CEO Metrics" Google Sheet (Weekly tab),
// plus the single cached fetch that also loads the Daily tab (see ./daily.ts).
// Powers the department dashboards (/dashboard/{marketing,leadgen,sales,ops,social}).
//
// Design:
//   • Auth, fetching and the shared row walk live in ./sheetsClient.ts.
//   • Both tabs come back in ONE values:batchGet, wrapped in a single
//     unstable_cache entry — so the daily cards and the weekly table always
//     describe the same snapshot of the sheet, at no extra network cost.
//   • The Weekly tab is a hand-maintained scoreboard: col A = section
//     (Marketing, Lead Gen, Sales, ...), col B = group/sub-label, col C =
//     metric name, col D = targets, then one column per month/week (most
//     recent first). Nothing here throws — errors are surfaced on the result
//     for the page to render.

import { unstable_cache } from 'next/cache';

import {
	batchGetRanges,
	cellStr,
	findRow,
	toNum,
	walkScoreboard,
	type Cell,
	type PickQuery,
	type ScoreboardRow,
	type SheetRange,
	type TabRef,
} from './sheetsClient';
import { DAILY_RANGE, emptyDailyMetrics, parseDaily, type DailyMetrics } from './daily';

/** The Weekly tab, pinned by gid — its title became "Weekly - Open Ronin" on 2026-08-18. */
const WEEKLY_TAB: TabRef = { sheetId: 1024282112, match: /^weekly\b/i, name: 'Weekly' };

// The scoreboard currently ends around row 426 (the MVP block); 600 is headroom
// so a few appended rows don't get silently cut off the bottom again.
const WEEKLY_RANGE: SheetRange = { tab: WEEKLY_TAB, range: 'A1:CA600' };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricPoint {
	target: number | null;
	week: number | null; // current week column
	prevWeek: number | null; // previous week column
	month: number | null; // current month (MTD) column
}

export type WeeklyRow = ScoreboardRow<MetricPoint>;

export interface WeeklyMetrics {
	rows: WeeklyRow[];
	weekLabel: string | null; // e.g. "07/10 - 07/16"
	prevWeekLabel: string | null;
	monthLabel: string | null; // e.g. "July"
	error: string | null;
}

const EMPTY_POINT: MetricPoint = { target: null, week: null, prevWeek: null, month: null };

export const EMPTY_WEEKLY_METRICS: WeeklyMetrics = {
	rows: [],
	weekLabel: null,
	prevWeekLabel: null,
	monthLabel: null,
	error: null,
};

/** Both scoreboard tabs, from one cached fetch. */
export interface SheetMetrics {
	weekly: WeeklyMetrics;
	daily: DailyMetrics;
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

const WEEK_RE = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/;
const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

interface WeekCol {
	col: number;
	label: string;
	start: Date;
	end: Date;
}

// Week ranges are MM/DD - MM/DD with no year; assume the current year.
// (Around New Year the Dec/Jan columns may resolve a year off — acceptable
// for a live scoreboard that is rebuilt annually.)
function parseWeekCols(header: Cell[], year: number): WeekCol[] {
	const out: WeekCol[] = [];
	header.forEach((cell, col) => {
		const s = cellStr(cell);
		const m = WEEK_RE.exec(s);
		if (!m) return;
		const [, m1, d1, m2, d2] = m.map(Number) as unknown as number[];
		out.push({
			col,
			label: s,
			start: new Date(year, m1 - 1, d1),
			end: new Date(year, m2 - 1, d2, 23, 59, 59),
		});
	});
	return out;
}

// Throws on failure so unstable_cache never stores an error snapshot.
async function fetchSheetMetrics(): Promise<SheetMetrics> {
	const [weeklyValues, dailyValues] = await batchGetRanges([WEEKLY_RANGE, DAILY_RANGE]);
	if (weeklyValues.length < 2) throw new Error('Weekly tab returned no rows');

	// Parsed independently: a shape change in one tab can't blank the other.
	let weekly: WeeklyMetrics;
	try {
		weekly = parseWeekly(weeklyValues);
	} catch (e) {
		weekly = { ...EMPTY_WEEKLY_METRICS, error: msg(e) };
	}

	let daily: DailyMetrics;
	try {
		daily = parseDaily(dailyValues);
	} catch (e) {
		daily = emptyDailyMetrics(msg(e));
	}

	return { weekly, daily };
}

function msg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

// The parsed scoreboard is identical for every viewer — compute once per TTL
// and share it across all requests + all department dashboards.
const fetchSheetMetricsCached = unstable_cache(fetchSheetMetrics, ['ceo-sheet-metrics'], {
	revalidate: 120,
});

export async function getSheetMetrics(): Promise<SheetMetrics> {
	try {
		return await fetchSheetMetricsCached();
	} catch (e) {
		const error = msg(e);
		return {
			weekly: { ...EMPTY_WEEKLY_METRICS, error },
			daily: emptyDailyMetrics(error),
		};
	}
}

export async function getWeeklyMetrics(): Promise<WeeklyMetrics> {
	return (await getSheetMetrics()).weekly;
}


export function parseWeekly(values: Cell[][], now: Date = new Date()): WeeklyMetrics {
	const header = values[0] ?? [];

	// Column discovery ------------------------------------------------------
	const targetCol = header.findIndex((c) => cellStr(c).toLowerCase() === 'targets');

	const weekCols = parseWeekCols(header, now.getFullYear()).sort(
		(a, b) => b.start.getTime() - a.start.getTime(),
	);

	// A week column "has data" when any metric row holds a numeric value in it.
	// The sheet is filled in arrears, so the calendar-current column is often
	// still empty — selecting it would render every tile as "—".
	const dataRows = values.slice(1);
	const colHasData = (col: number) => dataRows.some((r) => toNum((r ?? [])[col]) !== null);

	// Current week = the range containing today IF it already has data, else
	// the most recent already-started range with data, else the calendar pick.
	const started = weekCols.filter((w) => w.start <= now);
	const current =
		started.find((w) => now >= w.start && now <= w.end && colHasData(w.col)) ??
		started.find((w) => colHasData(w.col)) ??
		started[0] ??
		weekCols[0] ??
		null;

	// Prev week = the next older column that has data (adjacent weeks are
	// sometimes skipped in the sheet).
	const prev = current
		? (weekCols.slice(weekCols.indexOf(current) + 1).find((w) => colHasData(w.col)) ?? null)
		: null;

	// MTD column = the month of the week being shown, not the calendar month —
	// when the sheet's latest data is July, August's MTD column is still empty.
	const monthName = current
		? MONTH_NAMES[current.start.getMonth()]
		: MONTH_NAMES[now.getMonth()];
	const monthCol = header.findIndex((c) => cellStr(c) === monthName);

	const buildPoint = (row: Cell[]): MetricPoint => ({
		target: targetCol >= 0 ? toNum(row[targetCol]) : null,
		week: current ? toNum(row[current.col]) : null,
		prevWeek: prev ? toNum(row[prev.col]) : null,
		month: monthCol >= 0 ? toNum(row[monthCol]) : null,
	});

	return {
		rows: walkScoreboard(values, { firstDataCol: 3, buildPoint, emptyPoint: EMPTY_POINT }),
		weekLabel: current?.label ?? null,
		prevWeekLabel: prev?.label ?? null,
		monthLabel: monthCol >= 0 ? monthName : null,
		error: null,
	};
}

// ---------------------------------------------------------------------------
// Lookup helpers used by the dashboard pages
// ---------------------------------------------------------------------------

// Find a metric by section + label (and optionally its group), case- and
// whitespace-insensitive. Returns an all-null point when not found so tiles
// degrade to "—" instead of crashing.
export function pick(m: WeeklyMetrics, q: PickQuery): MetricPoint {
	return findRow(m.rows, q)?.point ?? EMPTY_POINT;
}

// All rows belonging to the given sections (sheet order preserved).
export function rowsFor(m: WeeklyMetrics, sections: string[]): WeeklyRow[] {
	const wanted = new Set(sections.map((s) => s.toLowerCase().trim()));
	return m.rows.filter((r) => wanted.has(r.section.toLowerCase().trim()));
}

export type { PickQuery };
