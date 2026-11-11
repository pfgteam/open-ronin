// Anthropic Messages API. Verified 2026-09-12 against
// https://docs.anthropic.com/en/api/messages: POST /v1/messages with
// x-api-key and anthropic-version headers; text lives in content[].text.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'anthropic';
const BASE = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Anthropic (Claude)',
	category: 'text',
	capabilities: ['generate_text'],
	envKeys: ['ANTHROPIC_API_KEY'],
	docsUrl: 'https://docs.anthropic.com/en/api/messages',
	costNote: 'Haiku 4.5 about $1 per million input tokens and $5 per million output; a short draft is under a cent.',
	async: false,
};

function headers() {
	return { 'x-api-key': requireEnv(ID, 'ANTHROPIC_API_KEY'), 'anthropic-version': VERSION };
}

interface MessagesResponse {
	content: { type: string; text?: string }[];
	model: string;
	stop_reason: string;
	usage: { input_tokens: number; output_tokens: number };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost(input: ContentJobInput) {
		if (input.capability !== 'generate_text') return null;
		const out = input.maxTokens ?? 1024;
		return (input.prompt.length / 4) * 0.000001 + out * 0.000005;
	},
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_text') unsupported(ID, input.capability);
		const res = await callJson<MessagesResponse>(ID, `${BASE}/messages`, {
			headers: headers(),
			body: {
				model: input.model ?? DEFAULT_MODEL,
				max_tokens: input.maxTokens ?? 1024,
				...(input.system ? { system: input.system } : {}),
				messages: [{ role: 'user', content: input.prompt }],
			},
		});
		const text = res.content
			.filter((c) => c.type === 'text')
			.map((c) => c.text ?? '')
			.join('');
		return {
			result: {
				assets: [],
				text,
				providerMeta: { model: res.model, stop_reason: res.stop_reason, usage: res.usage },
			},
		};
	},
	async verify() {
		const res = await callJson<{ data: unknown[] }>(ID, `${BASE}/models`, { headers: headers() });
		return { ok: true, detail: `${res.data.length} models visible` };
	},
};
