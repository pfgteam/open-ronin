// Shared reader for the Lead Scraper budget: the settings row plus the
// scraper_budget_status() RPC from 0072. Both /media/lead-scraper (the banner)
// and /admin/lead-scraper (the editor) read through here so they agree.
//
// Before 0072 applies the table and function are missing; that is reported as
// `applied: false` with safe defaults, never thrown, so neither page breaks.
//
// Server only. Client components import from ./settingsShared.

import { createClient } from '@/lib/supabase/server';
import {
	budgetFromRow,
	settingsFromRow,
	type ScraperConfig,
	type SettingsRow,
	type StatusRow,
} from './settingsShared';

export * from './settingsShared';

export async function getScraperConfig(): Promise<ScraperConfig> {
	const supabase = await createClient();
	const [{ data: row, error: rowError }, { data: status, error: statusError }] = await Promise.all([
		supabase
			.from('scraper_settings')
			.select('default_preset, default_max_results, cost_per_1000, monthly_budget_usd, updated_at, updated_by')
			.eq('id', 1)
			.maybeSingle(),
		supabase.rpc('scraper_budget_status').maybeSingle(),
	]);

	const applied = !rowError && !statusError && !!row;
	return {
		applied,
		settings: settingsFromRow((row as SettingsRow | null) ?? null),
		budget: budgetFromRow((status as StatusRow | null) ?? null),
	};
}
