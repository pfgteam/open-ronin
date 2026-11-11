import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError } from '@/lib/mcp/tooling';

// Spine gateway tools (migration 0059). The consumer never names an identity:
// `act` and `sub` come from the consumer row (bound by an admin through
// mcp_bind_consumer_identity), and the database asserts the read as that
// identity's Postgres role. A consumer without a binding gets a plain refusal.

type Binding = { identity_slug: string | null; owner_profile_id: string | null };

type GatewayResult = {
	status: 'ok' | 'denied' | 'error';
	audit_id: number;
	act: string;
	sub?: string;
	work_item_id?: string | null;
	rows?: number;
	row?: Record<string, unknown> | null;
	error?: string;
};

async function bindingFor(consumerId: string): Promise<Binding> {
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase
		.from('mcp_consumers')
		.select('identity_slug, owner_profile_id')
		.eq('id', consumerId)
		.maybeSingle<Binding>();
	if (error) throw new Error(`binding lookup: ${error.message}`);
	return data ?? { identity_slug: null, owner_profile_id: null };
}

export function registerSpineTools(server: McpServer): void {
	server.registerTool(
		'read_transcript_as_identity',
		{
			title: 'Read a call transcript through the spine',
			description:
				'Reads one call transcript as this consumer\'s bound spine identity. Requires a work_item_id (the work the read serves). The database asserts the identity and writes the sub/act/work_item audit row; the consumer cannot choose a different identity. Returns the transcript text plus the audit id.',
			inputSchema: {
				call_id: z.string().uuid(),
				work_item_id: z.string().uuid(),
			},
		},
		async ({ call_id, work_item_id }, extra) =>
			audited(
				'read_transcript_as_identity',
				'spine:transcripts:read',
				extra.authInfo,
				{ call_id, work_item_id },
				'this transcript',
				async () => {
					const consumerId = (extra.authInfo?.extra as { consumerId?: string } | undefined)?.consumerId;
					if (!consumerId) throw userError('No consumer on this request.');
					const binding = await bindingFor(consumerId);
					if (!binding.identity_slug || !binding.owner_profile_id) {
						throw userError('This consumer is not bound to a spine identity. Ask a Open Ronin admin to run mcp_bind_consumer_identity.');
					}
					const supabase = createServiceRoleClient();
					const { data, error } = await supabase.rpc('spine_gateway_read_transcript', {
						p_identity_slug: binding.identity_slug,
						p_sub: binding.owner_profile_id,
						p_work_item_id: work_item_id,
						p_call_id: call_id,
						p_event_id: null,
					});
					if (error) {
						// Anchor/identity validation errors are safe and useful to the agent.
						if (/unknown work item|unknown identity|sub must be/.test(error.message)) throw userError(error.message);
						throw new Error(error.message);
					}
					const result = data as GatewayResult;
					if (result.status !== 'ok') {
						throw userError(`Read ${result.status}: ${result.error ?? 'no detail'} (audit ${result.audit_id}).`);
					}
					return {
						payload: {
							audit_id: result.audit_id,
							act: result.act,
							sub: result.sub,
							work_item_id: result.work_item_id,
							transcript: result.row,
						},
						rows: result.rows ?? 0,
					};
				},
			),
	);
}
