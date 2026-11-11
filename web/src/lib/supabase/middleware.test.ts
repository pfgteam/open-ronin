// Fail-soft auth probe used by the edge middleware. Contract: a hung or
// throwing getUser() must resolve as 'unavailable' within the timeout so the
// middleware can degrade instead of hitting Vercel's 504 wall.
import { describe, expect, it } from 'vitest';
import { hasSessionCookie, isPublic, probeUser } from './middleware';

function fakeRequest(cookieNames: string[]) {
	return {
		cookies: { getAll: () => cookieNames.map((name) => ({ name, value: 'x' })) },
	} as unknown as Parameters<typeof hasSessionCookie>[0];
}

describe('probeUser', () => {
	it('returns the user when auth answers in time', async () => {
		const r = await probeUser(async () => ({ data: { user: { id: 'u1' } } }), 200);
		expect(r).toEqual({ kind: 'ok', user: { id: 'u1' } });
	});

	it('returns null user (not unavailable) when auth answers with no session', async () => {
		const r = await probeUser(async () => ({ data: { user: null } }), 200);
		expect(r).toEqual({ kind: 'ok', user: null });
	});

	it('resolves unavailable when auth hangs past the timeout', async () => {
		const started = Date.now();
		const r = await probeUser(() => new Promise(() => {}), 50);
		expect(r).toEqual({ kind: 'unavailable', reason: 'timeout' });
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it('resolves unavailable when auth throws', async () => {
		const r = await probeUser(async () => { throw new Error('fetch failed'); }, 200);
		expect(r).toEqual({ kind: 'unavailable', reason: 'fetch failed' });
	});
});

describe('hasSessionCookie', () => {
	it('detects the supabase auth cookie including chunked variants', () => {
		expect(hasSessionCookie(fakeRequest(['sb-abc-auth-token']))).toBe(true);
		expect(hasSessionCookie(fakeRequest(['sb-abc-auth-token.0', 'sb-abc-auth-token.1']))).toBe(true);
	});
	it('is false with unrelated cookies', () => {
		expect(hasSessionCookie(fakeRequest(['_ga', 'theme']))).toBe(false);
		expect(hasSessionCookie(fakeRequest([]))).toBe(false);
	});
});

describe('isPublic', () => {
	it('matches on segment boundaries only', () => {
		expect(isPublic('/auth/login')).toBe(true);
		expect(isPublic('/api/health')).toBe(true);
		expect(isPublic('/authorize')).toBe(false);
		expect(isPublic('/the-work')).toBe(false);
	});
	it('opens the Proof Library door (0160) and nothing beside it', () => {
		expect(isPublic('/api/proof/slot/home.case_studies')).toBe(true);
		expect(isPublic('/api/proof/slots')).toBe(true);
		expect(isPublic('/api/proof/events')).toBe(true);
		expect(isPublic('/api/proofs')).toBe(false);
		expect(isPublic('/prospects/proof')).toBe(false);
	});
});
