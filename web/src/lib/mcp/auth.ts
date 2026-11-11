// Bearer-token verifier for the MCP route. Tokens are minted by
// mcp_mint_consumer (0057) and stored ONLY as sha-256 hex; we hash the
// presented token the same way and look the hash up with the service role.
import { createHash } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createServiceRoleClient } from '@/lib/supabase/server';

export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Minted tokens (32 random bytes, base64url) are 43 chars; the window is
// deliberately loose around that so it just rejects garbage cheaply, not a
// real format check.
const MIN_BEARER = 20;
const MAX_BEARER = 200;

export async function verifyMcpToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
	if (!bearer || bearer.length < MIN_BEARER || bearer.length > MAX_BEARER) return undefined;
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase
		.from('mcp_consumers')
		.select('id, slug, scopes, last_used_at')
		.eq('token_hash', hashToken(bearer))
		.is('revoked_at', null)
		.maybeSingle();
	if (error) {
		console.error('[mcp] consumer lookup failed:', error.message);
		return undefined; // fail closed
	}
	if (!data) return undefined;
	// Best-effort usage stamp; a failure here must never fail the request.
	// Every MCP message (initialize, tools/list, each call) passes through
	// here, so only write when the stamp is older than 5 minutes.
	const last = data.last_used_at ? Date.parse(data.last_used_at as string) : 0;
	if (Date.now() - last > 5 * 60_000) {
		const { error: touchError } = await supabase
			.from('mcp_consumers')
			.update({ last_used_at: new Date().toISOString() })
			.eq('id', data.id);
		if (touchError) console.error('[mcp] last_used_at update failed:', touchError.message);
	}
	return {
		token: bearer,
		clientId: data.slug as string,
		scopes: (data.scopes as string[]) ?? [],
		extra: { consumerId: data.id as string },
	};
}
