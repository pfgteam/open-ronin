// Kling AI. Verified 2026-09-12 against kling.ai/document-api and
// app.klingai.com/global/dev: the Access Key plus Secret Key standard signs
// a short lived HS256 JWT (iss = access key, exp now plus 30 minutes, nbf
// now minus 5 seconds) sent as Authorization Bearer. POST
// /text-to-video/kling-3.0-turbo on api-singapore.klingai.com returns
// data.id; GET /tasks?task_ids= returns data[0].status submitted,
// processing, succeeded, failed and data[0].outputs[].url.

import { createHmac } from 'node:crypto';
import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'kling';
const BASE = 'https://api-singapore.klingai.com';
const DEFAULT_MODEL = 'kling-3.0-turbo';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Kling AI',
	category: 'video',
	capabilities: ['generate_video'],
	envKeys: ['KLING_ACCESS_KEY', 'KLING_SECRET_KEY'],
	docsUrl: 'https://app.klingai.com/global/dev/document-api/apiReference/commonInfo',
	costNote: 'Kling 3.0 Turbo 720p about 11 cents per second; a 5 second clip is about 56 cents. Prepaid resource packages.',
	async: true,
};

function b64url(input: Buffer | string): string {
	return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds the vendor JWT from the access and secret keys; never cached. */
export function klingToken(accessKey: string, secretKey: string, now = Math.floor(Date.now() / 1000)): string {
	const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const payload = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
	const sig = b64url(createHmac('sha256', secretKey).update(`${header}.${payload}`).digest());
	return `${header}.${payload}.${sig}`;
}

function auth() {
	return { authorization: `Bearer ${klingToken(requireEnv(ID, 'KLING_ACCESS_KEY'), requireEnv(ID, 'KLING_SECRET_KEY'))}` };
}

interface SubmitOut {
	code?: number;
	message?: string;
	data?: { id?: string };
}
interface TaskOut {
	code?: number;
	data?: { status?: string; outputs?: { type?: string; url?: string; duration?: number }[]; failure_reason?: string }[];
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_video' ? 0.112 * (input.durationSeconds ?? 5) : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_video') unsupported(ID, input.capability);
		const res = await callJson<SubmitOut>(ID, `${BASE}/text-to-video/${input.model ?? DEFAULT_MODEL}`, {
			headers: auth(),
			body: {
				prompt: input.prompt ?? input.script,
				settings: { duration: Math.min(15, Math.max(3, input.durationSeconds ?? 5)), resolution: '720p', aspect_ratio: input.aspect ?? '16:9' },
				options: { watermark_info: { enabled: false } },
			},
		});
		if (res.code !== 0 || !res.data?.id) throw new Error(`Kling refused: ${res.message ?? 'no task id'}`);
		return { providerRef: res.data.id };
	},
	async poll(providerRef: string) {
		const res = await callJson<TaskOut>(ID, `${BASE}/tasks?task_ids=${encodeURIComponent(providerRef)}`, { headers: auth() });
		const task = res.data?.[0];
		if (!task) return { status: 'running' };
		if (task.status === 'failed') return { status: 'failed', error: task.failure_reason ?? 'Kling task failed' };
		if (task.status !== 'succeeded') return { status: 'running' };
		const video = (task.outputs ?? []).find((o) => o.type === 'video' && o.url);
		if (!video?.url) return { status: 'failed', error: 'Kling succeeded without a video' };
		return { status: 'done', result: { assets: [{ url: video.url, mime: 'video/mp4', durationSeconds: video.duration }], providerMeta: { task: providerRef } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/tasks?task_ids=1`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
