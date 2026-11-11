// Stability AI v2beta. Verified 2026-09-12 against
// platform.stability.ai/docs/api-reference: multipart POST
// /v2beta/stable-image/generate/core and /edit/inpaint, Authorization Bearer,
// accept application/json returns {image: base64}. GET /v1/user/balance is
// the free key check.

import { allPresent, callJson, fetchBlob, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'stability';
const BASE = 'https://api.stability.ai';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Stability AI',
	category: 'image',
	capabilities: ['generate_image', 'edit_image'],
	envKeys: ['STABILITY_API_KEY'],
	docsUrl: 'https://platform.stability.ai/docs/api-reference',
	costNote: 'Stable Image Core 3 cents per image, inpaint 5 cents; prepaid credits at a cent each.',
	async: false,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'STABILITY_API_KEY')}`, accept: 'application/json' };
}

interface ImageOut {
	image: string;
	finish_reason: string;
	seed?: number;
}

function aspectOf(size: string | undefined): string {
	if (!size) return '1:1';
	const [w, h] = size.split('x').map(Number);
	if (!w || !h) return '1:1';
	if (w > h) return '16:9';
	if (h > w) return '9:16';
	return '1:1';
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		if (input.capability === 'generate_image') return 0.03 * (input.count ?? 1);
		if (input.capability === 'edit_image') return 0.05;
		return null;
	},
	async submit(input: ContentJobInput) {
		if (input.capability === 'generate_image') {
			const count = input.count ?? 1;
			const assets = [];
			const seeds: number[] = [];
			for (let i = 0; i < count; i++) {
				const fd = new FormData();
				fd.set('prompt', input.prompt);
				fd.set('output_format', 'jpeg');
				fd.set('aspect_ratio', aspectOf(input.size));
				if (input.style) fd.set('style_preset', input.style);
				const res = await callJson<ImageOut>(ID, `${BASE}/v2beta/stable-image/generate/core`, { headers: auth(), body: fd });
				if (res.finish_reason !== 'SUCCESS') throw new Error(`Stability finished with ${res.finish_reason}`);
				assets.push({ base64: res.image, mime: 'image/jpeg' });
				if (res.seed !== undefined) seeds.push(res.seed);
			}
			return { result: { assets, providerMeta: { model: 'core', seeds } } };
		}
		if (input.capability === 'edit_image') {
			const fd = new FormData();
			fd.set('prompt', input.prompt);
			fd.set('output_format', 'jpeg');
			fd.set('image', await fetchBlob(ID, input.imagePath, 'image.png'));
			if (input.maskPath) fd.set('mask', await fetchBlob(ID, input.maskPath, 'mask.png'));
			const res = await callJson<ImageOut>(ID, `${BASE}/v2beta/stable-image/edit/inpaint`, { headers: auth(), body: fd });
			if (res.finish_reason !== 'SUCCESS') throw new Error(`Stability finished with ${res.finish_reason}`);
			return { result: { assets: [{ base64: res.image, mime: 'image/jpeg' }], providerMeta: { model: 'inpaint', seed: res.seed } } };
		}
		return unsupported(ID, input.capability);
	},
	async verify() {
		const res = await callJson<{ credits?: number }>(ID, `${BASE}/v1/user/balance`, { headers: auth() });
		return { ok: true, detail: `${res.credits ?? 0} credits` };
	},
};
