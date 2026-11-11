// ElevenLabs. Verified 2026-09-12 against elevenlabs.io/docs/api-reference:
// POST /v1/text-to-speech/{voice_id} (xi-api-key) returns raw audio bytes;
// POST /v1/speech-to-text (multipart, model_id scribe_v1) returns {text}.
// GET /v1/voices is the free key check and the source of voice ids.

import { allPresent, call, callJson, fetchBlob, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'elevenlabs';
const BASE = 'https://api.elevenlabs.io/v1';
const TTS_MODEL = 'eleven_flash_v2_5';
const STT_MODEL = 'scribe_v1';
/** "Rachel", a stock premade voice present on every account. */
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';

export const spec: ProviderSpec = {
	id: ID,
	label: 'ElevenLabs',
	category: 'voice',
	capabilities: ['generate_voice', 'transcribe'],
	envKeys: ['ELEVENLABS_API_KEY'],
	docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',
	costNote: 'Flash v2.5 about 15 cents per thousand characters; Scribe transcription about 40 cents per hour. Free tier exists.',
	async: false,
};

function auth() {
	return { 'xi-api-key': requireEnv(ID, 'ELEVENLABS_API_KEY') };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		if (input.capability === 'generate_voice') return Math.max(0.001, (input.text.length / 1000) * 0.15);
		if (input.capability === 'transcribe') return 0.05;
		return null;
	},
	async submit(input: ContentJobInput) {
		if (input.capability === 'generate_voice') {
			const voice = input.voiceId ?? DEFAULT_VOICE;
			const res = await call(ID, `${BASE}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
				headers: auth(),
				body: { text: input.text, model_id: input.model ?? TTS_MODEL },
			});
			const bytes = Buffer.from(await res.arrayBuffer());
			return { result: { assets: [{ base64: bytes.toString('base64'), mime: 'audio/mpeg', bytes: bytes.length }], providerMeta: { model: input.model ?? TTS_MODEL, voice } } };
		}
		if (input.capability === 'transcribe') {
			const fd = new FormData();
			fd.set('model_id', input.model ?? STT_MODEL);
			fd.set('file', await fetchBlob(ID, input.audioUrl, 'audio.mp3'));
			if (input.language) fd.set('language_code', input.language);
			const res = await callJson<{ text?: string; language_code?: string }>(ID, `${BASE}/speech-to-text`, { headers: auth(), body: fd });
			return { result: { assets: [], text: res.text ?? '', providerMeta: { model: input.model ?? STT_MODEL, language: res.language_code } } };
		}
		return unsupported(ID, input.capability);
	},
	async verify() {
		const res = await callJson<{ voices?: unknown[] }>(ID, `${BASE}/voices`, { headers: auth() });
		return { ok: true, detail: `${res.voices?.length ?? 0} voices visible` };
	},
};
