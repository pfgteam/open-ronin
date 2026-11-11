// /prospects/proof/slots — where proof shows on the website and how each
// placement performs (0160). A slot has ONE item kind and ONE media type:
// video testimonials and written quotes never share a carousel.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadPickerItems, loadSlots } from '@/lib/proof/server';
import ProofNotAppliedCard from '../ProofNotAppliedCard';
import SlotsPanel from './SlotsPanel';

export const metadata = { title: 'Proof slots · Prospects' };
export const dynamic = 'force-dynamic';

export default async function ProofSlotsPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [slots, canManage] = await Promise.all([loadSlots(supabase), hasCapability('manage_revenue')]);
	if (slots.notApplied) return <ProofNotAppliedCard />;
	const picker = canManage ? await loadPickerItems(supabase) : [];
	const totals = slots.slots.reduce(
		(a, s) => {
			for (const p of s.placements) {
				a.impressions += Number(p.impressions);
				a.clicks += Number(p.clicks);
				a.conversions += Number(p.conversions);
			}
			return a;
		},
		{ impressions: 0, clicks: 0, conversions: 0 },
	);

	return (
		<>
			<PageHeader
				title="Proof slots & performance"
				description={`${slots.slots.length} slots · ${totals.impressions.toLocaleString()} impressions · ${totals.clicks.toLocaleString()} clicks · ${totals.conversions.toLocaleString()} conversions`}
				actions={
					<Link href="/prospects/proof" className="text-sm text-slate-500 hover:text-primary-600">
						← Proof Library
					</Link>
				}
			/>
			<SlotsPanel slots={slots.slots} picker={picker} canManage={canManage} />
		</>
	);
}
