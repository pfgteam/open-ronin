// /refer/[code] — the public "send us a lead" form (0127, spec §10). The
// referrer shares this link; a submission becomes a scored deal through
// rev_intake_scored with the referral attached (attribution + commission
// milestones). Signed-out; the code is the credential.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import ReferForm from './ReferForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Refer a brand · Open Ronin' };

export default async function ReferPage({ params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) notFound();
	const db = createServiceRoleClient();
	const { data } = await db.from('rev_referral_codes').select('code, referrer_name, kind, is_active').eq('code', code).maybeSingle();
	if (!data?.is_active) notFound();
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			<div className="max-w-xl mx-auto px-4 py-10">
				<div className="rounded-lg overflow-hidden border border-slate-200 bg-white shadow-panel">
					<div className="bg-primary-600 text-white px-6 py-5">
						<div className="text-2xs uppercase tracking-wider text-primary-100">Open Ronin · Referral</div>
						<h1 className="text-xl font-bold tracking-tight mt-1">Know a brand that should be in the news?</h1>
						<p className="text-sm text-primary-50 mt-1">{data.referrer_name ? `${data.referrer_name} sent you here. ` : ''}Tell us about them and we&apos;ll reach out.</p>
					</div>
					<div className="p-6">
						<ReferForm code={code} />
					</div>
				</div>
				<p className="text-2xs text-slate-500 text-center mt-4">
					By submitting you agree to our <a href="/privacy" className="underline">privacy policy</a>.
				</p>
			</div>
		</main>
	);
}
