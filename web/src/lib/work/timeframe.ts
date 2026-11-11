// Goal timeframe vocabulary — the two dependent fields added by migration 0080.
//
// Field A (grain) picks the kind of period; Field B (value) picks WHICH one,
// with a list that depends on A. Week is 1-13 of a 12-Week-Year quarter
// (quarters table), never a calendar week. No server imports here so the
// client form can use it directly.

export const TIMEFRAME_GRAINS = ['year', 'quarter', 'month', 'week', 'day'] as const;
export type TimeframeGrain = (typeof TIMEFRAME_GRAINS)[number];

export const GRAIN_LABELS: Record<TimeframeGrain, string> = {
	year: 'Year',
	quarter: 'Quarter (12WY)',
	month: 'Month',
	week: 'Week (1–13 of a quarter)',
	day: 'Day',
};

export const WEEKS_PER_QUARTER = 13;

/** Minimal quarters row the option builders need. */
export interface QuarterLite {
	id: string;
	/** '26-3' */
	name: string;
	year?: number | null;
	quarter?: number | null;
	starts_on?: string | null;
}

export interface TimeframeOption {
	value: string;
	label: string;
}

const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Q3 2026" from a quarters row; falls back to the raw name. */
export function quarterLabel(q: QuarterLite): string {
	const num = q.quarter ?? Number(q.name.split('-')[1]);
	const year = q.year ?? (q.starts_on ? Number(q.starts_on.slice(0, 4)) : 2000 + Number(q.name.split('-')[0]));
	if (!num || !year) return q.name;
	return `Q${num} ${year}`;
}

/** Years to offer: the quarters' span padded one year either side, or now±2. */
export function yearOptions(quarters: QuarterLite[], now = new Date()): TimeframeOption[] {
	const years = new Set<number>();
	for (const q of quarters) {
		const y = q.year ?? (q.starts_on ? Number(q.starts_on.slice(0, 4)) : null);
		if (y) years.add(y);
	}
	const cur = now.getFullYear();
	if (years.size === 0) for (let y = cur - 1; y <= cur + 2; y++) years.add(y);
	const min = Math.min(...years) - 1;
	const max = Math.max(...years, cur) + 1;
	const out: TimeframeOption[] = [];
	for (let y = max; y >= min; y--) out.push({ value: String(y), label: String(y) });
	return out;
}

export function quarterOptions(quarters: QuarterLite[]): TimeframeOption[] {
	return quarters.map((q) => ({ value: q.name, label: quarterLabel(q) }));
}

/** 12 months per year in the year list, newest first. */
export function monthOptions(quarters: QuarterLite[], now = new Date()): TimeframeOption[] {
	const out: TimeframeOption[] = [];
	for (const y of yearOptions(quarters, now)) {
		for (let m = 12; m >= 1; m--) {
			const mm = String(m).padStart(2, '0');
			out.push({ value: `${y.value}-${mm}`, label: `${MONTHS[m - 1]} ${y.value}` });
		}
	}
	return out;
}

/** Weeks 1-13 for every quarter, grouped by quarter, newest quarter first. */
export function weekOptions(quarters: QuarterLite[]): { group: string; options: TimeframeOption[] }[] {
	return quarters.map((q) => ({
		group: quarterLabel(q),
		options: Array.from({ length: WEEKS_PER_QUARTER }, (_, i) => ({
			value: `${q.name}:W${i + 1}`,
			label: `Week ${i + 1} · ${quarterLabel(q)}`,
		})),
	}));
}

/** The quarter name embedded in a quarter or week value, or null. */
export function quarterNameFromValue(grain: TimeframeGrain | '', value: string): string | null {
	if (!value) return null;
	if (grain === 'quarter') return value;
	if (grain === 'week') return value.split(':')[0] ?? null;
	return null;
}

const PATTERNS: Record<TimeframeGrain, RegExp> = {
	year: /^\d{4}$/,
	quarter: /^\d{2}-[1-4]$/,
	month: /^\d{4}-(0[1-9]|1[0-2])$/,
	week: /^\d{2}-[1-4]:W([1-9]|1[0-3])$/,
	day: /^\d{4}-\d{2}-\d{2}$/,
};

/** Mirrors the 0080 check constraint so the form refuses before the DB does. */
export function isValidTimeframe(grain: TimeframeGrain | '' | null | undefined, value: string | null | undefined): boolean {
	if (!grain && !value) return true;
	if (!grain || !value) return false;
	return PATTERNS[grain].test(value);
}

/** Human label for a stored pair, e.g. "Week 5 · Q3 2026". */
export function describeTimeframe(
	grain: TimeframeGrain | null | undefined,
	value: string | null | undefined,
	quarters: QuarterLite[] = [],
): string | null {
	if (!grain || !value) return null;
	const q = (name: string) => {
		const row = quarters.find((x) => x.name === name);
		return row ? quarterLabel(row) : name;
	};
	switch (grain) {
		case 'year': return value;
		case 'quarter': return q(value);
		case 'month': {
			const [y, m] = value.split('-');
			return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
		}
		case 'week': {
			const [qn, w] = value.split(':W');
			return `Week ${w} · ${q(qn)}`;
		}
		case 'day': return value;
	}
}
