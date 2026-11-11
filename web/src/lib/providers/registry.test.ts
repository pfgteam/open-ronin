import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADAPTERS, PROVIDER_IDS, adaptersFor, cheapestTestInput, estimateCost, getAdapter, listProviders } from './registry';
import { CAPABILITIES } from './types';
import { contentJobInputSchema, parseContentJobInput } from './schema';
import { klingToken } from './adapters/kling';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const KEY_NAMES = [...new Set(ADAPTERS.flatMap((a) => a.spec.envKeys))];

describe('registry', () => {
	it('ships exactly the 26 providers in the plan, no duplicates', () => {
		expect(ADAPTERS).toHaveLength(26);
		expect(new Set(PROVIDER_IDS).size).toBe(26);
		expect(PROVIDER_IDS).toEqual([
			'anthropic', 'openai', 'google', 'xai', 'perplexity',
			'ideogram', 'stability', 'bfl', 'recraft', 'leonardo',
			'heygen', 'runway', 'kling', 'luma', 'synthesia',
			'elevenlabs', 'suno', 'opusclip', 'descript', 'canva',
			'deepgram', 'assemblyai', 'pexels', 'unsplash', 'metricool',
			'higgsfield',
		]);
	});

	it('every capability an adapter advertises is a known capability', () => {
		for (const a of ADAPTERS) for (const c of a.spec.capabilities) expect(CAPABILITIES).toContain(c);
	});

	it('every async adapter can be polled', () => {
		for (const a of ADAPTERS) if (a.spec.async) expect(typeof a.poll, `${a.spec.id} is async but has no poll()`).toBe('function');
	});

	it('the migration CHECK lists mirror the registry and the capability list', () => {
		// 0065 is the content_jobs migration; 0095 widens its provider CHECK
		// for higgsfield. Read both so the test stays correct as new adapters
		// land on the CHECK via later migrations.
		const dir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
		const files = readdirSync(dir).sort().filter((f) => f.endsWith('.sql'));
		const sql = files.map((f) => readFileSync(path.resolve(dir, f), 'utf8')).join('\n');
		for (const id of PROVIDER_IDS) expect(sql, `provider CHECK is missing '${id}'`).toMatch(new RegExp(`'${id}'`));
		for (const c of CAPABILITIES) expect(sql, `capability CHECK is missing '${c}'`).toMatch(new RegExp(`'${c}'`));
	});

	it('every env key the registry reads is declared in env.d.ts and docs/ENV.md', () => {
		const dts = readFileSync(path.resolve(import.meta.dirname, '../../../env.d.ts'), 'utf8');
		const env = readFileSync(path.resolve(import.meta.dirname, '../../../../docs/ENV.md'), 'utf8');
		for (const k of KEY_NAMES) {
			expect(dts, `env.d.ts lacks ${k}`).toContain(k);
			expect(env, `docs/ENV.md lacks ${k}`).toContain(k);
		}
	});

	it('getAdapter and adaptersFor find the right adapters', () => {
		expect(getAdapter('openai')?.spec.label).toMatch(/OpenAI/);
		expect(getAdapter('midjourney')).toBeUndefined();
		expect(adaptersFor('generate_video').map((a) => a.spec.id)).toEqual(['google', 'heygen', 'runway', 'kling', 'luma', 'higgsfield']);
		expect(adaptersFor('search_stock').map((a) => a.spec.id)).toEqual(['pexels', 'unsplash']);
	});
});

