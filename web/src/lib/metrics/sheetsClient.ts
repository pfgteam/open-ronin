// Shared Google Sheets access for the "2026 CEO Metrics" scoreboards
// (Weekly tab -> lib/metrics/sheets.ts, Daily tab -> lib/metrics/daily.ts).
//
// Holds the three things both parsers need and neither owns:
//   1. Service-account auth (JWT bearer grant, RS256 via node:crypto).
//   2. A batched values fetch, so one request covers every tab we read.
//   3. The row walk shared by both tabs (col A = section, col B = group,
//      col C = metric name), parameterized by where the data columns start.
//
// Env vars:
//   GOOGLE_SERVICE_ACCOUNT_JSON   (required — service-account key, raw JSON or base64)
//   METRICS_SPREADSHEET_ID        (optional — defaults to the 2026 CEO Metrics sheet)

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export const DEFAULT_SPREADSHEET_ID = '1zKEEqnsDMXrKcFW8KvnCMM0MGubO38gQzZ37PKaYqIY';

export function getSpreadsheetId(): string {
	return process.env.METRICS_SPREADSHEET_ID ?? DEFAULT_SPREADSHEET_ID;
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

export type Cell = string | number | boolean | null | undefined;

export function cellStr(v: Cell): string {
	return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

export function toNum(v: Cell): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string') {
		const cleaned = v.replace(/[$,%\s]/g, '');
		if (cleaned === '' || cleaned === '-') return null;
		const n = Number(cleaned);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Service-account auth
// ---------------------------------------------------------------------------

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

// Accepts the key as raw JSON OR base64-encoded JSON (how it's stored in
// .env.local / Vercel — base64 avoids the newline-mangling that breaks
// multi-line JSON pasted into env var UIs).
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
	const candidates: string[] = [];
	const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
	candidates.push(trimmed);
	if (!trimmed.startsWith('{')) {
		try {
			const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
			if (decoded.trim().startsWith('{')) candidates.push(decoded);
		} catch {
			// not base64 — fall through
		}
	}
	for (const c of candidates) {
		try {
			return JSON.parse(c) as ServiceAccountKey;
		} catch {
			// try next candidate
		}
	}
	throw new Error(
		'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (tried raw and base64-decoded)',
	);
}

function b64url(input: Buffer | string): string {
	return Buffer.from(input)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * The service account's email, or null when the key is not configured. Shown
 * on /data/spreadsheets so a person knows which address to share a sheet
 * with; the email is not a secret (the private key is, and it never leaves
 * this module).
 */
export function getServiceAccountEmail(): string | null {
	const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!raw) return null;
	try {
		return parseServiceAccountKey(raw).client_email || null;
	} catch {
		return null;
	}
}

export async function getAccessToken(): Promise<string> {
	if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

	const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');

	const sa = parseServiceAccountKey(raw);
	if (!sa.client_email || !sa.private_key) {
		throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key');
	}

	const iat = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const claims = b64url(
		JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
	);
	const signer = createSign('RSA-SHA256');
	signer.update(`${header}.${claims}`);
	// Private keys pasted into env files often have literal \n sequences.
	const signature = b64url(signer.sign(sa.private_key.replace(/\\n/g, '\n')));

	const r = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${header}.${claims}.${signature}`,
		}),
	});
	if (!r.ok) throw new Error(`Google token exchange ${r.status}: ${await r.text()}`);
	const json = (await r.json()) as { access_token: string; expires_in: number };
	cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
	return cachedToken.token;
}

// ---------------------------------------------------------------------------
// Tab resolution
// ---------------------------------------------------------------------------

/**
 * A tab we read, identified by its gid — the one thing a rename can't change.
 * (2026-08-18: the tabs were renamed "Weekly" -> "Weekly - Open Ronin" and
 * "Daily" -> "Daily - Open Ronin", and every department dashboard died with
 * `Sheets API 400: Unable to parse range`. Titles are never hardcoded again.)
 */
export interface TabRef {
	/** Stable sheetId — the `#gid=` in the tab's URL. */
	sheetId: number;
	/** Fallback matcher, used only if the gid is gone (tab deleted + recreated). */
	match: RegExp;
	/** Name used in error messages. */
	name: string;
}

/** A range request: a tab (by gid) plus the A1 rectangle inside it. */
export interface SheetRange {
	tab: TabRef;
	/** A1 without the tab prefix, e.g. `A1:CA600`. */
	range: string;
}

interface TabInfo {
	sheetId: number;
	title: string;
}

const TAB_TTL_MS = 5 * 60_000;
let cachedTabs: { tabs: TabInfo[]; expiresAt: number } | null = null;

async function listTabs(): Promise<TabInfo[]> {
	if (cachedTabs && cachedTabs.expiresAt > Date.now()) return cachedTabs.tabs;

	const token = await getAccessToken();
	const fields = encodeURIComponent('sheets.properties(sheetId,title)');
	const r = await fetch(`${SHEETS_BASE}/${getSpreadsheetId()}?fields=${fields}`, {
		headers: { Authorization: `Bearer ${token}` },
		cache: 'no-store',
	});
	if (!r.ok) throw new Error(`Sheets API ${r.status} (tab list): ${await r.text()}`);
	const json = (await r.json()) as { sheets?: { properties?: Partial<TabInfo> }[] };
	const tabs = (json.sheets ?? [])
		.map((s) => s.properties)
		.filter(
			(p): p is TabInfo => typeof p?.sheetId === 'number' && typeof p?.title === 'string',
		);
	cachedTabs = { tabs, expiresAt: Date.now() + TAB_TTL_MS };
	return tabs;
}

/** Current title of a tab: matched by gid first, by name only as a fallback. */
export async function resolveTabTitle(ref: TabRef): Promise<string> {
	const tabs = await listTabs();
	const byId = tabs.find((t) => t.sheetId === ref.sheetId);
	if (byId) return byId.title;
	const byName = tabs.find((t) => ref.match.test(t.title));
	if (byName) return byName.title;
	throw new Error(
		`The "${ref.name}" tab (gid ${ref.sheetId}) is not in the spreadsheet any more — ` +
			`tabs present: ${tabs.map((t) => t.title).join(', ') || '(none)'}`,
	);
}

/** A1 with the tab title quoted, so spaces, hyphens and quotes are all safe. */
export function a1(title: string, range: string): string {
	return `'${title.replace(/'/g, "''")}'!${range}`;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

// One values:batchGet for every range we need. Returns the grids in the same
// order as `specs` (missing ranges come back as []). Tab titles are resolved
// from their gid first, so renaming a tab in the sheet can't 400 the app.
// Throws on failure so callers can decide what to cache.
export async function batchGetRanges(specs: SheetRange[]): Promise<Cell[][][]> {
	const titles = await Promise.all(specs.map((s) => resolveTabTitle(s.tab)));
	const token = await getAccessToken();
	const qs = titles
		.map((title, i) => `ranges=${encodeURIComponent(a1(title, specs[i].range))}`)
		.concat('valueRenderOption=UNFORMATTED_VALUE')
		.join('&');
	const url = `${SHEETS_BASE}/${getSpreadsheetId()}/values:batchGet?${qs}`;
	// no-store: freshness is governed by the unstable_cache wrapper around the
	// caller — a second fetch-level TTL here would only add staleness.
	const r = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
		cache: 'no-store',
	});
	if (!r.ok) throw new Error(`Sheets API ${r.status}: ${await r.text()}`);
	const json = (await r.json()) as { valueRanges?: { values?: Cell[][] }[] };
	const out = json.valueRanges ?? [];
	return specs.map((_, i) => out[i]?.values ?? []);
}

