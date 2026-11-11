// Runway. Verified 2026-09-12 against docs.dev.runwayml.com: POST
// /v1/text_to_video (gen4.5) or /v1/image_to_video (gen4_turbo), headers
// Authorization Bearer and X-Runway-Version 2024-11-06; GET /v1/tasks/{id}
// status PENDING, THROTTLED, RUNNING, SUCCEEDED, FAILED, CANCELLED with
// output[0] the video URL. GET /v1/organization is the free key check.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'runway';
const BASE = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Runway',
	category: 'video',
	capabilities: ['generate_video'],
	envKeys: ['RUNWAY_API_KEY'],
	docsUrl: 'https://docs.dev.runwayml.com/api',
	costNote: 'gen4_turbo image to video 5 cents per second; gen4.5 text to video 12 cents per second. Credits per organization.',
	async: true,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'RUNWAY_API_KEY')}`, 'X-Runway-Version': VERSION };
}

interface TaskOut {
	id: string;
	status?: string;
	output?: string[];
	failure?: string;
}

function ratio(aspect: string | undefined): string {
	if (aspect === '9:16') return '720:1280';
	if (aspect === '1:1') return '960:960';
	return '1280:720';
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		if (input.capability !== 'generate_video') return null;
		const seconds = input.durationSeconds ?? 5;
		return input.imageUrl ? 0.05 * seconds : 0.12 * seconds;
	},
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_video') unsupported(ID, input.capability);
		const duration = Math.min(10, Math.max(2, input.durationSeconds ?? 5));
		const body = input.imageUrl
			? { model: input.model ?? 'gen4_turbo', promptImage: input.imageUrl, promptText: input.prompt ?? input.script, ratio: ratio(input.aspect), duration }
			: { model: input.model ?? 'gen4.5', promptText: input.prompt ?? input.script, ratio: input.aspect === '9:16' ? '720:1280' : '1280:720', duration };
		const path = input.imageUrl ? 'image_to_video' : 'text_to_video';
		const res = await callJson<TaskOut>(ID, `${BASE}/${path}`, { headers: auth(), body });
		return { providerRef: res.id };
	},
	async poll(providerRef: string) {
		const res = await callJson<TaskOut>(ID, `${BASE}/tasks/${encodeURIComponent(providerRef)}`, { headers: auth() });
		if (res.status === 'SUCCEEDED') {
			const url = res.output?.[0];
			if (!url) return { status: 'failed', error: 'Runway succeeded without output' };
			return { status: 'done', result: { assets: [{ url, mime: 'video/mp4' }], providerMeta: { task: providerRef } } };
		}
		if (res.status === 'FAILED' || res.status === 'CANCELLED') return { status: 'failed', error: res.failure ?? `Runway task ${res.status}` };
		return { status: 'running' };
	},
	async verify() {
		const res = await callJson<{ creditBalance?: number }>(ID, `${BASE}/organization`, { headers: auth() });
		return { ok: true, detail: `${res.creditBalance ?? 0} credits` };
	},
};
