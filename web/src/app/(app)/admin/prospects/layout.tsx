// Admin → Prospects shell (spec 2026-10-19-prospects-admin-design.md §3):
// header, the read-only notice for viewers without manage_revenue, and the
// in-page section menu. Each section is its own route and loads only its data.

import Link from 'next/link';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import SectionMenu from './_ui/SectionMenu';

export default async function AdminProspectsLayout({ children }: { children: React.ReactNode }) {
	const supabase = await createClient();
	const [canManage, dupes] = await Promise.all([
		hasCapability('manage_revenue'),
		supabase.from('rev_duplicate_candidates').select('id', { count: 'exact', head: true }).eq('status', 'open'),
	]);
	return (
		<>
			<PageHeader
				title="Prospects settings"
				description="Pipeline rules, catalog, scoring, integrations and the team. Each section saves on its own."
				actions={
					<Link href="/prospects" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-hover dark:border-slate-600">
						Open Pipeline ↗
					</Link>
				}
			/>
			{!canManage && (
				<Callout tone="warning" className="mb-4">
					Read only: editing needs the <strong>Configure the Revenue Engine</strong> capability (Admin → Capabilities).
				</Callout>
			)}
			<div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
				<SectionMenu duplicates={dupes.count ?? 0} />
				<div className="min-w-0 flex-1 space-y-4">{children}</div>
			</div>
		</>
	);
}
