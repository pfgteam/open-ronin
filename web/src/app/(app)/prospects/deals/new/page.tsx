// /prospects/deals/new — quick add (spec 2026-10-20 §7). One form, one call to rev_intake():
// dedupe (LinkedIn → phone → email → brand) happens in the database, so a
// person who already exists is attached, not duplicated, and an open deal
// for the same brand + motion is reused.
//
// Most people reach the form through the Add prospect dialog
// (AddProspectButton). This page stays for direct links: the Home quick
// action, a bookmarked URL, and the error redirect of addProspectAndOpen.

import { redirect } from 'next/navigation';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import { getAuthProfile } from '@/lib/supabase/server';
import QuickAddForm from './QuickAddForm';
import { loadQuickAddData } from './data';
import NotAppliedCard from '../../NotAppliedCard';

export const metadata = { title: 'Add prospect' };
export const dynamic = 'force-dynamic';

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ pipeline?: string; error?: string; person?: string; brand?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const data = await loadQuickAddData({ pipeline: sp.pipeline, person: sp.person, brand: sp.brand });
	if (!data) return <NotAppliedCard />;

	return (
		<div className="mx-auto max-w-2xl">
			<PageHeader title="Add prospect" description="If this person already exists (LinkedIn, phone or email) the deal attaches to them." />
			{data.prefilledFrom && (
				<Callout tone="info" className="mb-4">
					Pre-filled from {data.prefilledFrom}. The deal attaches to the existing record.
				</Callout>
			)}
			<QuickAddForm {...data} meId={profile.id} meEmail={profile.email ?? ''} />
		</div>
	);
}
