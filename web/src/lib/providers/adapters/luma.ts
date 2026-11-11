// Luma Dream Machine. Verified 2026-09-12 against docs.lumalabs.ai: POST
// /dream-machine/v1/generations (Authorization Bearer, model ray-flash-2)
// returns a Generation with id and state queued, dreaming, completed,
// failed; assets.video is the URL. GET /dream-machine/v1/credits is free.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'luma';
const BASE = 'https://api.lumalabs.ai/dream-machine/v1';
const DEFAULT_MODEL = 'ray-flash-2';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Luma (Dream Machine)',
	category: 'video',
	capabilities: ['generate_video'],
	envKeys: ['LUMA_API_KEY'],
	docsUrl: 'https://docs.lumalabs.ai/docs/video-generation',
	costNote: 'About 15 to 30 cents for a 5 second 540p or 720p clip on ray-flash-2; prepaid credit balance.',
	async: true,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'LUMA_API_KEY')}` };
}

interface Generation {
	id: string;
	state?: string;
	failure_reason?: string;
	assets?: { video?: string };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_video' ? ((input.durationSeconds ?? 5) > 5 ? 0.6 : 0.3) : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_video') unsupported(ID, input.capability);
		const res = await callJson<Generation>(ID, `${BASE}/generations`, {
			headers: auth(),
			body: {
				prompt: input.prompt ?? input.script,
				model: input.model ?? DEFAULT_MODEL,
				resolution: '720p',
				duration: (input.durationSeconds ?? 5) > 5 ? '9s' : '5s',
				aspect_ratio: input.aspect ?? '16:9',
				...(input.imageUrl ? { keyframes: { frame0: { type: 'image', url: input.imageUrl } } } : {}),
			},
		});
		return { providerRef: res.id };
	},
	async poll(providerRef: string) {
		const res = await callJson<Generation>(ID, `${BASE}/generations/${encodeURIComponent(providerRef)}`, { headers: auth() });
		if (res.state === 'failed') return { status: 'failed', error: res.failure_reason ?? 'Luma generation failed' };
		if (res.state !== 'completed' || !res.assets?.video) return { status: 'running' };
		return { status: 'done', result: { assets: [{ url: res.assets.video, mime: 'video/mp4' }], providerMeta: { model: DEFAULT_MODEL } } };
	},
	async verify() {
		const res = await callJson<{ credit_balance?: number }>(ID, `${BASE}/credits`, { headers: auth() });
		return { ok: true, detail: `${res.credit_balance ?? 0} credit cents` };
	},
};
