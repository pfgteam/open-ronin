// Brand constants shared by the server helper (getBrand.ts), the Brand admin
// page and, later, Content Studio (Module 2). No server imports here.

/** The platform brand row id, seeded by 0076 (the file was renumbered from
 *  0072 and the seed id moved with it; the constant lagged behind until
 *  0111, which made every /admin/brand save match zero rows). Stable so
 *  the storage prefix (`brand/<id>/`) never moves. */
export const PLATFORM_BRAND_ID = 'b7a3c1d0-0000-4000-8000-000000000076';

/** Bucket the logos live in (public, 0054) and the prefix the 0072 CHECK
 *  constraints require. */
export const BRAND_BUCKET = 'avatars';
export const BRAND_PREFIX = `brand/${PLATFORM_BRAND_ID}/`;

/** Six digit hex only, so a value can be dropped into a style attribute or an
 *  email template without sanitising. Mirrors the CHECK in 0072. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The allowed typography set. Mirrors brands_typography_check in 0072. */
export const TYPOGRAPHY = ['inter', 'system', 'georgia'] as const;
export type Typography = (typeof TYPOGRAPHY)[number];

export const TYPOGRAPHY_LABELS: Record<Typography, string> = {
	inter: 'Inter (app default)',
	system: 'System sans serif',
	georgia: 'Georgia (serif)',
};

/** CSS font stacks for each choice, for previews and generated content. */
export const TYPOGRAPHY_STACKS: Record<Typography, string> = {
	inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
	system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
	georgia: 'Georgia, "Times New Roman", serif',
};

/** Social handles the Brand page edits, in display order. Stored in
 *  brands.social_handles jsonb keyed by these names. */
export const SOCIAL_KEYS = ['instagram', 'linkedin', 'x', 'facebook', 'tiktok', 'youtube'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export const SOCIAL_LABELS: Record<SocialKey, string> = {
	instagram: 'Instagram',
	linkedin: 'LinkedIn',
	x: 'X',
	facebook: 'Facebook',
	tiktok: 'TikTok',
	youtube: 'YouTube',
};

/** The Tailwind brand tokens (tailwind.config.ts primary-600 / accent-600).
 *  Used as the fallback when the row carries no color, so getBrand() never
 *  returns null colors and generated content always has a palette. */
export const DEFAULT_PRIMARY = '#069494';
export const DEFAULT_ACCENT = '#88d03a';
export const DEFAULT_TYPOGRAPHY: Typography = 'inter';

export interface Brand {
	id: string;
	name: string;
	websiteUrl: string | null;
	/** Public URLs, or null when no logo has been uploaded. */
	logoLightUrl: string | null;
	logoDarkUrl: string | null;
	/** Bucket paths, kept so the admin page can replace or remove the object. */
	logoLightPath: string | null;
	logoDarkPath: string | null;
	primaryColor: string;
	accentColor: string;
	typography: Typography;
	fontStack: string;
	emailFooter: string;
	socialHandles: Partial<Record<SocialKey, string>>;
	updatedAt: string | null;
}

/** `https://<project>.supabase.co/storage/v1/object/public/avatars/<path>` */
export function publicUrlForPath(path: string | null): string | null {
	if (!path) return null;
	const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!base) return null;
	return `${base.replace(/\/+$/, '')}/storage/v1/object/public/${BRAND_BUCKET}/${path}`;
}

/** Strip a leading @ and whitespace; handles are stored bare. */
export function normalizeHandle(raw: string): string {
	return raw.trim().replace(/^@+/, '').slice(0, 80);
}
