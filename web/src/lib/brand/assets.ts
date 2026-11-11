// Brand asset library vocabulary (0111, Tier B #7). No server imports: the
// client uploader, the server actions and the page all read from here.

import { PLATFORM_BRAND_ID } from './constants';

/** Private bucket (0111). Signed-in read via signed URLs, admin write. */
export const BRAND_ASSETS_BUCKET = 'brand-assets';
/** Path prefix the brand_assets.file_path CHECK requires (`brand/%`). */
export const BRAND_ASSETS_PREFIX = `brand/${PLATFORM_BRAND_ID}/`;

export const BRAND_ASSET_KINDS = [
	'logo', 'icon', 'font', 'color_palette', 'template', 'photo', 'illustration', 'document', 'other',
] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

export const BRAND_ASSET_KIND_LABELS: Record<BrandAssetKind, string> = {
	logo: 'Logo',
	icon: 'Icon',
	font: 'Font',
	color_palette: 'Color palette',
	template: 'Template',
	photo: 'Photo',
	illustration: 'Illustration',
	document: 'Document',
	other: 'Other',
};

export const BRAND_ASSET_MAX_BYTES = 25 * 1024 * 1024;

export interface BrandAssetRow {
	id: string;
	kind: string;
	title: string;
	file_path: string;
	mime_type: string | null;
	size_bytes: number | null;
	tags: string[];
	usage_notes_md: string | null;
	uploaded_by: string | null;
	archived_at: string | null;
	created_at: string;
}

/** `logo, dark, web` -> ['logo','dark','web'] (lowercased, deduped, max 12). */
export function parseTags(raw: string): string[] {
	const out: string[] = [];
	for (const t of raw.split(/[,\n]/)) {
		const v = t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
		if (v && !out.includes(v)) out.push(v);
		if (out.length >= 12) break;
	}
	return out;
}

/** Safe object name: keeps the extension, strips everything else. */
export function safeFileName(name: string): string {
	const dot = name.lastIndexOf('.');
	const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
	const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';
	return ext ? `${base}.${ext}` : base;
}

export function formatBytes(n: number | null): string | null {
	if (n === null || n === undefined) return null;
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
