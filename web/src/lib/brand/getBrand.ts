// getBrand(): the platform brand for anything that generates content.
//
// Content Studio (Module 2), email templates and generated documents read the
// brand from here rather than from the `brands` row directly, so the fallback
// rules live in one place: a missing row or a null column yields the Tailwind
// tokens the app chrome already uses, never null. The app chrome itself does
// NOT read this; its colors are build time Tailwind tokens by design.
//
// Server only (reads through the request's Supabase client; brands_read_auth
// lets every signed in user read it). React cached: one SELECT per render.

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
	DEFAULT_ACCENT,
	DEFAULT_PRIMARY,
	DEFAULT_TYPOGRAPHY,
	HEX_COLOR,
	PLATFORM_BRAND_ID,
	SOCIAL_KEYS,
	TYPOGRAPHY,
	TYPOGRAPHY_STACKS,
	publicUrlForPath,
	type Brand,
	type SocialKey,
	type Typography,
} from './constants';

export type { Brand } from './constants';

export interface BrandRow {
	id: string;
	brand_name: string;
	website_url: string | null;
	logo_light_path: string | null;
	logo_dark_path: string | null;
	primary_color: string | null;
	accent_color: string | null;
	typography: string | null;
	email_footer: string | null;
	social_handles: Record<string, unknown> | null;
	updated_at: string | null;
}

export const BRAND_COLUMNS =
	'id, brand_name, website_url, logo_light_path, logo_dark_path, primary_color, accent_color, typography, email_footer, social_handles, updated_at';

/** Pure: a row (or nothing) to a Brand with every fallback applied. */
export function brandFromRow(row: BrandRow | null): Brand {
	const typography: Typography =
		row?.typography && (TYPOGRAPHY as readonly string[]).includes(row.typography)
			? (row.typography as Typography)
			: DEFAULT_TYPOGRAPHY;
	const handles: Partial<Record<SocialKey, string>> = {};
	for (const key of SOCIAL_KEYS) {
		const v = row?.social_handles?.[key];
		if (typeof v === 'string' && v.trim()) handles[key] = v.trim();
	}
	return {
		id: row?.id ?? PLATFORM_BRAND_ID,
		name: row?.brand_name ?? 'Open Ronin',
		websiteUrl: row?.website_url ?? null,
		logoLightPath: row?.logo_light_path ?? null,
		logoDarkPath: row?.logo_dark_path ?? null,
		logoLightUrl: publicUrlForPath(row?.logo_light_path ?? null),
		logoDarkUrl: publicUrlForPath(row?.logo_dark_path ?? null),
		primaryColor: row?.primary_color && HEX_COLOR.test(row.primary_color) ? row.primary_color : DEFAULT_PRIMARY,
		accentColor: row?.accent_color && HEX_COLOR.test(row.accent_color) ? row.accent_color : DEFAULT_ACCENT,
		typography,
		fontStack: TYPOGRAPHY_STACKS[typography],
		emailFooter: row?.email_footer ?? '',
		socialHandles: handles,
		updatedAt: row?.updated_at ?? null,
	};
}

export const getBrand = cache(async (): Promise<Brand> => {
	const supabase = await createClient();
	const { data } = await supabase
		.from('brands')
		.select(BRAND_COLUMNS)
		.eq('is_platform', true)
		.maybeSingle();
	// 0072 not applied yet (is_platform missing) surfaces as an error and a
	// null row; the defaults are exactly what the app used before the page.
	return brandFromRow((data as BrandRow | null) ?? null);
});
