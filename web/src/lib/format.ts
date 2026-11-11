// Lightweight formatters used across module pages.

import { format, parseISO } from 'date-fns';

/**
 * the org's canonical company clock (CST/CDT). Vercel runs UTC, so anything that
 * decides what "today" is for a human must resolve the day in THIS zone —
 * otherwise HQ's evening work is dated to tomorrow.
 */
export const BUSINESS_TZ = 'America/Chicago';

/** Today in BUSINESS_TZ as `YYYY-MM-DD`. `en-CA` is the locale that formats that way. */
export function businessToday(now: Date = new Date()): string {
	return now.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ });
}

export function formatCurrency(amount: number | null | undefined, currency = 'USD'): string {
	if (amount == null || Number.isNaN(amount)) return '—';
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		maximumFractionDigits: 0,
	}).format(amount);
}

// Same as formatCurrency but keeps cents — for small unit costs (CPC, CPL)
// where rounding to whole dollars destroys the number.
export function formatCurrencyPrecise(
	amount: number | null | undefined,
	currency = 'USD',
): string {
	if (amount == null || Number.isNaN(amount)) return '—';
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}

export function formatNumber(value: number | null | undefined): string {
	if (value == null || Number.isNaN(value)) return '—';
	return new Intl.NumberFormat('en-US').format(value);
}

// Sheet metrics carry raw division results (ROAS 567.6509965, a 7-day mean of
// 2.428571): show at most one decimal, and none once the number is big enough
// for the decimal to be noise.
export function formatMetricNumber(value: number | null | undefined): string {
	if (value == null || Number.isNaN(value)) return '—';
	const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
	return formatNumber(rounded);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
	if (value == null || Number.isNaN(value)) return '—';
	return new Intl.NumberFormat('en-US', {
		style: 'percent',
		maximumFractionDigits: digits,
	}).format(value);
}

export function formatDate(iso: string | null | undefined, fmt = 'MMM d, yyyy'): string {
	if (!iso) return '—';
	try {
		return format(parseISO(iso), fmt);
	} catch {
		return iso;
	}
}

export function formatRelative(iso: string | null | undefined): string {
	if (!iso) return '—';
	try {
		const date = parseISO(iso);
		const now = Date.now();
		const diff = now - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		if (days === 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 7) return `${days}d ago`;
		if (days < 30) return `${Math.floor(days / 7)}w ago`;
		if (days < 365) return `${Math.floor(days / 30)}mo ago`;
		return `${Math.floor(days / 365)}y ago`;
	} catch {
		return iso;
	}
}
