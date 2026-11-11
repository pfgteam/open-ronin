// Google Gemini API. Verified 2026-09-12 against ai.google.dev:
// generateContent for text, Gemini image models for images (the Imagen
// predict endpoint is documented as shut down August 17, 2026, so image
// output goes through generateContent with responseModalities IMAGE), and
// Veo predictLongRunning plus operation polling for video. Header
// x-goog-api-key on every call.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'google';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TEXT_MODEL = 'gemini-3.1-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
const VIDEO_MODEL = 'veo-3.1-lite-generate-preview';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Google (Gemini, Veo)',
	category: 'text',
	capabilities: ['generate_text', 'generate_image', 'generate_video'],
	envKeys: ['GOOGLE_AI_API_KEY'],
	docsUrl: 'https://ai.google.dev/api/generate-content',
	costNote: 'Flash Lite text fractions of a cent; Gemini image about 3 cents; Veo 3.1 Lite $0.05 per second of 720p video, paid tier only.',
	async: true,
};

function auth() {
	return { 'x-goog-api-key': requireEnv(ID, 'GOOGLE_AI_API_KEY') };
}

interface Part {
	text?: string;
	inlineData?: { mimeType: string; data: string };
}
interface GenerateOut {
	candidates?: { content?: { parts?: Part[] } }[];
	usageMetadata?: unknown;
}
interface Operation {
	name: string;
	done?: boolean;
	error?: { message?: string };
	response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		switch (input.capability) {
			case 'generate_text':
				return 0.001;
			case 'generate_image':
				return 0.04 * (input.count ?? 1);
			case 'generate_video':
				return 0.05 * (input.durationSeconds ?? 4);
			default:
				return null;
		}
	},
	async submit(input: ContentJobInput) {
		switch (input.capability) {
			case 'generate_text': {
				const res = await callJson<GenerateOut>(ID, `${BASE}/models/${input.model ?? TEXT_MODEL}:generateContent`, {
					headers: auth(),
					body: {
						...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
						contents: [{ parts: [{ text: input.prompt }] }],
						generationConfig: { maxOutputTokens: input.maxTokens ?? 1024 },
					},
				});
				const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
				return { result: { assets: [], text, providerMeta: { model: input.model ?? TEXT_MODEL, usage: res.usageMetadata } } };
			}
			case 'generate_image': {
				const res = await callJson<GenerateOut>(ID, `${BASE}/models/${input.model ?? IMAGE_MODEL}:generateContent`, {
					headers: auth(),
					body: { contents: [{ parts: [{ text: input.prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } },
				});
				const parts = res.candidates?.[0]?.content?.parts ?? [];
				const assets = parts.filter((p) => p.inlineData).map((p) => ({ base64: p.inlineData!.data, mime: p.inlineData!.mimeType }));
				return { result: { assets, providerMeta: { model: input.model ?? IMAGE_MODEL, usage: res.usageMetadata } } };
			}
			case 'generate_video': {
				const duration = String(Math.min(8, Math.max(4, input.durationSeconds ?? 4)));
				const res = await callJson<Operation>(ID, `${BASE}/models/${input.model ?? VIDEO_MODEL}:predictLongRunning`, {
					headers: auth(),
					body: {
						instances: [{ prompt: input.prompt ?? input.script }],
						parameters: { durationSeconds: duration, resolution: '720p', aspectRatio: input.aspect ?? '16:9' },
					},
				});
				return { providerRef: res.name };
			}
			default:
				return unsupported(ID, input.capability);
		}
	},
	async poll(providerRef: string) {
		const op = await callJson<Operation>(ID, `${BASE}/${providerRef}`, { headers: auth() });
		if (!op.done) return { status: 'running' };
		if (op.error) return { status: 'failed', error: op.error.message ?? 'Veo operation failed' };
		const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
		if (!uri) return { status: 'failed', error: 'Veo finished without a video' };
		// The download URI needs the API key header; advance.ts asks downloadHeaders() for it.
		return { status: 'done', result: { assets: [{ url: uri, mime: 'video/mp4' }], providerMeta: { operation: providerRef } } };
	},
	downloadHeaders: () => auth(),
	async verify() {
		const res = await callJson<{ models?: unknown[] }>(ID, `${BASE}/models`, { headers: auth() });
		return { ok: true, detail: `${res.models?.length ?? 0} models visible` };
	},
};
