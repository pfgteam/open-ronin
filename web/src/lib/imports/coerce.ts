// Type coercion for imported cells. Pure functions, unit tested.
//
// Every coercer takes the raw cell string and returns either the typed value
// or an error string. An empty cell is null for optional columns and an error
// for required ones; the caller decides, so `coerce` never sees required.

import type { ColumnSpec, ColumnType } from './types';

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

const ok = (value: unknown): CoerceResult => ({ ok: true, value });
const fail = (error: string): CoerceResult => ({ ok: false, error });

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', 'on', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'off', '', 'unchecked']);

const MONTHS: Record<string, number> = {
	jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
	jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
	oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function validYmd(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1) return false;
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return d <= days;
}

/**
 * Parses a date cell into YYYY-MM-DD. Accepts ISO (with or without time),
 * US m/d/yyyy, d.m.yyyy, "12 Mar 2026", "Mar 12, 2026", "March 2026" (day
 * 1), and Excel serial numbers (what an XLSX date cell reads as when the
 * sheet stores it as a number). Two digit years are refused: 03/04/26 is
 * ambiguous in three ways and the fix is a proper column in the file.
 */
export function parseDate(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;

	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
	if (m) {
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
	}

	m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (m) {
		const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
		return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
	}

	m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (m) {
		const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
		return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
	}

	m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
	if (m) {
		const mo = MONTHS[m[2].toLowerCase()];
		const [d, y] = [Number(m[1]), Number(m[3])];
		return mo && validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
	}

	m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
	if (m) {
		const mo = MONTHS[m[1].toLowerCase()];
		const [d, y] = [Number(m[2]), Number(m[3])];
		return mo && validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
	}

	m = s.match(/^([A-Za-z]+)\.?,?\s+(\d{4})$/);
	if (m) {
		const mo = MONTHS[m[1].toLowerCase()];
		return mo ? `${m[2]}-${pad(mo)}-01` : null;
	}

	m = s.match(/^(\d{4})-(\d{1,2})$/);
	if (m) {
		const mo = Number(m[2]);
		return mo >= 1 && mo <= 12 ? `${m[1]}-${pad(mo)}-01` : null;
	}

	// Excel serial (days since 1899-12-30). 20000 is 1954; 80000 is 2119.
	if (/^\d{5}(\.\d+)?$/.test(s)) {
		const serial = Math.floor(Number(s));
		const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
		const dt = new Date(ms);
		return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
	}

	return null;
}

/** Number with thousands separators, currency symbols and parentheses for negatives. */
export function parseNumber(raw: string): number | null {
	let s = raw.trim();
	if (!s) return null;
	let negative = false;
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1);
	}
	s = s.replace(/[$€£,\s]/g, '');
	if (s.startsWith('-')) {
		negative = !negative;
		s = s.slice(1);
	}
	if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
	const n = Number(s);
	if (!Number.isFinite(n)) return null;
	return negative ? -n : n;
}

