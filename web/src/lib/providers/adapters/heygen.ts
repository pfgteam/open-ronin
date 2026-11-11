// HeyGen v3. Verified 2026-09-12 against developers.heygen.com: POST
// /v3/videos with type avatar (X-Api-Key) returns data.video_id; GET
// /v3/videos/{id} gives data.status pending, processing, completed, failed
// and a presigned data.video_url. Prompt to video runs through
// /v3/video-agents with a two stage poll. GET /v3/users/me verifies a key.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'heygen';
const BASE = 'https://api.heygen.com/v3';

export const spec: ProviderSpec = {
	id: ID,
	label: 'HeyGen (avatar video)',
	category: 'video',
	capabilities: ['lipsync_avatar', 'generate_video'],
	envKeys: ['HEYGEN_API_KEY'],
	docsUrl: 'https://developers.heygen.com/reference/create-video',
	costNote: 'Billed per rendered minute on API credits; pricing is in the HeyGen API dashboard, not the docs. Pick an avatar look and voice id from the dashboard.',
	async: true,
};

function auth() {
	return { 'X-Api-Key': requireEnv(ID, 'HEYGEN_API_KEY') };
}

interface VideoOut {
	data?: { video_id?: string; status?: string; video_url?: string; failure_message?: string; duration?: number };
}
interface AgentOut {
	data?: { session_id?: string; video_id?: string | null };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		if (input.capability === 'lipsync_avatar') return Math.max(0.5, (input.script.length / 900) * 1.0);
		if (input.capability === 'generate_video') return 1.0;
		return null;
	},
	async submit(input: ContentJobInput) {
		if (input.capability === 'lipsync_avatar') {
			if (!input.avatarId || !input.voiceId) throw new Error('HeyGen needs avatarId and voiceId (from GET /v3/avatars/looks and /v3/voices).');
			const res = await callJson<VideoOut>(ID, `${BASE}/videos`, {
				headers: auth(),
				body: { type: 'avatar', avatar_id: input.avatarId, voice_id: input.voiceId, script: input.script, resolution: '720p', aspect_ratio: input.aspect ?? '16:9' },
			});
			if (!res.data?.video_id) throw new Error('HeyGen returned no video_id');
			return { providerRef: `video:${res.data.video_id}` };
		}
		if (input.capability === 'generate_video') {
			const res = await callJson<AgentOut>(ID, `${BASE}/video-agents`, { headers: auth(), body: { prompt: input.prompt ?? input.script } });
			if (!res.data?.session_id) throw new Error('HeyGen returned no session_id');
			return { providerRef: `agent:${res.data.session_id}` };
		}
		return unsupported(ID, input.capability);
	},
	async poll(providerRef: string) {
		const [kind, id] = providerRef.split(':');
		let videoId = id;
		if (kind === 'agent') {
			const s = await callJson<AgentOut>(ID, `${BASE}/video-agents/${encodeURIComponent(id)}`, { headers: auth() });
			if (!s.data?.video_id) return { status: 'running' };
			videoId = s.data.video_id;
		}
		const res = await callJson<VideoOut>(ID, `${BASE}/videos/${encodeURIComponent(videoId)}`, { headers: auth() });
		const status = res.data?.status;
		if (status === 'failed') return { status: 'failed', error: res.data?.failure_message ?? 'HeyGen render failed' };
		if (status !== 'completed' || !res.data?.video_url) return { status: 'running' };
		return {
			status: 'done',
			result: { assets: [{ url: res.data.video_url, mime: 'video/mp4', durationSeconds: res.data.duration }], providerMeta: { video_id: videoId } },
		};
	},
	async verify() {
		await callJson(ID, `${BASE}/users/me`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
