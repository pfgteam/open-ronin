// Pure helpers for Client Analytics: month window, series alignment, CSV.
// No Supabase import so they unit test under Vitest and the export route
// can share them.

import { addMonths, format, startOfMonth } from 'date-fns';

export const TREND_MONTHS = 12;

/** First of month ISO dates for the trend window, oldest first. */
export function trendMonths(now: Date = new Date(), count = TREND_MONTHS): string[] {
	const start = startOfMonth(now);
	return Array.from({ length: count }, (_, i) => format(addMonths(start, i - (count - 1)), 'yyyy-MM-dd'));
}

/** One slot per window month; null where the mirror has no row (not synced). */
export function alignToMonths<T extends { month: string }>(rows: T[], months: string[]): (T | null)[] {
	const byMonth = new Map(rows.map((r) => [r.month, r]));
	return months.map((m) => byMonth.get(m) ?? null);
}

export function monthLabel(iso: string): string {
	return format(new Date(`${iso}T00:00:00`), 'MMM yy');
}

/**
 * RFC 4180 quoting plus a leading apostrophe on anything a spreadsheet would
 * execute (same rule as the Lead Scraper export). Client names come from
 * Airtable, which is user typed.
 */
export function csvCell(value: unknown): string {
	let s = value == null ? '' : String(value);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
	return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
	return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
