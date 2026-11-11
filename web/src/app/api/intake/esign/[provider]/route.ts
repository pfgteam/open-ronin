// POST /api/intake/esign/[provider] — e-sign provider webhooks (0126).
// DocuSeal posts form.viewed / form.completed / form.declined; the adapter
// verifies DOCUSEAL_WEBHOOK_SECRET and maps to our status. Signed flips the
// contract (trigger: deal won, conversion to client). Public route, defends
// itself per provider.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { providerById } from '@/lib/revenue/esign';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
	const { provider } = await ctx.params;
	const p = providerById(provider);
	if (!p || !p.parseWebhook) return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
	if (!p.isConfigured()) return NextResponse.json({ error: `${p.label} is not configured.` }, { status: 401 });
	const raw = await request.text();
	const ev = p.parseWebhook(request, raw);
	if (!ev) return NextResponse.json({ error: 'Bad signature or payload.' }, { status: 401 });
	const db = createServiceRoleClient();
	const { data: c } = await db.from('rev_contracts').select('id, status, deal_id').eq('provider', p.id).eq('provider_ref', ev.providerRef).maybeSingle();
	if (!c) {
		// Hiring (0133): offer letters + NDAs ride the same provider; look there before giving up.
		const { data: h } = await db.from('hire_documents').select('id, status').eq('provider', p.id).eq('provider_ref', ev.providerRef).maybeSingle();
		if (!h) return NextResponse.json({ ok: true, ignored: 'no contract for this reference' });
		if (h.status === 'signed' || h.status === 'void') return NextResponse.json({ ok: true, ignored: `already ${h.status}` });
		const hp: Record<string, unknown> = { status: ev.status };
		if (ev.status === 'viewed') hp.viewed_at = new Date().toISOString();
		if (ev.status === 'declined') hp.declined_at = new Date().toISOString();
		if (ev.status === 'signed') {
			hp.signed_at = ev.signedAt ?? new Date().toISOString();
			if (p.download) {
				try {
					const file = await p.download(ev.providerRef);
					if (file) {
						const path = `documents/${h.id}/${file.filename}`;
						const up = await db.storage.from('hiring-uploads').upload(path, file.bytes, { contentType: 'application/pdf', upsert: true });
						if (!up.error) hp.signed_pdf_path = path;
					}
				} catch {
					/* status still flips */
				}
			}
		}
		const { error } = await db.from('hire_documents').update(hp).eq('id', h.id);
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		return NextResponse.json({ ok: true, status: ev.status, hire_document_id: h.id });
	}
	if (c.status === 'signed' || c.status === 'void') return NextResponse.json({ ok: true, ignored: `already ${c.status}` });
	const patch: Record<string, unknown> = { status: ev.status };
	if (ev.status === 'viewed') patch.viewed_at = new Date().toISOString();
	if (ev.status === 'signed') {
		patch.signed_at = ev.signedAt ?? new Date().toISOString();
		// store the signed PDF in the bucket when the provider exposes it
		if (p.download) {
			try {
				const file = await p.download(ev.providerRef);
				if (file) {
					const path = `contracts/${c.id}/${file.filename}`;
					const up = await db.storage.from('revenue-documents').upload(path, file.bytes, { contentType: 'application/pdf', upsert: true });
					if (!up.error) patch.signed_pdf_path = path;
				}
			} catch {
				/* the status still flips; the PDF can be fetched later from the provider */
			}
		}
	}
	if (ev.status === 'declined') patch.declined_at = new Date().toISOString();
	const { error } = await db.from('rev_contracts').update(patch).eq('id', c.id);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true, status: ev.status, deal_id: c.deal_id });
}
