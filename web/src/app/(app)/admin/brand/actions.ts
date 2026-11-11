'use server';

// Server actions for /admin/brand. Admin only (requireAdmin plus the
// brands_update_admin policy from 0072); every save writes audit_log.
//
// Logo BYTES never pass through here: the browser uploads straight to the
// public `avatars` bucket under `brand/<platform id>/` with the admin's own
// session (0054's insert policy passes is_admin()), and only the resulting
// PATH is saved. The 0072 CHECK constraints refuse any path outside that
// prefix, so a URL to some other host can never be stored as a logo.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
	BRAND_PREFIX,
	HEX_COLOR,
	PLATFORM_BRAND_ID,
	SOCIAL_KEYS,
	TYPOGRAPHY,
	normalizeHandle,
} from '@/lib/brand/constants';
import { BRAND_COLUMNS, type BrandRow } from '@/lib/brand/getBrand';

const PATH = '/admin/brand';

export type BrandActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<{ actorId: string } | { error: string }> {
	const viewer = await getAuthProfile();
	if (!viewer) return { error: 'You are signed out. Sign in again and retry.' };
	if (!viewer.is_active || !['admin', 'exec'].includes(viewer.role)) {
		return { error: 'Only exec and admin accounts can change the brand.' };
	}
	return { actorId: viewer.id };
}

const hex = z
	.string()
	.trim()
	.regex(HEX_COLOR, 'Colors must be six digit hex, like #069494.')
	.transform((s) => s.toLowerCase());

const settingsSchema = z.object({
	name: z.string().trim().min(1, 'Brand name is required.').max(120),
	websiteUrl: z
		.string()
		.trim()
		.max(300)
		.refine((s) => s === '' || /^https?:\/\/\S+$/.test(s), 'Website must start with http:// or https://.'),
	primaryColor: hex,
	accentColor: hex,
	typography: z.enum(TYPOGRAPHY),
	emailFooter: z.string().max(1000),
	socialHandles: z.record(z.string(), z.string()),
});

function pathFromRow(row: BrandRow | null, key: 'logo_light_path' | 'logo_dark_path'): string | null {
	return row ? row[key] : null;
}

/** Text settings: name, colors, typography, footer, handles. */
export async function saveBrandSettings(formData: FormData): Promise<BrandActionResult> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };

	const handles: Record<string, string> = {};
	for (const key of SOCIAL_KEYS) {
		const raw = formData.get(`social_${key}`);
		if (typeof raw === 'string') {
			const v = normalizeHandle(raw);
			if (v) handles[key] = v;
		}
	}

	const parsed = settingsSchema.safeParse({
		name: formData.get('name'),
		websiteUrl: formData.get('website_url') ?? '',
		primaryColor: formData.get('primary_color'),
		accentColor: formData.get('accent_color'),
		typography: formData.get('typography'),
		emailFooter: formData.get('email_footer') ?? '',
		socialHandles: handles,
	});
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid brand settings.' };
	}
	const v = parsed.data;

	const supabase = await createClient();
	const { data: before } = await supabase
		.from('brands')
		.select(BRAND_COLUMNS)
		.eq('id', PLATFORM_BRAND_ID)
		.maybeSingle();

	const update = {
		brand_name: v.name,
		website_url: v.websiteUrl || null,
		primary_color: v.primaryColor,
		accent_color: v.accentColor,
		typography: v.typography,
		email_footer: v.emailFooter.trim() || null,
		social_handles: v.socialHandles,
		brand_updated_by: gate.actorId,
	};

	// .select() so an RLS denial (zero rows) is visible rather than silent.
	const { data: saved, error } = await supabase
		.from('brands')
		.update(update)
		.eq('id', PLATFORM_BRAND_ID)
		.select('id');
	if (error) {
		return {
			ok: false,
			error: error.message.includes('is_platform') || error.code === '42703'
				? 'Brand settings need migration 0072_brand_settings.sql applied first.'
				: `Could not save: ${error.message}`,
		};
	}
	if (!saved || saved.length === 0) {
		return { ok: false, error: 'Nothing was saved. The brand row is missing (apply 0072) or you lack permission.' };
	}

	await recordAudit({
		actor_id: gate.actorId,
		entity_kind: 'supabase',
		entity_ref: `brands/${PLATFORM_BRAND_ID}`,
		action: 'brand.settings.update',
		diff: { before: before ?? null, after: update },
	});

	revalidatePath(PATH);
	return { ok: true };
}

const logoSchema = z.object({
	variant: z.enum(['light', 'dark']),
	// null clears; otherwise a path under the brand prefix, matching the 0072 CHECK.
	path: z
		.string()
		.regex(/^brand\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/, 'That file is not in the brand storage folder.')
		.refine((p) => p.startsWith(BRAND_PREFIX), 'That file is not in the brand storage folder.')
		.nullable(),
});

/** Record an uploaded logo path (or clear one). The upload itself happened
 *  browser side; see the header. */
export async function setBrandLogo(variant: 'light' | 'dark', path: string | null): Promise<BrandActionResult> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };

	const parsed = logoSchema.safeParse({ variant, path });
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid logo.' };

	const column = parsed.data.variant === 'light' ? 'logo_light_path' : 'logo_dark_path';
	const supabase = await createClient();
	const { data: before } = await supabase
		.from('brands')
		.select(BRAND_COLUMNS)
		.eq('id', PLATFORM_BRAND_ID)
		.maybeSingle();
	const previous = pathFromRow((before as BrandRow | null) ?? null, column);

	const { data: saved, error } = await supabase
		.from('brands')
		.update({ [column]: parsed.data.path, brand_updated_by: gate.actorId })
		.eq('id', PLATFORM_BRAND_ID)
		.select('id');
	if (error) return { ok: false, error: `Could not save the logo: ${error.message}` };
	if (!saved || saved.length === 0) {
		return { ok: false, error: 'Nothing was saved. The brand row is missing (apply 0072) or you lack permission.' };
	}

	// The old object is orphaned once the row no longer points at it. Best
	// effort: a failed delete costs a few KB of storage, not correctness.
	if (previous && previous !== parsed.data.path) {
		await supabase.storage.from('avatars').remove([previous]);
	}

	await recordAudit({
		actor_id: gate.actorId,
		entity_kind: 'supabase',
		entity_ref: `brands/${PLATFORM_BRAND_ID}`,
		action: parsed.data.path ? 'brand.logo.set' : 'brand.logo.clear',
		diff: { variant: parsed.data.variant, before: previous, after: parsed.data.path },
	});

	revalidatePath(PATH);
	return { ok: true };
}
