import { describe, expect, it, vi } from 'vitest';
import { enqueueContentJob, isCapRefusal } from './enqueue';

// A minimal fake of the service role client: records the insert and answers
// with whatever the test wants Postgres to say.
function fakeDb(answer: { data?: { id: string } | null; error?: { message: string } | null }) {
	const inserted: unknown[] = [];
	const chain = {
		insert(row: unknown) {
			inserted.push(row);
			return chain;
		},
		select() {
			return chain;
		},
		single: vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null })),
	};
	return { db: { from: () => chain } as never, inserted };
}

const CAP = 'Daily content budget reached for consumer hermes: $19.50 spent today, $1.00 estimated for this job, cap $20.00. Ask an admin to raise the cap on /admin/providers.';

describe('enqueueContentJob', () => {
	it('refuses bad input before touching the database', async () => {
		const { db, inserted } = fakeDb({ data: { id: 'j1' } });
		const res = await enqueueContentJob(db, { provider: 'openai', input: { capability: 'generate_image' }, requestedBy: 'u1', requestedVia: 'ui' });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refused).toBe('input');
		expect(inserted).toHaveLength(0);
	});

	it('refuses a provider that does not offer the capability', async () => {
		const { db } = fakeDb({ data: { id: 'j1' } });
		const res = await enqueueContentJob(db, { provider: 'anthropic', input: { capability: 'generate_image', prompt: 'x' }, requestedBy: 'u1', requestedVia: 'ui' });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/does not offer generate_image/);
	});

	it('says "key not set" for an unconfigured provider instead of inserting', async () => {
		const saved = process.env.XAI_API_KEY;
		delete process.env.XAI_API_KEY;
		const { db, inserted } = fakeDb({ data: { id: 'j1' } });
		const res = await enqueueContentJob(db, { provider: 'xai', input: { capability: 'generate_text', prompt: 'x' }, requestedBy: 'u1', requestedVia: 'ui' });
		if (saved !== undefined) process.env.XAI_API_KEY = saved;
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/key is not set \(XAI_API_KEY\)/);
		expect(inserted).toHaveLength(0);
	});

	it('inserts with the consumer slug and estimate for an MCP request', async () => {
		process.env.ANTHROPIC_API_KEY = 'test';
		const { db, inserted } = fakeDb({ data: { id: 'j2' } });
		const res = await enqueueContentJob(db, {
			provider: 'anthropic',
			input: { capability: 'generate_text', prompt: 'Write a headline' },
			requestedBy: null,
			requestedVia: 'mcp',
			consumerSlug: 'hermes',
		});
		delete process.env.ANTHROPIC_API_KEY;
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.jobId).toBe('j2');
		expect(inserted[0]).toMatchObject({ provider: 'anthropic', requested_via: 'mcp', consumer_slug: 'hermes', requested_by: null, capability: 'generate_text' });
		expect((inserted[0] as { cost_usd: number }).cost_usd).toBeGreaterThan(0);
	});

	it('carries the database cap refusal back verbatim', async () => {
		process.env.ANTHROPIC_API_KEY = 'test';
		const { db } = fakeDb({ error: { message: CAP } });
		const res = await enqueueContentJob(db, { provider: 'anthropic', input: { capability: 'generate_text', prompt: 'x' }, requestedBy: null, requestedVia: 'mcp', consumerSlug: 'hermes' });
		delete process.env.ANTHROPIC_API_KEY;
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.refused).toBe('cap');
			expect(res.message).toBe(CAP);
		}
	});

	it('isCapRefusal recognises the trigger sentence only', () => {
		expect(isCapRefusal(CAP)).toBe(true);
		expect(isCapRefusal('duplicate key value violates unique constraint')).toBe(false);
	});
});
