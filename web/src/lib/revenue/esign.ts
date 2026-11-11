// E-sign behind a provider interface (0126, spec §9 + §15). Server-only.
//
// SignatureProvider is the contract: send a rendered document to a signer,
// learn its status, download the signed PDF, verify a webhook. Alex is
// choosing between DocuSeal, Documenso and OpenSign; DocuSeal is the default
// (decision 2026-10-01). Each adapter is configured by env vars and reports
// isConfigured() so the UI can say "no e-sign provider yet" and fall back to
// `manual` (mark signed by hand after a GHL / paper signature).
//
//   DocuSeal   DOCUSEAL_API_KEY (+ optional DOCUSEAL_BASE_URL for self-host,
//              default https://api.docuseal.com). Submissions API: create a
//              submission from an HTML/markdown document with one signer;
//              webhook events `form.completed` / `form.viewed` /
//              `form.declined`, verified with DOCUSEAL_WEBHOOK_SECRET.
//   Documenso  DOCUMENSO_API_KEY (+ DOCUMENSO_BASE_URL). Stub: adapter shape
//              in place, calls land when the key does.
//   OpenSign   OPENSIGN_API_KEY. Stub.
//   manual     always available: no network; status changes by hand.

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SendInput {
	contractId: string;
	title: string;
	bodyHtml: string;
	signer: { name: string; email: string };
	/** Where the provider should redirect / notify after completion (informational). */
	callbackUrl?: string;
}

export interface SendResult {
	providerRef: string;
	/** Link the signer receives (shown to staff for copy / resend). */
	signerUrl: string | null;
}

export type SignStatus = { status: 'sent' | 'viewed' | 'signed' | 'declined' | 'void'; signedAt?: string | null; pdfUrl?: string | null };

export interface WebhookEvent {
	providerRef: string;
	status: SignStatus['status'];
	signedAt?: string | null;
	pdfUrl?: string | null;
	raw: unknown;
}

export interface SignatureProvider {
	id: 'docuseal' | 'documenso' | 'opensign' | 'manual';
	label: string;
	envKeys: string[];
	note: string;
	isConfigured(): boolean;
	send(input: SendInput): Promise<SendResult>;
	status(providerRef: string): Promise<SignStatus>;
	/** Signed PDF bytes, when the provider exposes them. */
	download?(providerRef: string): Promise<{ bytes: Uint8Array; filename: string } | null>;
	/** Parse + verify a webhook request. Returns null when the signature fails. */
	parseWebhook?(request: Request, rawBody: string): WebhookEvent | null;
}

function env(name: string): string | undefined {
	const v = process.env[name];
	return v && v.trim() ? v.trim() : undefined;
}

// ---------------------------------------------------------------- DocuSeal

