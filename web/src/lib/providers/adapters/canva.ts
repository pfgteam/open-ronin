// Canva Connect API. Verified 2026-09-12 against canva.dev/docs/connect:
// every resource call needs a USER access token from the Authorization Code
// plus PKCE flow; client id and secret alone cannot export a design. POST
// /rest/v1/exports returns job.id; GET /rest/v1/exports/{id} gives
// job.status in_progress, success, failed and job.urls[].
//
// This build registers the slot and verifies the app credentials through
// the token introspection endpoint (Basic auth with client id and secret).
// The per person OAuth connect flow lands with the Content Studio design
// page; until then submit refuses with a clear sentence.

import { allPresent, callJson, requireEnv } from '../http';
import { ProviderError, unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'canva';
const BASE = 'https://api.canva.com/rest/v1';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Canva (Connect API)',
	category: 'design',
	capabilities: ['design_export'],
	envKeys: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'],
	docsUrl: 'https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/',
	costNote: 'Free API; exports need a per person Canva OAuth connection (Authorization Code with PKCE), which lands with the Content Studio design page.',
	async: true,
};

function basic() {
	const id = requireEnv(ID, 'CANVA_CLIENT_ID');
	const secret = requireEnv(ID, 'CANVA_CLIENT_SECRET');
	return { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` };
}

interface ExportJob {
	job?: { id?: string; status?: string; urls?: string[]; error?: { message?: string } };
}

/** Runs an export with a user token supplied by the caller (future OAuth store). */
export async function exportDesign(userToken: string, designId: string, format: 'png' | 'jpg' | 'pdf' = 'png'): Promise<string> {
	const body = format === 'jpg' ? { type: 'jpg', quality: 90 } : { type: format };
	const res = await callJson<ExportJob>(ID, `${BASE}/exports`, { headers: { authorization: `Bearer ${userToken}` }, body: { design_id: designId, format: body } });
	if (!res.job?.id) throw new Error('Canva returned no export job id');
	return res.job.id;
}

export async function pollExport(userToken: string, jobId: string) {
	const res = await callJson<ExportJob>(ID, `${BASE}/exports/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${userToken}` } });
	return res.job;
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: () => 0,
	async submit(input: ContentJobInput) {
		if (input.capability !== 'design_export') unsupported(ID, input.capability);
		throw new ProviderError(ID, 'Canva exports need a connected Canva account. The connect flow ships with the Content Studio design page.');
	},
	async poll() {
		return { status: 'failed', error: 'Canva exports need a connected Canva account.' };
	},
	async verify() {
		// Introspecting a dummy token proves the client credentials are accepted
		// (Canva answers 200 with active false) without touching any design.
		const fd = new URLSearchParams({ token: 'not-a-real-token' });
		await callJson(ID, `${BASE}/oauth/introspect`, { headers: { ...basic(), 'content-type': 'application/x-www-form-urlencoded' }, body: fd.toString() });
		return { ok: true, detail: 'client credentials accepted' };
	},
};
