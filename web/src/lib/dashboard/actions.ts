'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

import { opsCatalog, overviewCatalog } from './catalog';
import { sanitizeLayout } from './layout';
import type { LayoutItem } from './types';
import { explainAndLog } from '@/lib/errors';

// `catalog: null` = tiles are generated from the CEO Metrics sheet at request
// time (see lib/dashboard/sheetCatalog.ts), so there is no static key whitelist
// to validate against here. Delivery mixes both, hence null as well.
const DASHBOARDS: Record<string, { path: string; catalog: { key: string }[] | null }> = {
	overview: { path: '/dashboard', catalog: overviewCatalog },
	delivery: { path: '/dashboard/delivery', catalog: null },
	marketing: { path: '/dashboard/marketing', catalog: null },
	leadgen: { path: '/dashboard/leadgen', catalog: null },
	sales: { path: '/dashboard/sales', catalog: null },
	ops: { path: '/dashboard/ops', catalog: opsCatalog },
	social: { path: '/dashboard/social', catalog: null },
};

export interface SaveLayoutResult {
	error: string | null;
}

export async function saveLayout(
	dashboardKey: string,
	layout: LayoutItem[],
): Promise<SaveLayoutResult> {
	const config = DASHBOARDS[dashboardKey];
	if (!config) return { error: `Unknown dashboard: ${dashboardKey}` };

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { error: 'Not authenticated' };

	const clean = sanitizeLayout(config.catalog, layout);

	const { error } = await supabase.from('user_dashboard_layout').upsert(
		{ user_id: user.id, dashboard_key: dashboardKey, layout: clean },
		{ onConflict: 'user_id,dashboard_key' },
	);

	if (error) return { error: explainAndLog(error, 'dashboard.actions') };

	revalidatePath(config.path);
	return { error: null };
}

// Reset the user's layout back to the catalog default by deleting their row.
export async function resetLayout(dashboardKey: string): Promise<SaveLayoutResult> {
	const config = DASHBOARDS[dashboardKey];
	if (!config) return { error: `Unknown dashboard: ${dashboardKey}` };

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { error: 'Not authenticated' };

	const { error } = await supabase
		.from('user_dashboard_layout')
		.delete()
		.eq('user_id', user.id)
		.eq('dashboard_key', dashboardKey);

	if (error) return { error: explainAndLog(error, 'dashboard.actions') };

	revalidatePath(config.path);
	return { error: null };
}
