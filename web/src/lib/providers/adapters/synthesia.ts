// Synthesia. Verified 2026-09-12 against docs.synthesia.io/reference/create-video:
// POST /v2/videos (Authorization: raw key, no Bearer) returns id; GET
// /v2/videos/{id} status in_progress, complete, error with a time limited
// download URL. test:true renders a free watermarked video. API access
// requires a Creator plan or above.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'synthesia';
const BASE = 'https://api.synthesia.io/v2';
const DEFAULT_AVATAR = 'anna_costume1_cameraA';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Synthesia',
	category: 'video',
	capabilities: ['lipsync_avatar'],
	envKeys: ['SYNTHESIA_API_KEY'],
	docsUrl: 'https://docs.synthesia.io/reference/create-video',
	costNote: 'API needs a Creator plan or above (about $89 per month); test mode renders are free and watermarked.',
	async: true,
};

function auth() {
	return { authorization: requireEnv(ID, 'SYNTHESIA_API_KEY') };
}

interface VideoOut {
	id?: string;
	status?: string;
	download?: string;
	duration?: number | string;
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'lipsync_avatar' ? (input.test ? 0 : 1.0) : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'lipsync_avatar') unsupported(ID, input.capability);
		const res = await callJson<VideoOut>(ID, `${BASE}/videos`, {
			headers: auth(),
			body: {
				test: input.test ?? false,
				title: 'Open Ronin content job',
				input: [{ scriptText: input.script, avatar: input.avatarId ?? DEFAULT_AVATAR, background: 'green_screen' }],
			},
		});
		if (!res.id) throw new Error('Synthesia returned no video id');
		return { providerRef: res.id };
	},
	async poll(providerRef: string) {
		const res = await callJson<VideoOut>(ID, `${BASE}/videos/${encodeURIComponent(providerRef)}`, { headers: auth() });
		if (res.status === 'error') return { status: 'failed', error: 'Synthesia render failed' };
		if (res.status !== 'complete' || !res.download) return { status: 'running' };
		return { status: 'done', result: { assets: [{ url: res.download, mime: 'video/mp4', durationSeconds: Number(res.duration) || undefined }], providerMeta: { video: providerRef } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/videos?limit=1`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
