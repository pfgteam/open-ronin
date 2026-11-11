'use server';

// Server actions for /admin/lead-scraper: the scraper_settings row (0072).
// Admin only; RLS (scraper_settings_update) enforces the same. Every save
// writes audit_log. The budget cap is enforced by the SQL trigger, so this
// action only needs to store a sane number.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { SCRAPER_PRESETS } from '@/lib/scrapers/settingsShared';

const PATH = '/admin/lead-scraper';

export type ScraperSettingsResult = { ok: true } | { ok: false; error: string };

const money = z.coerce.number().min(0).max(1_000_000);

const schema = z.object({
	defaultPreset: z.enum(SCRAPER_PRESETS),
	defaultMaxResults: z.coerce.number().int().min(1).max(5000),
	// Empty string means no cap.
	monthlyBudgetUsd: z.union([z.literal(''), money]),
	costs: z.record(z.enum(SCRAPER_PRESETS), money),
});

export async function saveScraperSettings(formData: FormData): Promise<ScraperSettingsResult> {
	const viewer = await getAuthProfile();
	if (!viewer) return { ok: false, error: 'You are signed out. Sign in again and retry.' };
	if (!viewer.is_active || !['admin', 'exec'].includes(viewer.role)) {
		return { ok: false, error: 'Only exec and admin accounts can change scraper settings.' };
	}

	const costs: Record<string, unknown> = {};
	for (const p of SCRAPER_PRESETS) costs[p] = formData.get(`cost_${p}`) ?? '';

	const parsed = schema.safeParse({
		defaultPreset: formData.get('default_preset'),
		defaultMaxResults: formData.get('default_max_results'),
		monthlyBudgetUsd: (formData.get('monthly_budget_usd') as string | null)?.trim() ?? '',
		costs,
	});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false, error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid settings.' };
	}
	const v = parsed.data;

	const supabase = await createClient();
	const { data: before } = await supabase
		.from('scraper_settings')
		.select('default_preset, default_max_results, cost_per_1000, monthly_budget_usd')
		.eq('id', 1)
		.maybeSingle();

	const update = {
		default_preset: v.defaultPreset,
		default_max_results: v.defaultMaxResults,
		cost_per_1000: v.costs,
		monthly_budget_usd: v.monthlyBudgetUsd === '' ? null : v.monthlyBudgetUsd,
		updated_by: viewer.id,
	};

	const { data: saved, error } = await supabase
		.from('scraper_settings')
		.update(update)
		.eq('id', 1)
		.select('id');
	if (error) {
		return {
			ok: false,
			error: error.code === '42P01'
				? 'Scraper settings need migration 0072_brand_settings.sql applied first.'
				: `Could not save: ${error.message}`,
		};
	}
	if (!saved || saved.length === 0) {
		return { ok: false, error: 'Nothing was saved. The settings row is missing (apply 0072) or you lack permission.' };
	}

	await recordAudit({
		actor_id: viewer.id,
		entity_kind: 'supabase',
		entity_ref: 'scraper_settings/1',
		action: 'scraper.settings.update',
		diff: { before: before ?? null, after: update },
	});

	revalidatePath(PATH);
	revalidatePath('/media/lead-scraper');
	return { ok: true };
}
