// Leonardo.Ai. Verified 2026-09-12 against docs.leonardo.ai: v2 POST
// /api/rest/v2/generations (Authorization Bearer, model flux-schnell) returns
// generationId; poll with v1 GET /api/rest/v1/generations/{id},
// generations_by_pk.status PENDING, COMPLETE, FAILED.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'leonardo';
const BASE = 'https://cloud.leonardo.ai/api/rest';
const DEFAULT_MODEL = 'flux-schnell';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Leonardo.Ai',
	category: 'image',
	capabilities: ['generate_image'],
	envKeys: ['LEONARDO_API_KEY'],
	docsUrl: 'https://docs.leonardo.ai/reference/creategeneration',
	costNote: 'API credits bought separately from the web plan; Flux Schnell is the cheapest model, a few cents per image.',
	async: true,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'LEONARDO_API_KEY')}` };
}

interface SubmitOut {
	generationId?: string;
	apiCreditCost?: number;
}
interface PollOut {
	generations_by_pk?: { status?: string; generated_images?: { url?: string }[]; imageWidth?: number; imageHeight?: number };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_image' ? 0.03 * (input.count ?? 1) : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_image') unsupported(ID, input.capability);
		const [w, h] = (input.size ?? '1024x1024').split('x').map(Number);
		const res = await callJson<SubmitOut>(ID, `${BASE}/v2/generations`, {
			headers: auth(),
			body: {
				model: input.model ?? DEFAULT_MODEL,
				parameters: { prompt: input.prompt, width: w || 1024, height: h || 1024, quantity: input.count ?? 1 },
				public: false,
			},
		});
		if (!res.generationId) throw new Error('Leonardo returned no generationId');
		return { providerRef: res.generationId };
	},
	async poll(providerRef: string) {
		const res = await callJson<PollOut>(ID, `${BASE}/v1/generations/${encodeURIComponent(providerRef)}`, { headers: auth() });
		const g = res.generations_by_pk;
		if (!g || g.status === 'PENDING') return { status: 'running' };
		if (g.status === 'FAILED') return { status: 'failed', error: 'Leonardo generation failed' };
		const assets = (g.generated_images ?? []).filter((i) => i.url).map((i) => ({ url: i.url, mime: 'image/jpeg', width: g.imageWidth, height: g.imageHeight }));
		return { status: 'done', result: { assets, providerMeta: { model: DEFAULT_MODEL } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/v2/models`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
