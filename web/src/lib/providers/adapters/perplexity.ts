// Perplexity Agent API. Verified 2026-09-12 against docs.perplexity.ai:
// POST /v1/agent (Responses shaped) returns a message with url_citation
// annotations plus a search_results output item; usage.cost.total_cost is
// the exact USD cost. Sonar chat completions sunset September 27, 2026.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'perplexity';
const BASE = 'https://api.perplexity.ai/v1';
const DEFAULT_MODEL = 'perplexity/sonar';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Perplexity (research with citations)',
	category: 'research',
	capabilities: ['generate_text'],
	envKeys: ['PERPLEXITY_API_KEY'],
	docsUrl: 'https://docs.perplexity.ai/api-reference/agent-post',
	costNote: 'About half a cent per grounded answer (one web search plus Sonar tokens); the exact cost comes back on every call.',
	async: false,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'PERPLEXITY_API_KEY')}` };
}

interface AgentOut {
	model?: string;
	output: {
		type: string;
		content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[];
		results?: { title?: string; url?: string; snippet?: string; date?: string }[];
	}[];
	usage?: { cost?: { total_cost?: number } };
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: (input: ContentJobInput) => (input.capability === 'generate_text' ? 0.01 : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'generate_text') unsupported(ID, input.capability);
		const res = await callJson<AgentOut>(ID, `${BASE}/agent`, {
			headers: auth(),
			body: {
				model: input.model ?? DEFAULT_MODEL,
				...(input.system ? { instructions: input.system } : {}),
				input: input.prompt,
				max_output_tokens: input.maxTokens ?? 1024,
			},
		});
		const messages = res.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
		const text = messages
			.filter((c) => c.type === 'output_text')
			.map((c) => c.text ?? '')
			.join('');
		const citations = messages.flatMap((c) => c.annotations ?? []).filter((a) => a.type === 'url_citation');
		const sources = res.output.filter((o) => o.type === 'search_results').flatMap((o) => o.results ?? []);
		return {
			result: {
				assets: [],
				text,
				providerMeta: { model: res.model ?? DEFAULT_MODEL, citations, sources, cost_usd: res.usage?.cost?.total_cost ?? null },
			},
		};
	},
	async verify() {
		const res = await callJson<{ data?: unknown[] }>(ID, `${BASE}/models`, { headers: auth() });
		return { ok: true, detail: `${res.data?.length ?? 0} models visible` };
	},
};
