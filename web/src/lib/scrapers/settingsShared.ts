// Client safe scraper settings vocabulary: presets, labels, types, defaults
// and the row mapper. No server imports here (the admin form is a client
// component). The Supabase reader lives in settings.ts.

export const SCRAPER_PRESETS = [
	'b2b_database',
	'trade_show',
	'linkedin_search',
	'agency_owners',
	// Media presets (0102).
	'news_journalists',
	'email_waterfall',
	'outlet_crawl',
] as const;
export type ScraperPreset = (typeof SCRAPER_PRESETS)[number];

export const PRESET_LABELS: Record<ScraperPreset, string> = {
	b2b_database: 'B2B database (Apollo style search)',
	trade_show: 'Trade show exhibitor list',
	linkedin_search: 'LinkedIn search',
	agency_owners: 'Agency owners (acquisitions)',
	news_journalists: 'Journalists by beat (Google News)',
	email_waterfall: 'Email waterfall (name + outlet → email)',
	outlet_crawl: 'Outlet crawl (newsroom mailboxes)',
};

export interface ScraperSettings {
	defaultPreset: ScraperPreset;
	defaultMaxResults: number;
	/** USD per 1,000 rows per preset. */
	costPer1000: Record<string, number>;
	monthlyBudgetUsd: number | null;
	updatedAt: string | null;
	updatedBy: string | null;
}

export interface BudgetStatus {
	monthlyBudgetUsd: number | null;
	spentUsd: number;
	remainingUsd: number | null;
	overCap: boolean;
}

export interface ScraperConfig {
	applied: boolean;
	settings: ScraperSettings;
	budget: BudgetStatus;
}

export const DEFAULT_SETTINGS: ScraperSettings = {
	defaultPreset: 'b2b_database',
	defaultMaxResults: 250,
	costPer1000: {
		b2b_database: 1.5,
		trade_show: 5,
		linkedin_search: 4,
		agency_owners: 1.5,
		// Live Apify store, 2026-09-19, Free tier.
		news_journalists: 2.3,
		email_waterfall: 5,
		outlet_crawl: 2,
	},
	monthlyBudgetUsd: null,
	updatedAt: null,
	updatedBy: null,
};

export interface SettingsRow {
	default_preset: string;
	default_max_results: number;
	cost_per_1000: Record<string, unknown> | null;
	monthly_budget_usd: number | string | null;
	updated_at: string | null;
	updated_by: string | null;
}

export interface StatusRow {
	monthly_budget_usd: number | string | null;
	spent_usd: number | string | null;
	remaining_usd: number | string | null;
	over_cap: boolean | null;
}

export const num = (v: number | string | null | undefined): number | null =>
	v === null || v === undefined ? null : Number(v);

export function settingsFromRow(row: SettingsRow | null): ScraperSettings {
	if (!row) return DEFAULT_SETTINGS;
	const costs: Record<string, number> = {};
	for (const [k, v] of Object.entries(row.cost_per_1000 ?? {})) {
		const n = Number(v);
		if (Number.isFinite(n) && n >= 0) costs[k] = n;
	}
	return {
		defaultPreset: (SCRAPER_PRESETS as readonly string[]).includes(row.default_preset)
			? (row.default_preset as ScraperPreset)
			: 'b2b_database',
		defaultMaxResults: row.default_max_results,
		costPer1000: { ...DEFAULT_SETTINGS.costPer1000, ...costs },
		monthlyBudgetUsd: num(row.monthly_budget_usd),
		updatedAt: row.updated_at,
		updatedBy: row.updated_by,
	};
}

export function budgetFromRow(s: StatusRow | null): BudgetStatus {
	return {
		monthlyBudgetUsd: num(s?.monthly_budget_usd),
		spentUsd: num(s?.spent_usd) ?? 0,
		remainingUsd: num(s?.remaining_usd),
		overCap: s?.over_cap === true,
	};
}

export const usd = (n: number) =>
	n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
