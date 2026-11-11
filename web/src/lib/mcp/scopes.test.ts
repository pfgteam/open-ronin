import { describe, expect, it } from 'vitest';
import { requireScope, SCOPES } from './scopes';

const auth = (scopes: string[]) => ({ token: 't', clientId: 'hermes', scopes });

describe('requireScope', () => {
	it('returns null when the consumer has the scope', () => {
		expect(requireScope(auth(['clients:read']), 'clients:read')).toBeNull();
	});
	it('names the missing scope in English', () => {
		expect(requireScope(auth(['team:read']), 'sessions:read'))
			.toBe("This consumer lacks the 'sessions:read' scope. Ask a Open Ronin admin to grant it.");
	});
	it('treats a missing authInfo as unauthorized, not as a crash', () => {
		expect(requireScope(undefined, 'work:read')).toBe('Unauthorized — no consumer identity on this request.');
	});
	it('knows the calendar:read scope', () => {
		expect(requireScope(auth(['calendar:read']), 'calendar:read')).toBeNull();
		expect(requireScope(auth(['work:read']), 'calendar:read'))
			.toBe("This consumer lacks the 'calendar:read' scope. Ask a Open Ronin admin to grant it.");
	});
	it('knows the content:run scope and a null scope means any valid consumer', () => {
		expect(requireScope(auth(['content:run']), 'content:run')).toBeNull();
		expect(requireScope(auth(['clients:read']), 'content:run'))
			.toBe("This consumer lacks the 'content:run' scope. Ask a Open Ronin admin to grant it.");
		expect(requireScope(auth([]), null)).toBeNull();
		expect(requireScope(undefined, null)).toBe('Unauthorized — no consumer identity on this request.');
	});
	it('knows the 0106 scopes (identities registry, acquisitions, finance, contracts)', () => {
		for (const s of ['spine:identities:read', 'acquisitions:read', 'acquisitions:propose', 'finance:read', 'contracts:read'] as const) {
			expect(requireScope(auth([s]), s)).toBeNull();
			expect(requireScope(auth(['data:read']), s)).toBe(`This consumer lacks the '${s}' scope. Ask a Open Ronin admin to grant it.`);
		}
	});
	it('knows the 0110 content:propose scope', () => {
		expect(requireScope(auth(['content:propose']), 'content:propose')).toBeNull();
		expect(requireScope(auth(['content:run']), 'content:propose')).toBe("This consumer lacks the 'content:propose' scope. Ask a Open Ronin admin to grant it.");
	});
	it('mirrors public.mcp_scopes_ok in the latest migration', async () => {
		// The SQL allowlist is the source of truth; the TS list must not drift.
		const { readFileSync, readdirSync } = await import('node:fs');
		const { join } = await import('node:path');
		const dir = join(process.cwd(), '..', 'supabase', 'migrations');
		const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
		let latest: string | null = null;
		for (const f of files) {
			const text = readFileSync(join(dir, f), 'utf8');
			if (/function public\.mcp_scopes_ok/i.test(text)) latest = text;
		}
		expect(latest).not.toBeNull();
		const body = latest!.split(/CREATE FUNCTION public\.mcp_scopes_ok/).pop()!.split('$$;')[0];
		const inSql = [...body.matchAll(/'([a-z]+:[a-z]+(?::[a-z]+)?)'/g)].map((m) => m[1]).sort();
		expect([...SCOPES].sort()).toEqual(inSql);
	});
});
