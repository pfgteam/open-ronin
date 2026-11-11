// Ideogram 3.0. Verified 2026-09-12 against developer.ideogram.ai:
// multipart POST /v1/ideogram-v3/generate (Api-Key header), result in
// data[].url (ephemeral, download promptly). Edit: POST /v1/edit with a
// prompt and the source image. Prepaid credits; keys stay inactive until a
// payment method and balance exist.

import { allPresent, callJson, fetchBlob, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'ideogram';
const BASE = 'https://api.ideogram.ai/v1';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Ideogram',
	category: 'image',
	capabilities: ['generate_image', 'edit_image'],
	envKeys: ['IDEOGRAM_API_KEY'],
	docsUrl: 'https://developer.ideogram.ai/api-reference/generate-images/generate-v3',
	costNote: 'Prepaid credits, minimum $1 top up; TURBO renders are the cheapest tier, a few cents each.',
	async: false,
};

function auth() {
	return { 'Api-Key': requireEnv(ID, 'IDEOGRAM_API_KEY') };
}

interface GenOut {
	data: { url?: string; is_image_safe?: boolean; seed?: number; resolution?: string }[];
}

function toAssets(res: GenOut) {
	return res.data
		.filter((d) => d.url)
		.map((d) => {
			const [w, h] = (d.resolution ?? '').split('x').map(Number);
			return { url: d.url, mime: 'image/png', width: w || undefined, height: h || undefined };
		});
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		if (input.capability === 'generate_image') return 0.04 * (input.count ?? 1);
		if (input.capability === 'edit_image') return 0.05;
		return null;
	},
	async submit(input: ContentJobInput) {
		if (input.capability === 'generate_image') {
			const fd = new FormData();
			fd.set('prompt', input.prompt);
			fd.set('rendering_speed', 'TURBO');
			fd.set('num_images', String(input.count ?? 1));
			fd.set('resolution', input.size ?? '1024x1024');
			if (input.style) fd.set('style_type', input.style.toUpperCase());
			const res = await callJson<GenOut>(ID, `${BASE}/ideogram-v3/generate`, { headers: auth(), body: fd });
			return { result: { assets: toAssets(res), providerMeta: { seeds: res.data.map((d) => d.seed) } } };
		}
		if (input.capability === 'edit_image') {
			const fd = new FormData();
			fd.set('prompt', input.prompt);
			fd.set('num_images', '1');
			fd.set('images', await fetchBlob(ID, input.imagePath, 'image.png'));
			const res = await callJson<GenOut>(ID, `${BASE}/edit`, { headers: auth(), body: fd });
			return { result: { assets: toAssets(res), providerMeta: {} } };
		}
		return unsupported(ID, input.capability);
	},
	async verify() {
		// No free account endpoint is documented. A deliberately invalid body
		// returns 400 on a good key and 401 on a bad one; nothing is charged.
		try {
			await callJson(ID, `${BASE}/ideogram-v3/generate`, { headers: auth(), body: {} });
			return { ok: true, detail: 'key accepted' };
		} catch (e) {
			const status = (e as { status?: number }).status;
			if (status === 400 || status === 422) return { ok: true, detail: 'key accepted' };
			if (status === 402) return { ok: true, detail: 'key accepted, credits are empty' };
			return { ok: false, detail: e instanceof Error ? e.message : String(e) };
		}
	},
};