const docuseal: SignatureProvider = {
	id: 'docuseal',
	label: 'DocuSeal',
	envKeys: ['DOCUSEAL_API_KEY', 'DOCUSEAL_WEBHOOK_SECRET'],
	note: 'Open-source e-sign (cloud or self-hosted). Default per the 2026-10-01 decision. DOCUSEAL_BASE_URL optional for self-host.',
	isConfigured: () => !!env('DOCUSEAL_API_KEY'),
	async send(input) {
		const base = env('DOCUSEAL_BASE_URL') ?? 'https://api.docuseal.com';
		const key = env('DOCUSEAL_API_KEY');
		if (!key) throw new Error('DOCUSEAL_API_KEY is not set');
		// One-shot: create a template from HTML with a signature field, then a submission for the signer.
		const tplRes = await fetch(`${base}/templates/html`, {
			method: 'POST',
			headers: { 'x-auth-token': key, 'content-type': 'application/json' },
			body: JSON.stringify({ name: input.title, html: `${input.bodyHtml}<p style="margin-top:40px">Signature: <signature-field name="Signature" role="Signer" style="width:220px;height:60px"></signature-field></p><p>Date: <date-field name="Date" role="Signer"></date-field></p>` }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!tplRes.ok) throw new Error(`DocuSeal template ${tplRes.status}: ${(await tplRes.text()).slice(0, 300)}`);
		const tpl = (await tplRes.json()) as { id: number };
		const subRes = await fetch(`${base}/submissions`, {
			method: 'POST',
			headers: { 'x-auth-token': key, 'content-type': 'application/json' },
			body: JSON.stringify({ template_id: tpl.id, send_email: true, submitters: [{ role: 'Signer', name: input.signer.name, email: input.signer.email, external_id: input.contractId }] }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!subRes.ok) throw new Error(`DocuSeal submission ${subRes.status}: ${(await subRes.text()).slice(0, 300)}`);
		const subs = (await subRes.json()) as { id: number; submission_id?: number; slug?: string; embed_src?: string }[];
		const first = subs[0];
		const submissionId = first?.submission_id ?? first?.id;
		return { providerRef: String(submissionId), signerUrl: first?.embed_src ?? (first?.slug ? `https://docuseal.com/s/${first.slug}` : null) };
	},
	async status(ref) {
		const base = env('DOCUSEAL_BASE_URL') ?? 'https://api.docuseal.com';
		const res = await fetch(`${base}/submissions/${ref}`, { headers: { 'x-auth-token': env('DOCUSEAL_API_KEY') ?? '' }, signal: AbortSignal.timeout(20_000) });
		if (!res.ok) throw new Error(`DocuSeal status ${res.status}`);
		const s = (await res.json()) as { status?: string; completed_at?: string | null; submitters?: { status?: string; completed_at?: string | null; opened_at?: string | null }[]; documents?: { url?: string }[]; audit_log_url?: string };
		const sub = s.submitters?.[0];
		const st = s.status === 'completed' || sub?.status === 'completed' ? 'signed' : s.status === 'declined' || sub?.status === 'declined' ? 'declined' : s.status === 'expired' ? 'void' : sub?.opened_at ? 'viewed' : 'sent';
		return { status: st, signedAt: s.completed_at ?? sub?.completed_at ?? null, pdfUrl: s.documents?.[0]?.url ?? null };
	},
	async download(ref) {
		const st = await this.status(ref);
		if (!st.pdfUrl) return null;
		const res = await fetch(st.pdfUrl, { signal: AbortSignal.timeout(60_000) });
		if (!res.ok) return null;
		return { bytes: new Uint8Array(await res.arrayBuffer()), filename: `contract-${ref}.pdf` };
	},
	parseWebhook(request, rawBody) {
		const secret = env('DOCUSEAL_WEBHOOK_SECRET');
		if (secret) {
			// DocuSeal sends the secret as a header value you configure (key:value); accept either a shared-secret header or an HMAC of the body.
			const presented = request.headers.get('x-docuseal-signature') ?? request.headers.get('x-webhook-secret') ?? '';
			const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
			const ok = safeEq(presented, secret) || safeEq(presented, hmac);
			if (!ok) return null;
		}
		let body: { event_type?: string; data?: { submission_id?: number; id?: number; status?: string; completed_at?: string | null; documents?: { url?: string }[]; submission?: { id?: number } } };
		try {
			body = JSON.parse(rawBody);
		} catch {
			return null;
		}
		const ref = body.data?.submission_id ?? body.data?.submission?.id ?? body.data?.id;
		if (!ref) return null;
		const t = body.event_type ?? '';
		const status: SignStatus['status'] = t === 'form.completed' || t === 'submission.completed' ? 'signed' : t === 'form.declined' ? 'declined' : t === 'form.viewed' || t === 'form.started' ? 'viewed' : t === 'submission.expired' ? 'void' : 'sent';
		return { providerRef: String(ref), status, signedAt: body.data?.completed_at ?? null, pdfUrl: body.data?.documents?.[0]?.url ?? null, raw: body };
	},
};

function safeEq(a: string, b: string): boolean {
	const x = Buffer.from(a), y = Buffer.from(b);
	return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- stubs + manual

function stub(id: 'documenso' | 'opensign', label: string, envKey: string, note: string): SignatureProvider {
	return {
		id,
		label,
		envKeys: [envKey],
		note,
		isConfigured: () => !!env(envKey),
		async send() {
			throw new Error(`${label} adapter: calls land when ${envKey} is set and the API shape is confirmed.`);
		},
		async status() {
			throw new Error(`${label} adapter not implemented`);
		},
	};
}

const manual: SignatureProvider = {
	id: 'manual',
	label: 'Manual (mark signed by hand)',
	envKeys: [],
	note: 'No e-sign call. Send the PDF yourself (or keep using GHL contracts) and mark the contract signed here; the conversion still runs.',
	isConfigured: () => true,
	async send(input) {
		return { providerRef: `manual:${input.contractId}`, signerUrl: null };
	},
	async status() {
		return { status: 'sent' };
	},
};

export const SIGNATURE_PROVIDERS: readonly SignatureProvider[] = [docuseal, stub('documenso', 'Documenso', 'DOCUMENSO_API_KEY', 'Open-source DocuSign alternative; the spec\'s first pick. Stub until Alex decides.'), stub('opensign', 'OpenSign', 'OPENSIGN_API_KEY', 'Fallback option. Stub.'), manual];

/** The provider to use: the first configured real one (DocuSeal default), else manual. */
export function activeSignatureProvider(): SignatureProvider {
	return SIGNATURE_PROVIDERS.find((p) => p.id !== 'manual' && p.isConfigured()) ?? manual;
}

export function providerById(id: string): SignatureProvider | null {
	return SIGNATURE_PROVIDERS.find((p) => p.id === id) ?? null;
}
