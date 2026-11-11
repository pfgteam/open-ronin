// Recraft. Verified 2026-09-12 against recraft.ai/docs/api-reference:
// POST /v1/images/generations (OpenAI images shape, Authorization Bearer),
// synchronous, data[].url. Models ending in _vector return SVG.
// GET /v1/users/me is the free key check.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'recraft';
const BASE = 'https://external.api.recraft.ai/v1';
const RASTER_MODEL = 'recraftv2';
const VECTOR_MODEL = 'recraftv2_vector';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Recraft (raster and vector)',
	category: 'image',
	capabilities: ['generate_image'],
	envKeys: ['RECRAFT_API_KEY'],
	docsUrl: 'https://www.recraft.ai/docs/api-reference/endpoints',
	costNote: 'Recraft V2 raster about 2 cents per image, vector about 4 cents; prepaid API units.',
	async: false,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'RECRAFT_API_KEY')}` };
}

interface GenOut {
	data: { url?: string }[];
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_image' ? 0.04 * (input.count ?? 1) : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_image') unsupported(ID, input.capability);
		// style 'vector' picks the SVG model; anything else is raster.
		const vector = input.style === 'vector' || input.model?.endsWith('_vector');
		const model = input.model ?? (vector ? VECTOR_MODEL : RASTER_MODEL);
		const style = vector ? 'vector_illustration' : (input.style ?? 'realistic_image');
		const res = await callJson<GenOut>(ID, `${BASE}/images/generations`, {
			headers: auth(),
			body: { prompt: input.prompt, model, style, size: input.size ?? '1024x1024', n: input.count ?? 1, response_format: 'url' },
		});
		return {
			result: {
				assets: res.data.filter((d) => d.url).map((d) => ({ url: d.url, mime: vector ? 'image/svg+xml' : 'image/png' })),
				providerMeta: { model, style },
			},
		};
	},
	async verify() {
		const res = await callJson<{ credits?: number }>(ID, `${BASE}/users/me`, { headers: auth() });
		return { ok: true, detail: `${res.credits ?? 0} API units` };
	},
};
