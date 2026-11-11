// Daily CEO metrics from the "2026 CEO Metrics" Google Sheet (Daily tab).
// Powers the "Yesterday" KPI cards on /dashboard/{marketing,leadgen,sales,social}.
//
// Tab shape (verified 2026-08-13):
//   col A = section (Marketing, Lead Gen, CRM, Sales, Finances, Media,
//           Podcasts, Influencers, Social)
//   col B = group / sub-label            col C = metric name
//   col D = "Definition"                 col E = "Source of Truth"
//   col F.. = ONE COLUMN PER DAY, header is a Sheets date serial, most recent
//           first. (The Weekly tab instead has Targets in col D — the two tabs
//           do NOT share the same geometry, hence two parsers over one walker.)
//
// Two rules that come from how the sheet is actually maintained:
//   • The requested day is ALWAYS D-1 in the org's canonical clock (US Central).
//     The tab is filled in arrears, so when yesterday's column doesn't exist
//     yet every point is null and the page shows an "awaiting data" banner —
//     deliberately no silent fallback to the last filled day (decided 13/08).
//   • Columns are matched BY DATE SERIAL, never by position, so a skipped day
//     or a column inserted on the wrong side can't shift every number.

import { BUSINESS_TZ } from '@/lib/format';
import {
	findRow,
	toNum,
	walkScoreboard,
	type Cell,
	type PickQuery,
	type ScoreboardRow,
	type SheetRange,
	type TabRef,
} from './sheetsClient';

/** Sheets serial 1 = 1899-12-31, so day 0 is 1899-12-30. */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** How far back a row must have data to count as still tracked (see hasRecentData). */
const RECENT_WINDOW_DAYS = 30;
/** Points in the sparkline series — two weeks, so the card carries a bi-weekly trend. */
const SERIES_DAYS = 14;
/** Plausible serial window (2010-01-01 .. 2059-12-31) — filters stray header numbers. */
const MIN_SERIAL = 40_179;
const MAX_SERIAL = 58_439;

/** The Daily tab, pinned by gid — its title became "Daily - Open Ronin" on 2026-08-18. */
export const DAILY_TAB: TabRef = { sheetId: 2116360037, match: /^daily\b/i, name: 'Daily' };

export const DAILY_RANGE: SheetRange = { tab: DAILY_TAB, range: 'A1:GG200' };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyPoint {
	/** D-1 (the requested day). */
	day: number | null;
	/** D-2, for the day-over-day delta. */
	prevDay: number | null;
	/** Mean of the filled days in D-1..D-7 (divided by days present, not by 7). */
	avg7: number | null;
	/** D-8 — lets stock metrics (followers) show a 7-day net change. */
	sameDayPrevWeek: number | null;
	/**
	 * True when the row holds a number in the last RECENT_WINDOW_DAYS days.
	 * Independent of the requested day, so a consumer can tell a channel that was
	 * switched off (Smartlead/Leadify: last filled 05/12) from a row that is
	 * simply waiting on yesterday's column.
	 */
	hasRecentData: boolean;
	/**
	 * Last SERIES_DAYS days, oldest first, ending on the requested day — the
	 * sparkline series. Filled even when the requested day itself is missing:
	 * the trend is context, not the day's number.
	 */
	series: (number | null)[];
}

export type DailyRow = ScoreboardRow<DailyPoint>;

export interface DailyMetrics {
	rows: DailyRow[];
	/** Always D-1 in BUSINESS_TZ, e.g. "08/12" — shown even when data is missing. */
	requestedDay: string;
	/** D-2, e.g. "08/11". */
	prevDayLabel: string;
	/** False when yesterday's column is absent OR present but empty. */
	hasRequestedDay: boolean;
	/** Most recent day that does have data, for the pending banner. */
	latestFilledDay: string | null;
	error: string | null;
}

export const EMPTY_DAILY_POINT: DailyPoint = {
	day: null,
	prevDay: null,
	avg7: null,
	sameDayPrevWeek: null,
	hasRecentData: false,
	series: [],
};

/** Card context (day labels + pending flag) passed to tile subtitles. */

// ---------------------------------------------------------------------------
// Date <-> serial helpers (business timezone)
// ---------------------------------------------------------------------------

interface Ymd {
	y: number;
	m: number;
	d: number;
}

