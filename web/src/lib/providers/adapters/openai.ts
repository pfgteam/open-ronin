// OpenAI. Verified 2026-09-12 against developers.openai.com/api/reference:
// Responses (text), Images generations and edits (b64_json for gpt-image
// models), Audio speech (raw bytes) and transcriptions (multipart).
// Authorization: Bearer on every call.

import { allPresent, call, callJson, fetchBlob, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'openai';
const BASE = 'https://api.openai.com/v1';
const TEXT_MODEL = 'gpt-5-nano';
const IMAGE_MODEL = 'gpt-image-1-mini';
const TTS_MODEL = 'gpt-4o-mini-tts';
const STT_MODEL = 'gpt-4o-mini-transcribe';

export const spec: ProviderSpec = {
	id: ID,
	label: 'OpenAI',
	category: 'text',
	capabilities: ['generate_text', 'generate_image', 'edit_image', 'generate_voice', 'transcribe'],
	envKeys: ['OPENAI_API_KEY'],
	docsUrl: 'https://developers.openai.com/api/reference',
	costNote: 'gpt-image-1-mini low quality about a cent per image; gpt-5-nano text fractions of a cent; TTS about $0.015 per minute.',
	async: false,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'OPENAI_API_KEY')}` };
}

interface ResponsesOut {
	output: { type: string; content?: { type: string; text?: string }[] }[];
	model: string;
	usage?: unknown;
}
interface ImagesOut {
	data: { b64_json?: string; url?: string }[];
	usage?: unknown;
}

function sizeOf(size: string | undefined): { size: string; w: number; h: number } {
	const allowed: Record<string, [number, number]> = { '1024x1024': [1024, 1024], '1536x1024': [1536, 1024], '1024x1536': [1024, 1536] };
	const s = size && allowed[size] ? size : '1024x1024';
	return { size: s, w: allowed[s][0], h: allowed[s][1] };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		switch (input.capability) {
			case 'generate_text':
				return 0.001;
			case 'generate_image':
				return 0.01 * (input.count ?? 1);
			case 'edit_image':
				return 0.015;
			case 'generate_voice':
				return Math.max(0.001, (input.text.length / 1000) * 0.015);
			case 'transcribe':
				return 0.01;
			default:
				return null;
		}
	},
	async submit(input: ContentJobInput) {
		switch (input.capability) {
			case 'generate_text': {
				const res = await callJson<ResponsesOut>(ID, `${BASE}/responses`, {
					headers: auth(),
					body: {
						model: input.model ?? TEXT_MODEL,
						...(input.system ? { instructions: input.system } : {}),
						input: input.prompt,
						max_output_tokens: input.maxTokens ?? 1024,
					},
				});
				const text = res.output
					.filter((o) => o.type === 'message')
					.flatMap((o) => o.content ?? [])
					.filter((c) => c.type === 'output_text')
					.map((c) => c.text ?? '')
					.join('');
				return { result: { assets: [], text, providerMeta: { model: res.model, usage: res.usage } } };
			}
			case 'generate_image': {
				const { size, w, h } = sizeOf(input.size);
				const res = await callJson<ImagesOut>(ID, `${BASE}/images/generations`, {
					headers: auth(),
					body: { model: input.model ?? IMAGE_MODEL, prompt: input.prompt, n: input.count ?? 1, size, quality: 'low', output_format: 'jpeg' },
				});
				return {
					result: {
						assets: res.data.map((d) => ({ base64: d.b64_json, url: d.url, mime: 'image/jpeg', width: w, height: h })),
						providerMeta: { model: input.model ?? IMAGE_MODEL, usage: res.usage },
					},
				};
			}
			case 'edit_image': {
				const { size, w, h } = sizeOf(input.size);
				const fd = new FormData();
				fd.set('model', input.model ?? IMAGE_MODEL);
				fd.set('prompt', input.prompt);
				fd.set('size', size);
				fd.set('quality', 'low');
				fd.set('image', await fetchBlob(ID, input.imagePath, 'image.png'));
				if (input.maskPath) fd.set('mask', await fetchBlob(ID, input.maskPath, 'mask.png'));
				const res = await callJson<ImagesOut>(ID, `${BASE}/images/edits`, { headers: auth(), body: fd });
				return {
					result: {
						assets: res.data.map((d) => ({ base64: d.b64_json, url: d.url, mime: 'image/png', width: w, height: h })),
						providerMeta: { model: input.model ?? IMAGE_MODEL },
					},
				};
			}
			case 'generate_voice': {
				const format = input.format ?? 'mp3';
				const res = await call(ID, `${BASE}/audio/speech`, {
					headers: auth(),
					body: { model: input.model ?? TTS_MODEL, input: input.text, voice: input.voiceId ?? 'alloy', response_format: format },
				});
				const bytes = Buffer.from(await res.arrayBuffer());
				return {
					result: {
						assets: [{ base64: bytes.toString('base64'), mime: format === 'wav' ? 'audio/wav' : 'audio/mpeg', bytes: bytes.length }],
						providerMeta: { model: input.model ?? TTS_MODEL, voice: input.voiceId ?? 'alloy' },
					},
				};
			}
			case 'transcribe': {
				const fd = new FormData();
				fd.set('model', input.model ?? STT_MODEL);
				fd.set('file', await fetchBlob(ID, input.audioUrl, 'audio.mp3'));
				if (input.language) fd.set('language', input.language);
				const res = await callJson<{ text: string; usage?: unknown }>(ID, `${BASE}/audio/transcriptions`, { headers: auth(), body: fd });
				return { result: { assets: [], text: res.text, providerMeta: { model: input.model ?? STT_MODEL, usage: res.usage } } };
			}
			default:
				return unsupported(ID, input.capability);
		}
	},
	async verify() {
		const res = await callJson<{ data: unknown[] }>(ID, `${BASE}/models`, { headers: auth() });
		return { ok: true, detail: `${res.data.length} models visible` };
	},
};
