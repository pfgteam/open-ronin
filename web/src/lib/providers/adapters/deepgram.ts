// Deepgram. Verified 2026-09-12 against developers.deepgram.com: POST
// /v1/listen?model=nova-3 (Authorization: Token <key>) with {url} returns
// results.channels[0].alternatives[0].transcript synchronously. GET
// /v1/projects is the free key check.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'deepgram';
const BASE = 'https://api.deepgram.com/v1';
const DEFAULT_MODEL = 'nova-3';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Deepgram',
	category: 'transcription',
	capabilities: ['transcribe'],
	envKeys: ['DEEPGRAM_API_KEY'],
	docsUrl: 'https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded',
	costNote: 'Nova 3 about $0.0077 per minute of audio (about 46 cents an hour); $200 signup credit.',
	async: false,
};

function auth() {
	return { authorization: `Token ${requireEnv(ID, 'DEEPGRAM_API_KEY')}` };
}

interface ListenOut {
	metadata?: { duration?: number; request_id?: string };
	results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'transcribe' ? 0.25 : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'transcribe') unsupported(ID, input.capability);
		const qs = new URLSearchParams({ model: input.model ?? DEFAULT_MODEL, smart_format: 'true' });
		if (input.language) qs.set('language', input.language);
		const res = await callJson<ListenOut>(ID, `${BASE}/listen?${qs}`, { headers: auth(), body: { url: input.audioUrl } });
		const text = res.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
		return { result: { assets: [], text, providerMeta: { model: input.model ?? DEFAULT_MODEL, duration: res.metadata?.duration, request_id: res.metadata?.request_id } } };
	},
	async verify() {
		const res = await callJson<{ projects?: unknown[] }>(ID, `${BASE}/projects`, { headers: auth() });
		return { ok: true, detail: `${res.projects?.length ?? 0} projects visible` };
	},
};
