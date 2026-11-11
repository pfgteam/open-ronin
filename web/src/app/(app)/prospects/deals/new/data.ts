// Quick add data (spec 2026-10-20 §7): what the form needs, loaded once for
// both doors — the /prospects/deals/new page and the Add prospect dialog
// (quickAddActions.ts). Server-only; RLS scopes every read to the viewer.

import { createClient } from '@/lib/supabase/server';
import { loadConfig, loadStaff } from '@/lib/revenue/server';
import { productPriceLabel } from '@/lib/revenue/shared';
import type { QuickAddPrefill } from './QuickAddForm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuickAddOpen {
	pipeline?: string | null;
	person?: string | null;
	brand?: string | null;
}

export interface QuickAddData {
	pipelines: { slug: string; name: string }[];
	defaultPipeline: string;
	staff: { id: string; name: string; email: string }[];
	products: { id: string; slug: string; name: string; price: string }[];
	prefill: QuickAddPrefill;
	/** Opened from an existing person or brand: the any-one-identifier rule applies. */
	prefilled: boolean;
	/** Who the pre-fill came from, for the "Pre-filled from …" note. */
	prefilledFrom: string | null;
	/** Where Cancel goes on the page door. */
	cancelHref: string;
}

type PrefillPerson = { id: string; display_name: string; email: string | null; phone: string | null; title: string | null; linkedin_url: string | null };
type PrefillBrand = { id: string; name: string; website: string | null; industry: string | null; vertical: string | null };

/** null when the Revenue Engine migrations are not applied yet. */
export async function loadQuickAddData(open: QuickAddOpen): Promise<QuickAddData | null> {
	const supabase = await createClient();
	const [config, staff] = await Promise.all([loadConfig(supabase), loadStaff(supabase)]);
	if (config.notApplied) return null;
	const pipelines = config.pipelines.filter((p) => p.is_active);
	const defaultPipeline = pipelines.find((p) => p.slug === open.pipeline)?.slug ?? pipelines[0]?.slug ?? '';
	const [personRes, brandRes] = await Promise.all([
		open.person && UUID.test(open.person) ? supabase.from('rev_people').select('id, display_name, email, phone, title, linkedin_url').eq('id', open.person).maybeSingle() : Promise.resolve({ data: null }),
		open.brand && UUID.test(open.brand) ? supabase.from('rev_brands').select('id, name, website, industry, vertical').eq('id', open.brand).maybeSingle() : Promise.resolve({ data: null }),
	]);
	const person = personRes.data as PrefillPerson | null;
	const brand = brandRes.data as PrefillBrand | null;
	return {
		pipelines: pipelines.map((p) => ({ slug: p.slug, name: p.name })),
		defaultPipeline,
		staff: staff.map((st) => ({ id: st.id, name: st.name, email: st.email })),
		products: config.products.filter((p) => p.is_active).map((p) => ({ id: p.id, slug: p.slug, name: p.name, price: productPriceLabel(p) })),
		prefill: {
			name: person?.display_name ?? null,
			email: person?.email ?? null,
			phone: person?.phone ?? null,
			title: person?.title ?? null,
			linkedin: person?.linkedin_url ?? null,
			brandName: brand?.name ?? null,
			brandWebsite: brand?.website ?? null,
			industry: brand?.industry ?? null,
			vertical: brand?.vertical ?? null,
		},
		prefilled: !!(person || brand),
		prefilledFrom: person?.display_name ?? brand?.name ?? null,
		cancelHref: person ? `/prospects/people/${person.id}` : brand ? `/prospects/brands/${brand.id}` : '/prospects',
	};
}
