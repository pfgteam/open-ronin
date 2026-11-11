// /portal/contract/[token] — the client's view of a signed contract (0126,
// spec §9 "Signed contracts show in the client portal"). Signed-out, token
// in the URL (sha256 stored in rev_portal_tokens, 1-year expiry). The real
// per-client portal (Clients → Portals) replaces this; until then this is
// the only client-facing surface for contracts.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { markdownToHtml, money } from '@/lib/revenue/contracts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your agreement · Open Ronin' };

export default async function PortalContractPage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;
	if (!/^[A-Za-z0-9_\-]{20,80}$/.test(token)) notFound();
	const db = createServiceRoleClient();
	const hash = createHash('sha256').update(token).digest('hex');
	const { data: t } = await db.from('rev_portal_tokens').select('client_id, contract_id, expires_at').eq('token_hash', hash).maybeSingle();
	if (!t || (t.expires_at && new Date(t.expires_at) < new Date())) notFound();
	const [{ data: c }, { data: client }] = await Promise.all([
		t.contract_id ? db.from('rev_contracts').select('title, body_md, status, signed_at, starts_on, term_months, mrr_cents, one_time_cents, signer_name, signed_pdf_path').eq('id', t.contract_id).maybeSingle() : Promise.resolve({ data: null }),
		db.from('clients_v2').select('display_name').eq('id', t.client_id).maybeSingle(),
	]);
	if (!c || c.status !== 'signed') notFound();
	await db.from('rev_portal_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', hash);
	let pdf: string | null = null;
	if (c.signed_pdf_path) {
		const s = await db.storage.from('revenue-documents').createSignedUrl(c.signed_pdf_path, 3600);
		pdf = s.data?.signedUrl ?? null;
	}
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			<div className="max-w-2xl mx-auto px-4 py-10">
				<div className="rounded-lg overflow-hidden border border-slate-200 bg-white shadow-panel">
					<div className="bg-primary-600 text-white px-6 py-5">
						<div className="text-2xs uppercase tracking-wider text-primary-100">Open Ronin · {client?.display_name ?? 'Client'}</div>
						<h1 className="text-xl font-bold tracking-tight mt-1">{c.title}</h1>
						<p className="text-sm text-primary-50 mt-1">
							Signed {c.signed_at ? new Date(c.signed_at).toLocaleDateString() : ''} by {c.signer_name ?? 'you'} · {money(c.mrr_cents)}/month{c.one_time_cents ? ` + ${money(c.one_time_cents)} one-time` : ''}
							{c.term_months ? ` · ${c.term_months}-month term` : ''}
						</p>
					</div>
					<div className="p-6 space-y-4">
						{pdf && (
							<a href={pdf} className="inline-flex items-center justify-center rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800">
								Download signed PDF
							</a>
						)}
						{c.body_md ? <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(c.body_md) }} /> : <p className="text-sm text-slate-600">The signed document is on file with Open Ronin.</p>}
					</div>
				</div>
				<p className="text-2xs text-slate-500 text-center mt-4">Questions? Reply to your publicist or email hello@example.com.</p>
			</div>
		</main>
	);
}