// ---------------------------------------------------------------------------
// Shared row walk
// ---------------------------------------------------------------------------

export interface ScoreboardRow<P> {
	section: string; // col A, carried down (e.g. "Marketing")
	g1: string | null; // last group-header row (col B alone, e.g. "Meta Ads")
	g2: string | null; // last col-B value (e.g. "Main")
	label: string; // metric name (col C, or col B for a B-only metric row)
	isGroupHeader: boolean;
	point: P;
}

interface WalkOptions<P> {
	/** First column that can hold data — Weekly: 3 (Targets), Daily: 5 (after Source of Truth). */
	firstDataCol: number;
	buildPoint: (row: Cell[]) => P;
	emptyPoint: P;
}

// Both scoreboard tabs share the same left-hand shape: col A names the section
// (carried down), col B is either a group header (no data on the row) or a
// sub-label, col C is the metric. `values` includes the header row, which is
// skipped here.
export function walkScoreboard<P>(values: Cell[][], opts: WalkOptions<P>): ScoreboardRow<P>[] {
	const rows: ScoreboardRow<P>[] = [];
	let section = '';
	let g1: string | null = null;
	let g2: string | null = null;

	for (let i = 1; i < values.length; i++) {
		const row = values[i] ?? [];
		const a = cellStr(row[0]);
		const b = cellStr(row[1]);
		const c = cellStr(row[2]);

		if (a) {
			section = a;
			g1 = null;
			g2 = null;
		}
		if (!section || (!b && !c)) continue;

		if (c) {
			// Metric row; col B (when present) names the sub-group (e.g. "Main").
			if (b) g2 = b;
			rows.push({
				section,
				g1,
				g2,
				label: c,
				isGroupHeader: false,
				point: opts.buildPoint(row),
			});
			continue;
		}

		// B-only row: a group header (no data anywhere) or a metric named in B.
		const hasAnyValue = row.slice(opts.firstDataCol).some((cell) => toNum(cell) !== null);
		if (hasAnyValue) {
			rows.push({
				section,
				g1,
				g2,
				label: b,
				isGroupHeader: false,
				point: opts.buildPoint(row),
			});
		} else {
			g1 = b;
			g2 = null;
			rows.push({
				section,
				g1,
				g2: null,
				label: b,
				isGroupHeader: true,
				point: opts.emptyPoint,
			});
		}
	}

	return rows;
}

// Case- and whitespace-insensitive metric lookup, shared by both parsers.
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface PickQuery {
	section: string;
	label: string;
	g1?: string;
	g2?: string;
}

export function findRow<P>(
	rows: ScoreboardRow<P>[],
	q: PickQuery,
): ScoreboardRow<P> | undefined {
	return rows.find(
		(r) =>
			!r.isGroupHeader &&
			norm(r.section) === norm(q.section) &&
			norm(r.label) === norm(q.label) &&
			(q.g1 === undefined || norm(r.g1 ?? '') === norm(q.g1)) &&
			(q.g2 === undefined || norm(r.g2 ?? '') === norm(q.g2)),
	);
}
