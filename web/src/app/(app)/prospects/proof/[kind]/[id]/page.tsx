// /prospects/proof/[kind]/[id] — edit one case study / testimonial / asset
// (id = "new" creates). kind is case-studies | testimonials | assets.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadProofItem } from '@/lib/proof/server';
import { ITEM_KIND_LABELS, kindFromSegment } from '@/lib/proof/shared';
import ProofNotAppliedCard from '../../ProofNotAppliedCard';
import ProofItemForm from './ProofItemForm';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProofItemPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const { kind: segment, id } = await params;
	const kind = kindFromSegment(segment);
	if (!kind) notFound();
	const isNew = id === 'new';
	if (!isNew && !UUID.test(id)) notFound();
	const supabase = await createClient();
	const [item, canManage, clients] = await Promise.all([
		isNew ? null : loadProofItem(supabase, kind, id),
		hasCapability('manage_revenue'),
		supabase.from('clients_v2').select('id, display_name').order('display_name').limit(1000),
	]);
	if (item === 'not_applied') return <ProofNotAppliedCard />;
	if (!isNew && !item) notFound();
	const label = ITEM_KIND_LABELS[kind].toLowerCase();

	return (
		<>
			<PageHeader
				title={isNew ? `New ${label}` : item?.kind === 'case_study' ? item.row.client_name : item?.kind === 'asset' ? item.row.label : `Testimonial`}
				description={isNew ? undefined : `${ITEM_KIND_LABELS[kind]} · ${item?.row.status}`}
				actions={
					<Link href={`/prospects/proof?tab=${segment}`} className="text-sm text-slate-500 hover:text-primary-600">
						← Proof Library
					</Link>
				}
			/>
			<ProofItemForm
				kind={kind}
				id={isNew ? null : id}
				row={item ? (item.row as unknown as Record<string, unknown>) : null}
				canManage={canManage}
				clients={((clients.data ?? []) as { id: string; display_name: string }[]).map((c) => ({ id: c.id, name: c.display_name }))}
			/>
		</>
	);
}
