// xAI Grok. Verified 2026-09-12 against docs.x.ai/developers/rest-api-reference:
// POST /v1/responses (OpenAI Responses compatible), Authorization: Bearer.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'xai';
const BASE = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4.3';

export const spec: ProviderSpec = {
	id: ID,
	label: 'xAI (Grok)',
	category: 'text',
	capabilities: ['generate_text'],
	envKeys: ['XAI_API_KEY'],
	docsUrl: 'https://docs.x.ai/developers/rest-api-reference/inference/responses',
	costNote: 'Grok 4.3 about $1.25 per million input tokens and $2.50 per million output.',
	async: false,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'XAI_API_KEY')}` };
}

interface ResponsesOut {
	output: { type: string; content?: { type: string; text?: string }[] }[];
	model: string;
	usage?: unknown;
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_text' ? 0.005 : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_text') unsupported(ID, input.capability);
		const res = await callJson<ResponsesOut>(ID, `${BASE}/responses`, {
			headers: auth(),
			body: {
				model: input.model ?? DEFAULT_MODEL,
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
	},
	async verify() {
		const res = await callJson<{ data?: unknown[] }>(ID, `${BASE}/models`, { headers: auth() });
		return { ok: true, detail: `${res.data?.length ?? 0} models visible` };
	},
};
