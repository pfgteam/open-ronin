import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError } from '@/lib/mcp/tooling';
import { identityFlags, type RegistryIdentity } from '@/lib/spine/identityRegistryShared';

// The `spine:identities:read` family (migration 0106): the agent-identity
// registry for the audit/oversight bots (Ops bot, Auditor, Senior: BOT_ROSTER_
// SYNTHESIS Tier 2). They read Open Ronin's spine state; they do not become
// spine identities themselves. Output never includes token hashes (the SQL
// function does not select them) and consumer rows carry scopes + last use
// only.

export function registerIdentityTools(server: McpServer): void {
	server.registerTool(
		'list_identities',
		{
			title: 'List spine identities',
			description:
				'Every agent identity on the Open Ronin spine (spine.agent_identities) with its owner, tier, scope ceiling, bound MCP consumers (scopes, created, last used, revoked), Postgres table grants and audit activity. Adds hygiene `flags` per identity (disabled, no owner, no live token, token never used, token idle 90d+, token exceeds ceiling). Filter with `flagged_only` or `slug`.',
			inputSchema: {
				slug: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
				flagged_only: z.boolean().default(false),
				include_revoked: z.boolean().default(false),
			},
		},
		async ({ slug, flagged_only, include_revoked }, extra) =>
			audited('list_identities', 'spine:identities:read', extra.authInfo, { slug, flagged_only, include_revoked }, 'the identity registry', async () => {
				const supabase = createServiceRoleClient();
				const { data, error } = await supabase.rpc('mcp_identity_registry');
				if (error) throw error;
				let rows = ((data ?? []) as RegistryIdentity[]).map((r) => ({
					...r,
					consumers: include_revoked ? r.consumers : r.consumers.filter((c) => !c.revoked_at),
					flags: identityFlags(r),
				}));
				if (slug) {
					rows = rows.filter((r) => r.slug === slug);
					if (rows.length === 0) throw userError(`No spine identity with slug ${slug}.`);
				}
				if (flagged_only) rows = rows.filter((r) => r.flags.length > 0);
				return { payload: { rows, count: rows.length, truncated: false }, rows: rows.length };
			}),
	);
}
