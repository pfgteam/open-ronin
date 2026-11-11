// /admin/prospects → its first section. Old ?tab= links (pipelines, products,
// dispositions, scoring, connectors, forms, ghl, team, rubrics, templates)
// land on the section that now holds that content (spec 2026-10-19 §3).
import { redirect } from 'next/navigation';
import { sectionForTab } from '@/lib/revenue/adminOptions';

export default async function AdminProspectsIndex({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
	const { tab } = await searchParams;
	redirect(`/admin/prospects/${sectionForTab(tab)}`);
}
