'use server';

// Server actions for the brand asset library (/admin/brand, 0111 Tier B #7).
// Same shape as ./actions.ts: bytes go browser -> private `brand-assets`
// bucket under the admin's own session (0111's insert policy passes
// is_admin()); only the PATH lands here. RLS on brand_assets is admin-write.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { PLATFORM_BRAND_ID } from '@/lib/brand/constants';
import { BRAND_ASSETS_BUCKET, BRAND_ASSETS_PREFIX, BRAND_ASSET_KINDS, parseTags } from '@/lib/brand/assets';

const PATH = '/admin/brand';

export type AssetActionResult = { ok: true; id?: string; url?: string } | { ok: false; error: string };

async function requireAdmin(): Promise<{ actorId: string } | { error: string }> {
	const viewer = await getAuthProfile();
	if (!viewer) return { error: 'You are signed out. Sign in again and retry.' };
	if (!viewer.is_active || !['admin', 'exec'].includes(viewer.role)) {
		return { error: 'Only exec and admin accounts can change the brand library.' };
	}
	return { actorId: viewer.id };
}

const pathSchema = z
	.string()
	.regex(/^brand\/[0-9a-f-]{36}\/[A-Za-z0-9._/-]+$/, 'That file is not in the brand storage folder.')
	.refine((p) => p.startsWith(BRAND_ASSETS_PREFIX) && !p.includes('..'), 'That file is not in the brand storage folder.');

const createSchema = z.object({
	kind: z.enum(BRAND_ASSET_KINDS),
	title: z.string().trim().min(1, 'Title is required.').max(200),
	filePath: pathSchema,
	mimeType: z.string().max(120).nullable(),
	sizeBytes: z.number().int().min(0).nullable(),
	tags: z.string().max(600),
	usageNotes: z.string().max(4000),
});

/** Record an uploaded asset. The upload itself happened browser side. */
export async function createBrandAsset(input: {
	kind: string;
	title: string;
	filePath: string;
	mimeType: string | null;
	sizeBytes: number | null;
	tags: string;
	usageNotes: string;
}): Promise<AssetActionResult> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };
	const parsed = createSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid asset.' };
	const v = parsed.data;

	const supabase = await createClient();
	const { data, error } = await supabase
		.from('brand_assets')
		.insert({
			brand_id: PLATFORM_BRAND_ID,
			kind: v.kind,
			title: v.title,
			file_path: v.filePath,
			mime_type: v.mimeType,
			size_bytes: v.sizeBytes,
			tags: parseTags(v.tags),
			usage_notes_md: v.usageNotes.trim() || null,
			uploaded_by: gate.actorId,
		})
		.select('id')
		.single();
	if (error) {
		return {
			ok: false,
			error: error.code === '42P01' ? 'The asset library needs migration 0111_tier_b_bundle.sql applied first.' : `Could not save: ${error.message}`,
		};
	}
	await recordAudit({
		actor_id: gate.actorId,
		entity_kind: 'supabase',
		entity_ref: `brand_assets/${data.id}`,
		action: 'brand.asset.create',
		diff: { kind: v.kind, title: v.title, file_path: v.filePath },
	});
	revalidatePath(PATH);
	return { ok: true, id: data.id };
}

const updateSchema = z.object({
	id: z.string().uuid(),
	title: z.string().trim().min(1).max(200),
	kind: z.enum(BRAND_ASSET_KINDS),
	tags: z.string().max(600),
	usageNotes: z.string().max(4000),
});

export async function updateBrandAsset(input: { id: string; title: string; kind: string; tags: string; usageNotes: string }): Promise<AssetActionResult> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };
	const parsed = updateSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid asset.' };
	const v = parsed.data;
	const supabase = await createClient();
	const patch = { title: v.title, kind: v.kind, tags: parseTags(v.tags), usage_notes_md: v.usageNotes.trim() || null };
	const { data, error } = await supabase.from('brand_assets').update(patch).eq('id', v.id).select('id');
	if (error) return { ok: false, error: `Could not save: ${error.message}` };
	if (!data || data.length === 0) return { ok: false, error: 'Nothing was saved (missing row or no permission).' };
	await recordAudit({ actor_id: gate.actorId, entity_kind: 'supabase', entity_ref: `brand_assets/${v.id}`, action: 'brand.asset.update', diff: patch });
	revalidatePath(PATH);
	return { ok: true, id: v.id };
}

/** Archive (soft delete) and remove the object. */
export async function archiveBrandAsset(id: string): Promise<AssetActionResult> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };
	if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Invalid asset.' };
	const supabase = await createClient();
	const { data: row } = await supabase.from('brand_assets').select('file_path').eq('id', id).maybeSingle<{ file_path: string }>();
	const { data, error } = await supabase.from('brand_assets').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id');
	if (error) return { ok: false, error: `Could not archive: ${error.message}` };
	if (!data || data.length === 0) return { ok: false, error: 'Nothing was archived (missing row or no permission).' };
	if (row?.file_path) await supabase.storage.from(BRAND_ASSETS_BUCKET).remove([row.file_path]);
	await recordAudit({ actor_id: gate.actorId, entity_kind: 'supabase', entity_ref: `brand_assets/${id}`, action: 'brand.asset.archive', diff: { file_path: row?.file_path ?? null } });
	revalidatePath(PATH);
	return { ok: true, id };
}

/** Short-lived download link for a private asset (signed-in read). */
export async function signBrandAssetUrl(id: string): Promise<AssetActionResult> {
	const viewer = await getAuthProfile();
	if (!viewer) return { ok: false, error: 'Sign in to download brand assets.' };
	if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Invalid asset.' };
	const supabase = await createClient();
	const { data: row } = await supabase.from('brand_assets').select('file_path').eq('id', id).maybeSingle<{ file_path: string }>();
	if (!row) return { ok: false, error: 'Asset not found.' };
	const { data, error } = await supabase.storage.from(BRAND_ASSETS_BUCKET).createSignedUrl(row.file_path, 600);
	if (error || !data) return { ok: false, error: `Could not sign: ${error?.message ?? 'unknown'}` };
	return { ok: true, id, url: data.signedUrl };
}