// "Today" as the US Central team sees it — not the server's UTC date.
function todayInBusinessTz(now: Date): Ymd {
	// en-CA gives YYYY-MM-DD, which needs no locale-order guessing.
	const iso = new Intl.DateTimeFormat('en-CA', {
		timeZone: BUSINESS_TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now);
	const [y, m, d] = iso.split('-').map(Number);
	return { y, m, d };
}

function serialFromYmd({ y, m, d }: Ymd): number {
	return Math.round((Date.UTC(y, m - 1, d) - SHEETS_EPOCH_UTC) / DAY_MS);
}

function labelFromSerial(serial: number): string {
	const dt = new Date(SHEETS_EPOCH_UTC + serial * DAY_MS);
	const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(dt.getUTCDate()).padStart(2, '0');
	return `${mm}/${dd}`;
}

// Header cells are serials with UNFORMATTED_VALUE, but tolerate text dates in
// case someone reformats a column: "08/12", "08/12/2026", "2026-08-12".
function headerSerial(cell: Cell, fallbackYear: number): number | null {
	if (typeof cell === 'number' && Number.isFinite(cell)) {
		const s = Math.round(cell);
		return s >= MIN_SERIAL && s <= MAX_SERIAL ? s : null;
	}
	if (typeof cell !== 'string') return null;
	const s = cell.trim();

	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
	if (m) return serialFromYmd({ y: +m[1], m: +m[2], d: +m[3] });

	m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
	if (m) {
		const rawYear = m[3] ? +m[3] : fallbackYear;
		const y = rawYear < 100 ? 2000 + rawYear : rawYear;
		return serialFromYmd({ y, m: +m[1], d: +m[2] });
	}
	return null;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function emptyDailyMetrics(error: string | null = null, now: Date = new Date()): DailyMetrics {
	const yesterday = serialFromYmd(todayInBusinessTz(now)) - 1;
	return {
		rows: [],
		requestedDay: labelFromSerial(yesterday),
		prevDayLabel: labelFromSerial(yesterday - 1),
		hasRequestedDay: false,
		latestFilledDay: null,
		error,
	};
}

export function parseDaily(values: Cell[][], now: Date = new Date()): DailyMetrics {
	const today = todayInBusinessTz(now);
	const yesterday = serialFromYmd(today) - 1;
	const base = emptyDailyMetrics(null, now);
	if (values.length < 2) return { ...base, error: 'Daily tab returned no rows' };

	const header = values[0] ?? [];
	const dataRows = values.slice(1);

	// serial -> column index (first occurrence wins; the tab has no duplicates).
	const colBySerial = new Map<number, number>();
	header.forEach((cell, col) => {
		if (col < 3) return; // A-C are labels; D/E are Definition / Source of Truth
		const serial = headerSerial(cell, today.y);
		if (serial != null && !colBySerial.has(serial)) colBySerial.set(serial, col);
	});

	const colHasData = (col: number) => dataRows.some((r) => toNum((r ?? [])[col]) !== null);
	const at = (row: Cell[], serial: number): number | null => {
		const col = colBySerial.get(serial);
		return col === undefined ? null : toNum(row[col]);
	};

	const dayCol = colBySerial.get(yesterday);
	const hasRequestedDay = dayCol !== undefined && colHasData(dayCol);

	let latestFilled: number | null = null;
	for (const [serial, col] of colBySerial) {
		if ((latestFilled === null || serial > latestFilled) && colHasData(col)) latestFilled = serial;
	}

	// Recency window for "is this row still being tracked" — a metric nobody has
	// filled in a month is a switched-off channel, not a pending day.
	const recentCols: number[] = [];
	for (let k = 0; k < RECENT_WINDOW_DAYS; k++) {
		const col = colBySerial.get(yesterday - k);
		if (col !== undefined) recentCols.push(col);
	}
	const rowHasRecent = (row: Cell[]) => recentCols.some((col) => toNum(row[col]) !== null);

	// Strict D-1: with no data for yesterday every value degrades to "—" and the
	// page surfaces the gap, rather than quietly showing an older day. hasHistory
	// still reports whether the row is tracked at all.
	const buildSeries = (row: Cell[]): (number | null)[] => {
		const out: (number | null)[] = [];
		for (let k = SERIES_DAYS - 1; k >= 0; k--) out.push(at(row, yesterday - k));
		return out;
	};

	const buildPoint = (row: Cell[]): DailyPoint => {
		if (!hasRequestedDay) {
			return {
				...EMPTY_DAILY_POINT,
				hasRecentData: rowHasRecent(row),
				series: buildSeries(row),
			};
		}
		const window: number[] = [];
		for (let k = 0; k < 7; k++) {
			const v = at(row, yesterday - k);
			if (v != null) window.push(v);
		}
		return {
			day: at(row, yesterday),
			prevDay: at(row, yesterday - 1),
			avg7: window.length ? window.reduce((a, b) => a + b, 0) / window.length : null,
			sameDayPrevWeek: at(row, yesterday - 7),
			hasRecentData: rowHasRecent(row),
			series: buildSeries(row),
		};
	};

	return {
		rows: walkScoreboard(values, { firstDataCol: 5, buildPoint, emptyPoint: EMPTY_DAILY_POINT }),
		requestedDay: base.requestedDay,
		prevDayLabel: base.prevDayLabel,
		hasRequestedDay,
		latestFilledDay: latestFilled === null ? null : labelFromSerial(latestFilled),
		error: null,
	};
}

// ---------------------------------------------------------------------------
// Lookup helpers used by the dashboard pages
// ---------------------------------------------------------------------------

// Find a daily metric by section + label (and optionally its group). Returns an
// all-null point when not found, so a renamed sheet row degrades to "—"
// instead of crashing the page.
export function pickDaily(m: DailyMetrics, q: PickQuery): DailyPoint {
	return findRow(m.rows, q)?.point ?? EMPTY_DAILY_POINT;
}

// Field-wise sum, for metrics the Daily tab doesn't total itself (e.g. total ad
// spend = Google + Meta). Null only when every input is null, so a partially
// filled day still shows the part that exists.
export function sumDailyPoints(...points: DailyPoint[]): DailyPoint {
	const add = (key: keyof DailyPoint): number | null => {
		const vals = points.map((p) => p[key]).filter((v): v is number => v != null);
		return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
	};
	const len = Math.max(0, ...points.map((p) => p.series.length));
	const series: (number | null)[] = [];
	for (let i = 0; i < len; i++) {
		const vals = points
			.map((p) => p.series[i])
			.filter((v): v is number => v != null && Number.isFinite(v));
		series.push(vals.length ? vals.reduce((a, b) => a + b, 0) : null);
	}

	return {
		day: add('day'),
		prevDay: add('prevDay'),
		avg7: add('avg7'),
		sameDayPrevWeek: add('sameDayPrevWeek'),
		hasRecentData: points.some((p) => p.hasRecentData),
		series,
	};
}

/** 7-day net change for stock metrics (followers, database counts). */
export function net7(p: DailyPoint): number | null {
	if (p.day == null || p.sameDayPrevWeek == null) return null;
	return p.day - p.sameDayPrevWeek;
}
