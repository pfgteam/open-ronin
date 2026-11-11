// The provider registry: every adapter, in the order /admin/providers shows
// them. PROVIDER_IDS is the closed list mirrored by the CHECK on
// content_jobs.provider in 0065; a new adapter needs a migration that widens
// that CHECK, which is deliberate.

import type { Capability, ContentJobInput, ProviderAdapter, ProviderSpec } from './types';
import { adapter as anthropic } from './adapters/anthropic';
import { adapter as openai } from './adapters/openai';
import { adapter as google } from './adapters/google';
import { adapter as xai } from './adapters/xai';
import { adapter as perplexity } from './adapters/perplexity';
import { adapter as ideogram } from './adapters/ideogram';
import { adapter as stability } from './adapters/stability';
import { adapter as bfl } from './adapters/bfl';
import { adapter as recraft } from './adapters/recraft';
import { adapter as leonardo } from './adapters/leonardo';
import { adapter as heygen } from './adapters/heygen';
import { adapter as runway } from './adapters/runway';
import { adapter as kling } from './adapters/kling';
import { adapter as luma } from './adapters/luma';
import { adapter as synthesia } from './adapters/synthesia';
import { adapter as elevenlabs } from './adapters/elevenlabs';
import { adapter as suno } from './adapters/suno';
import { adapter as opusclip } from './adapters/opusclip';
import { adapter as descript } from './adapters/descript';
import { adapter as canva } from './adapters/canva';
import { adapter as deepgram } from './adapters/deepgram';
import { adapter as assemblyai } from './adapters/assemblyai';
import { adapter as pexels } from './adapters/pexels';
import { adapter as unsplash } from './adapters/unsplash';
import { adapter as metricool } from './adapters/metricool';
import { adapter as higgsfield } from './adapters/higgsfield';

export const ADAPTERS: readonly ProviderAdapter[] = [
	anthropic,
	openai,
	google,
	xai,
	perplexity,
	ideogram,
	stability,
	bfl,
	recraft,
	leonardo,
	heygen,
	runway,
	kling,
	luma,
	synthesia,
	elevenlabs,
	suno,
	opusclip,
	descript,
	canva,
	deepgram,
	assemblyai,
	pexels,
	unsplash,
	metricool,
	higgsfield,
];

export const PROVIDER_IDS = ADAPTERS.map((a) => a.spec.id) as readonly string[];

const byId = new Map(ADAPTERS.map((a) => [a.spec.id, a]));

export function getAdapter(id: string): ProviderAdapter | undefined {
	return byId.get(id);
}

export function isProviderId(id: string): boolean {
	return byId.has(id);
}

/** Adapters that advertise a capability, configured or not. */
export function adaptersFor(capability: Capability): ProviderAdapter[] {
	return ADAPTERS.filter((a) => a.spec.capabilities.includes(capability));
}

export interface ProviderStatus {
	spec: ProviderSpec;
	configured: boolean;
	/** Which env var names are missing; names only, never values. */
	missingKeys: string[];
}

/** Presence only. Safe for the UI and for the MCP list tool. */
export function listProviders(): ProviderStatus[] {
	return ADAPTERS.map((a) => ({
		spec: a.spec,
		configured: a.isConfigured(),
		missingKeys: a.spec.envKeys.filter((k) => !process.env[k] || process.env[k]?.trim() === ''),
	}));
}

/** USD estimate for the daily cap; 0 when the adapter cannot say. */
export function estimateCost(providerId: string, input: ContentJobInput): number {
	const a = byId.get(providerId);
	const v = a?.estimateCost?.(input);
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Number(v.toFixed(4)) : 0;
}

/**
 * The cheapest real call per capability, used by the Test button on
 * /admin/providers. Video and avatar providers verify the key instead of
 * rendering, because their smallest job costs real money.
 */
export function cheapestTestInput(capability: Capability): ContentJobInput | null {
	switch (capability) {
		case 'generate_text':
			return { capability, prompt: 'Reply with one short sentence confirming the connection works.', maxTokens: 40 };
		case 'generate_image':
			return { capability, prompt: 'A small teal circle on a white background, flat illustration.', size: '1024x1024', count: 1 };
		case 'generate_voice':
			return { capability, text: 'The connection works.' };
		case 'search_stock':
			return { capability, query: 'teal abstract', count: 1 };
		default:
			return null;
	}
}
