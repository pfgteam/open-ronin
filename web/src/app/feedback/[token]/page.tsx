// /feedback/[token] — post-call / client feedback form (0127, spec §10).
// Signed-out, token = sha256 in rev_feedback. A 1-5 rating + a few
// questions; the answers land on the row (visible to the rep it concerns
// and summarised for the team).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';
import FeedbackForm from './FeedbackForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'How did we do? · Open Ronin' };

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	if (!/^[A-Za-z0-9_\-]{16,80}$/.test(token)) notFound();
	const db = createServiceRoleClient();
	const hash = createHash('sha256').update(token).digest('hex');
	const { data: f } = await db.from('rev_feedback').select('id, kind, submitted_at, subject_user_id').eq('token_hash', hash).maybeSingle();
	if (!f) notFound();
	const { data: who } = f.subject_user_id ? await db.from('profiles').select('first_name').eq('id', f.subject_user_id).maybeSingle() : { data: null };
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			<div className="max-w-xl mx-auto px-4 py-10">
				<div className="rounded-lg overflow-hidden border border-slate-200 bg-white shadow-panel">
					<div className="bg-primary-600 text-white px-6 py-5">
						<div className="text-2xs uppercase tracking-wider text-primary-100">Open Ronin</div>
						<h1 className="text-xl font-bold tracking-tight mt-1">{f.kind === 'call' ? `How was your call${who?.first_name ? ` with ${who.first_name}` : ''}?` : 'How are we doing?'}</h1>
						<p className="text-sm text-primary-50 mt-1">Two minutes. It goes straight to the team.</p>
					</div>
					<div className="p-6">{f.submitted_at ? <p className="text-sm text-slate-600 text-center py-6">Thank you — we already have your feedback.</p> : <FeedbackForm token={token} kind={f.kind} />}</div>
				</div>
			</div>
		</main>
	);
}