export function parseBoolean(raw: string): boolean | null {
	const s = raw.trim().toLowerCase();
	if (TRUE_WORDS.has(s)) return true;
	if (FALSE_WORDS.has(s)) return false;
	return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string | null {
	const s = raw.trim().toLowerCase();
	if (!s) return null;
	return EMAIL_RE.test(s) ? s : null;
}

export function normalizeUrl(raw: string): string | null {
	let s = raw.trim();
	if (!s) return null;
	if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
	try {
		const u = new URL(s);
		if (!u.hostname.includes('.')) return null;
		return u.toString();
	} catch {
		return null;
	}
}

/** Keeps digits, plus, spaces, parentheses and dashes; refuses anything with letters. */
export function normalizePhone(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;
	if (/[A-Za-z]/.test(s)) return null;
	const digits = s.replace(/\D/g, '');
	if (digits.length < 7 || digits.length > 15) return null;
	return s.replace(/\s+/g, ' ');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits on commas, semicolons or pipes; trims; drops empties; dedupes. */
export function parseList(raw: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(/[,;|]/)) {
		const v = part.trim();
		if (!v) continue;
		const k = v.toLowerCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(v);
	}
	return out;
}

function matchEnum(value: string, values: readonly string[]): string | null {
	const k = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
	for (const v of values) {
		if (v.toLowerCase().replace(/[\s_-]+/g, ' ') === k) return v;
	}
	return null;
}

/** Postgres `integer` (int4) upper bound. */
const INT4_MAX = 2_147_483_647;

export function coerce(raw: string | null | undefined, type: ColumnType, spec?: Pick<ColumnSpec, 'values'>): CoerceResult {
	const s = raw == null ? '' : String(raw);
	if (!s.trim()) return ok(null);

	switch (type) {
		case 'text':
			return ok(s.trim());
		case 'email': {
			const v = normalizeEmail(s);
			return v ? ok(v) : fail(`"${s.trim()}" is not an email address`);
		}
		case 'phone': {
			const v = normalizePhone(s);
			return v ? ok(v) : fail(`"${s.trim()}" is not a phone number`);
		}
		case 'url': {
			const v = normalizeUrl(s);
			return v ? ok(v) : fail(`"${s.trim()}" is not a URL`);
		}
		case 'number': {
			const v = parseNumber(s);
			return v == null ? fail(`"${s.trim()}" is not a number`) : ok(v);
		}
		case 'integer':
		case 'bigint': {
			// No rounding: "303.456" may be 303,456 typed with a dot, so the row
			// is rejected with the value for a human instead of guessed. The
			// range is the Postgres column's, so the dry run predicts the write.
			const v = parseNumber(s);
			if (v == null) return fail(`"${s.trim()}" is not a number`);
			if (!Number.isInteger(v)) return fail(`"${s.trim()}" is not a whole number`);
			const max = type === 'integer' ? INT4_MAX : Number.MAX_SAFE_INTEGER;
			return Math.abs(v) > max ? fail(`"${s.trim()}" is too large for this column (max ${max})`) : ok(v);
		}
		case 'currency_cents': {
			const v = parseNumber(s);
			return v == null ? fail(`"${s.trim()}" is not an amount`) : ok(Math.round(v * 100));
		}
		case 'date': {
			const v = parseDate(s);
			return v ? ok(v) : fail(`"${s.trim()}" is not a date (use YYYY-MM-DD)`);
		}
		case 'month': {
			const v = parseDate(s);
			return v ? ok(`${v.slice(0, 7)}-01`) : fail(`"${s.trim()}" is not a month (use YYYY-MM)`);
		}
		case 'boolean': {
			const v = parseBoolean(s);
			return v == null ? fail(`"${s.trim()}" is not yes or no`) : ok(v);
		}
		case 'enum': {
			const values = spec?.values ?? [];
			const v = matchEnum(s, values);
			return v ? ok(v) : fail(`"${s.trim()}" is not one of ${values.join(', ')}`);
		}
		case 'list': {
			const items = parseList(s);
			if (spec?.values?.length) {
				const mapped: string[] = [];
				for (const item of items) {
					const v = matchEnum(item, spec.values);
					if (!v) return fail(`"${item}" is not one of ${spec.values.join(', ')}`);
					if (!mapped.includes(v)) mapped.push(v);
				}
				return ok(mapped);
			}
			return ok(items);
		}
		case 'uuid': {
			const v = s.trim();
			return UUID_RE.test(v) ? ok(v.toLowerCase()) : fail(`"${v}" is not an id`);
		}
	}
}

/** Human label for the preview column header. */
export const TYPE_LABELS: Record<ColumnType, string> = {
	text: 'text',
	email: 'email',
	phone: 'phone',
	url: 'URL',
	number: 'number',
	integer: 'whole number',
	bigint: 'whole number',
	currency_cents: 'currency',
	date: 'date',
	month: 'month',
	boolean: 'yes/no',
	enum: 'one of',
	list: 'list',
	uuid: 'id',
};
