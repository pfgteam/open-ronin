import { describe, expect, it } from 'vitest';
import { createRunGuard, runLoop } from './runLoop';

describe('runLoop', () => {
	it('stops on the first error and reports it instead of finishing', async () => {
		const seen: number[] = [];
		const out = await runLoop(async (i) => {
			seen.push(i);
			return i === 1 ? { ok: false, error: 'GHL said 429' } : { ok: true, done: false };
		}, 10);
		expect(out).toEqual({ error: 'GHL said 429', steps: 2, capped: false });
		expect(seen).toEqual([0, 1]);
	});
	it('turns a thrown step (network) into an error', async () => {
		const out = await runLoop(async () => {
			throw new Error('fetch failed');
		}, 3);
		expect(out.error).toBe('fetch failed');
	});
	it('ends when a step says done, and flags a run that hit the cap', async () => {
		expect(await runLoop(async (i) => ({ ok: true, done: i === 2 }), 10)).toEqual({ error: null, steps: 3, capped: false });
		expect(await runLoop(async () => ({ ok: true, done: false }), 4)).toEqual({ error: null, steps: 4, capped: true });
	});
});

describe('createRunGuard', () => {
	it('refuses a second start until the first finishes', () => {
		const g = createRunGuard();
		expect(g.tryStart()).toBe(true);
		expect(g.tryStart()).toBe(false);
		g.finish();
		expect(g.tryStart()).toBe(true);
	});
});