describe('with no keys set', () => {
	const saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		for (const k of KEY_NAMES) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
	});
	afterEach(() => {
		for (const k of KEY_NAMES) if (saved[k] !== undefined) process.env[k] = saved[k];
	});

	it('lists 26 rows, none configured, none throwing, and never a key value', () => {
		const rows = listProviders();
		expect(rows).toHaveLength(26);
		for (const r of rows) {
			expect(r.configured).toBe(false);
			expect(r.missingKeys).toEqual(r.spec.envKeys);
		}
		const json = JSON.stringify(rows);
		expect(json).not.toMatch(/sk-|Bearer /);
	});

	it('marks a provider configured once its keys are present, except the ones with no public API', () => {
		process.env.OPENAI_API_KEY = 'x';
		process.env.KLING_ACCESS_KEY = 'a';
		process.env.SUNO_API_KEY = 'y';
		expect(getAdapter('openai')!.isConfigured()).toBe(true);
		expect(getAdapter('kling')!.isConfigured(), 'kling needs both keys').toBe(false);
		expect(getAdapter('suno')!.isConfigured(), 'suno has no public API').toBe(false);
	});

	it('an unconfigured adapter refuses submit with a plain error, not a crash', async () => {
		await expect(getAdapter('anthropic')!.submit({ capability: 'generate_text', prompt: 'hi' })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
	});
});

describe('cost estimates and test inputs', () => {
	it('estimateCost is non negative and finite for every adapter and capability it supports', () => {
		for (const a of ADAPTERS) {
			for (const c of a.spec.capabilities) {
				const input = cheapestTestInput(c) ?? sampleInput(c);
				const v = estimateCost(a.spec.id, input);
				expect(v, `${a.spec.id}/${c}`).toBeGreaterThanOrEqual(0);
				expect(Number.isFinite(v)).toBe(true);
			}
		}
	});
	it('the cheapest test call exists for text, image, voice and stock only', () => {
		expect(cheapestTestInput('generate_text')?.capability).toBe('generate_text');
		expect(cheapestTestInput('generate_video')).toBeNull();
		expect(cheapestTestInput('lipsync_avatar')).toBeNull();
	});
});

function sampleInput(c: (typeof CAPABILITIES)[number]) {
	switch (c) {
		case 'edit_image':
			return { capability: c, prompt: 'p', imagePath: 'https://example.com/a.png' } as const;
		case 'generate_video':
			return { capability: c, prompt: 'p', durationSeconds: 5 } as const;
		case 'lipsync_avatar':
			return { capability: c, script: 's' } as const;
		case 'generate_music':
			return { capability: c, prompt: 'p' } as const;
		case 'transcribe':
			return { capability: c, audioUrl: 'https://example.com/a.mp3' } as const;
		case 'clip_video':
			return { capability: c, videoUrl: 'https://example.com/v.mp4' } as const;
		case 'edit_video':
			return { capability: c, videoUrl: 'https://example.com/v.mp4', instructions: 'i' } as const;
		case 'design_export':
			return { capability: c, designId: 'D1' } as const;
		default:
			return cheapestTestInput(c)!;
	}
}

describe('contentJobInputSchema', () => {
	it('accepts each capability with its minimal fields', () => {
		for (const c of CAPABILITIES) expect(contentJobInputSchema.safeParse(sampleInput(c)).success, c).toBe(true);
	});
	it('rejects an unknown capability, an oversize prompt, and a video with neither prompt nor script', () => {
		expect(contentJobInputSchema.safeParse({ capability: 'mine_bitcoin', prompt: 'x' }).success).toBe(false);
		expect(contentJobInputSchema.safeParse({ capability: 'generate_text', prompt: 'x'.repeat(5000) }).success).toBe(false);
		expect(contentJobInputSchema.safeParse({ capability: 'generate_video' }).success).toBe(false);
	});
	it('parseContentJobInput throws on bad input', () => {
		expect(() => parseContentJobInput({ capability: 'generate_image', prompt: 'x', size: 'huge' })).toThrow();
	});
});

describe('klingToken', () => {
	it('builds an HS256 JWT with iss, exp 30 minutes out and nbf 5 seconds back', () => {
		const now = 1_700_000_000;
		const token = klingToken('AK', 'SK', now);
		const [h, p, s] = token.split('.');
		const dec = (x: string) => JSON.parse(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
		expect(dec(h)).toEqual({ alg: 'HS256', typ: 'JWT' });
		expect(dec(p)).toEqual({ iss: 'AK', exp: now + 1800, nbf: now - 5 });
		expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});
