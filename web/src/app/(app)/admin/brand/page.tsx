// /admin/brand: the platform brand that generated content reads, plus the
// brand asset library (0111, Tier B #7).
//
// Logo (light and dark), primary and accent colors as tokens, typography from
// the allowed set, email footer, social handles, and a preview. Stored on the
// single is_platform row of `brands` (0076). Admin only: the /admin ModuleGate
// plus requireAdmin in actions, with brands_update_admin as the RLS guard.
//
// The asset library is `brand_assets` rows over the private `brand-assets`
// bucket: kind, path, tags, usage notes. Signed-in read, admin write.
//
// The app chrome does not read this. Its colors are Tailwind tokens by design
// (UI_GUIDELINES.md); this brand is for Content Studio (Module 2), email and
// generated documents, all of which read it through lib/brand/getBrand().

import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { brandFromRow, BRAND_COLUMNS, type BrandRow } from '@/lib/brand/getBrand';
import type { BrandAssetRow } from '@/lib/brand/assets';
import BrandForm from './BrandForm';
import BrandAssetLibrary from './BrandAssetLibrary';

export const metadata = { title: 'Brand' };
export const dynamic = 'force-dynamic';

export default async function BrandPage() {
	const supabase = await createClient();
	const viewer = await getAuthProfile();
	const [{ data, error }, assetsRes] = await Promise.all([
		supabase.from('brands').select(BRAND_COLUMNS).eq('is_platform', true).maybeSingle(),
		supabase
			.from('brand_assets')
			.select('id, kind, title, file_path, mime_type, size_bytes, tags, usage_notes_md, uploaded_by, archived_at, created_at')
			.is('archived_at', null)
			.order('kind')
			.order('created_at', { ascending: false })
			.limit(500),
	]);

	// A missing is_platform column (0076 not applied) is an error, not an
	// empty result; the form then shows the defaults and disables Save.
	const applied = !error && !!data;
	const brand = brandFromRow((data as BrandRow | null) ?? null);
	const assetsApplied = !assetsRes.error;
	const assets = (assetsRes.data ?? []) as BrandAssetRow[];
	const canEdit = !!viewer && viewer.is_active && ['admin', 'exec'].includes(viewer.role);

	return (
		<>
			<PageHeader
				title="Brand"
				description="Logo, colors, typography, email footer and handles that generated content and email read. The app's own chrome keeps its design tokens."
			/>
			<div className="space-y-6">
				<BrandForm brand={brand} applied={applied} />
				<BrandAssetLibrary assets={assets} applied={assetsApplied} canEdit={canEdit} />
			</div>
		</>
	);
}
