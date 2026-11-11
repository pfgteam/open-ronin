// Black Forest Labs Flux. Verified 2026-09-12 against docs.bfl.ai:
// POST /v1/flux-2-klein-4b (x-key header) returns {id, polling_url};
// GET /v1/get_result?id= returns status and result.sample (signed URL).

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'bfl';
const BASE = 'https://api.bfl.ai/v1';
const DEFAULT_MODEL = 'flux-2-klein-4b';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Black Forest Labs (Flux)',
	category: 'image',
	capabilities: ['generate_image'],
	envKeys: ['BFL_API_KEY'],
	docsUrl: 'https://docs.bfl.ai/quick_start/generating_images',
	costNote: 'FLUX.2 klein 4B from about 1.4 cents per image; FLUX.2 pro from 3 cents. Prepaid credits.',
	async: true,
};

function auth() {
	return { 'x-key': requireEnv(ID, 'BFL_API_KEY') };
}

interface SubmitOut {
	id: string;
	polling_url?: string;
}
interface ResultOut {
	status: string;
	result?: { sample?: string };
}

const BAD = new Set(['Error', 'Request Moderated', 'Content Moderated', 'Task not found']);

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_image' ? 0.03 * (input.count ?? 1) : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_image') unsupported(ID, input.capability);
		const [w, h] = (input.size ?? '1024x1024').split('x').map(Number);
		const res = await callJson<SubmitOut>(ID, `${BASE}/${input.model ?? DEFAULT_MODEL}`, {
			headers: auth(),
			body: { prompt: input.prompt, width: w || 1024, height: h || 1024, output_format: 'jpeg' },
		});
		return { providerRef: res.id };
	},
	async poll(providerRef: string) {
		const res = await callJson<ResultOut>(ID, `${BASE}/get_result?id=${encodeURIComponent(providerRef)}`, { headers: auth() });
		if (res.status === 'Ready') {
			if (!res.result?.sample) return { status: 'failed', error: 'Flux finished without an image' };
			return { status: 'done', result: { assets: [{ url: res.result.sample, mime: 'image/jpeg' }], providerMeta: { model: DEFAULT_MODEL } } };
		}
		if (BAD.has(res.status)) return { status: 'failed', error: `Flux: ${res.status}` };
		return { status: 'running' };
	},
	async verify() {
		// No account endpoint; a lookup of a nonexistent task returns 200 on a valid key.
		const res = await callJson<ResultOut>(ID, `${BASE}/get_result?id=00000000-0000-0000-0000-000000000000`, { headers: auth() });
		return { ok: true, detail: `key accepted (${res.status})` };
	},
};
