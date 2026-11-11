import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// Mirror of public.mcp_scopes_ok() (latest: migration 0110). Add here AND
// there, in the same change, or a minted consumer will carry a scope the
// route cannot check (or the reverse).
export const SCOPES = [
	'clients:read',
	'sessions:read',
	'team:read',
	'work:read',
	'spine:transcripts:read',
	'calendar:read',
	'content:run',
	'content:propose',
	'data:read',
	'spine:identities:read',
	'acquisitions:read',
	'acquisitions:propose',
	'finance:read',
	'contracts:read',
] as const;
export type McpScope = (typeof SCOPES)[number];

/** null = allowed; otherwise the English error to return to the agent. Pass scope null to require only a valid consumer. */
export function requireScope(authInfo: AuthInfo | undefined, scope: McpScope | null): string | null {
	if (!authInfo) return 'Unauthorized — no consumer identity on this request.';
	if (scope === null) return null;
	if (authInfo.scopes.includes(scope)) return null;
	return `This consumer lacks the '${scope}' scope. Ask a Open Ronin admin to grant it.`;
}
