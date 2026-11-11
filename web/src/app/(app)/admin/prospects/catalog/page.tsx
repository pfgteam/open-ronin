// Admin → Prospects → Catalog (spec 2026-10-19 §6): the product catalog.
// Contract templates are not shown while contracts are signed in GHL
// (decision 2026-10-08); their data and TemplatesTab stay for P6 e-sign.

import { hasCapability } from '@/lib/permissions/capabilities';
import { createClient } from '@/lib/supabase/server';
import { loadConfig } from '@/lib/revenue/server';
import NotAppliedCard from '@/app/(app)/prospects/NotAppliedCard';
import CatalogSection from './CatalogSection';

export const metadata = { title: 'Catalog · Prospects settings' };
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadConfig(supabase), hasCapability('manage_revenue')]);
	if (config.notApplied) return <NotAppliedCard />;
	return <CatalogSection products={config.products} canManage={canManage} />;
}
