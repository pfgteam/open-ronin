import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

const URL_BASE = 'https://app.example.com/api/bridges/meta/webhook';

function get(qs: Record<string, string>) {
	const u = new URL(URL_BASE);
	for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
	return GET(new NextRequest(u));
}

describe('GET /api/bridges/meta/webhook (hub.challenge handshake)', () => {
	beforeEach(() => {
		process.env.META_WEBHOOK_VERIFY_TOKEN = 'secret-123';
	});
	afterEach(() => {
		delete process.env.META_WEBHOOK_VERIFY_TOKEN;
	});

	it('echoes hub.challenge as plain text when the token matches', async () => {
		const res = get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'secret-123', 'hub.challenge': '4242' });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/plain');
		expect(await res.text()).toBe('4242');
	});

	it('403s on a wrong token', () => {
		expect(get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }).status).toBe(403);
	});

	it('403s on a non-subscribe mode', () => {
		expect(get({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'secret-123', 'hub.challenge': '1' }).status).toBe(403);
	});

	it('403s when no token is configured (fails closed)', () => {
		delete process.env.META_WEBHOOK_VERIFY_TOKEN;
		expect(get({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }).status).toBe(403);
	});
});

describe('POST /api/bridges/meta/webhook (ack-only stub)', () => {
	it('acks a Messenger event and logs a summary', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const body = {
			object: 'page',
			entry: [{ id: 'PAGE1', messaging: [{ sender: { id: 'PSID' }, recipient: { id: 'PAGE1' }, message: { mid: 'm1', text: 'hi' } }] }],
		};
		const res = await POST(new NextRequest(URL_BASE, { method: 'POST', body: JSON.stringify(body) }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, received: 1 });
		expect(log).toHaveBeenCalledWith('[meta-webhook] inbound', expect.stringContaining('"text":"hi"'));
		log.mockRestore();
	});

	it('acks a malformed body instead of erroring', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const res = await POST(new NextRequest(URL_BASE, { method: 'POST', body: 'not json' }));
		expect(res.status).toBe(200);
		vi.restoreAllMocks();
	});
});
