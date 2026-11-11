// /prospects/products — the catalog (Open Ronin packages, Music, Social, add-ons,
// Beacon v3, low ticket). Read view for everyone; editing lives in Admin →
// Prospects (manage_revenue).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadConfig } from '@/lib/revenue/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { BRAND_LABELS, PRODUCT_FAMILIES, PRODUCT_FAMILY_LABELS, productPriceLabel } from '@/lib/revenue/shared';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Products · Prospects' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadConfig(supabase), hasCapability('manage_revenue')]);
	if (config.notApplied) return <NotAppliedCard />;
	const active = config.products.filter((p) => p.is_active);

	return (
		<>
			<PageHeader
				title="Products"
				description={`${active.length} active products and prices`}
				actions={
					canManage ? (
						<Link href="/admin/prospects/catalog" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-hover dark:border-slate-600">
							Edit catalog
						</Link>
					) : undefined
				}
			/>
			<div className="space-y-6">
				{PRODUCT_FAMILIES.map((fam) => {
					const list = active.filter((p) => p.family === fam);
					if (!list.length) return null;
					return (
						<section key={fam}>
							<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{PRODUCT_FAMILY_LABELS[fam]}</h2>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{list.map((p) => (
									<Card key={p.id} className="space-y-1.5">
										<div className="flex items-start justify-between gap-2">
											<div className="text-sm font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
											<Badge color={p.brand === 'beacon' ? 'accent' : 'default'}>{BRAND_LABELS[p.brand]}</Badge>
										</div>
										<div className="text-sm font-mono tabular-nums text-slate-700 dark:text-slate-300">{productPriceLabel(p)}</div>
										<div className="text-2xs text-slate-500 capitalize">{p.kind.replace('_', ' ')}</div>
										{p.deliverables_md && <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-4">{p.deliverables_md}</p>}
									</Card>
								))}
							</div>
						</section>
					);
				})}
			</div>
		</>
	);
}
