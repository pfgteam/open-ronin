// AssemblyAI. Verified 2026-09-12 against assemblyai.com/docs/api-reference:
// POST /v2/transcript (Authorization: raw key) with {audio_url} returns id;
// GET /v2/transcript/{id} status queued, processing, completed, error with
// text. GET /v2/transcript?limit=1 is the free key check.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'assemblyai';
const BASE = 'https://api.assemblyai.com/v2';
const DEFAULT_MODEL = 'universal';

export const spec: ProviderSpec = {
	id: ID,
	label: 'AssemblyAI',
	category: 'transcription',
	capabilities: ['transcribe'],
	envKeys: ['ASSEMBLYAI_API_KEY'],
	docsUrl: 'https://www.assemblyai.com/docs/api-reference/transcripts/submit',
	costNote: 'Universal model about 15 cents per hour of audio; $50 signup credit.',
	async: true,
};

function auth() {
	return { authorization: requireEnv(ID, 'ASSEMBLYAI_API_KEY') };
}

interface Transcript {
	id?: string;
	status?: string;
	text?: string | null;
	error?: string;
	audio_duration?: number;
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'transcribe' ? 0.1 : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'transcribe') unsupported(ID, input.capability);
		const res = await callJson<Transcript>(ID, `${BASE}/transcript`, {
			headers: auth(),
			body: { audio_url: input.audioUrl, speech_model: input.model ?? DEFAULT_MODEL, ...(input.language ? { language_code: input.language } : {}) },
		});
		if (!res.id) throw new Error('AssemblyAI returned no transcript id');
		return { providerRef: res.id };
	},
	async poll(providerRef: string) {
		const res = await callJson<Transcript>(ID, `${BASE}/transcript/${encodeURIComponent(providerRef)}`, { headers: auth() });
		if (res.status === 'error') return { status: 'failed', error: res.error ?? 'AssemblyAI transcription failed' };
		if (res.status !== 'completed') return { status: 'running' };
		return { status: 'done', result: { assets: [], text: res.text ?? '', providerMeta: { model: DEFAULT_MODEL, duration: res.audio_duration } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/transcript?limit=1`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
