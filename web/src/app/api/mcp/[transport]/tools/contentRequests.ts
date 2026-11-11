import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError, MAX_SCAN } from '@/lib/mcp/tooling';
import { ASSET_TYPES, PRIORITIES, REQUEST_STATUSES, sortQueue } from '@/lib/content-requests/shared';
import { mapContentRequest, REQUEST_COLUMNS, type ContentRequestRow } from '@/lib/mcp/mappers/contentRequests';

// Content request queue over MCP (0110). Read rides clients:read (a request
// is client work, and Domes/Morgan/Pulse already hold it). Filing is a
// spine proposal under content:propose: nothing lands in content_requests
// until a person in the content queue files it at /social/studio/requests.

const LIMIT = z.number().int().min(1).max(200).default(50);
const UUID = z.string().uuid();

type Binding = { identity_slug: string | null };

async function boundIdentity(extra: { authInfo?: { extra?: unknown } }): Promise<string> {
	const consumerId = (extra.authInfo?.extra as { consumerId?: string } | undefined)?.consumerId;
	if (!consumerId) throw userError('No consumer on this request.');
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.from('mcp_consumers').select('identity_slug').eq('id', consumerId).maybeSingle<Binding>();
	if (error) throw new Error(`binding lookup: ${error.message}`);
	if (!data?.identity_slug) {
		throw userError('This consumer is not bound to a spine identity, so it cannot propose. Ask a Open Ronin admin to run mcp_provision_consumer (SPINE_HIRING_PLAN.md).');
	}
	return data.identity_slug;
}

export function registerContentRequestTools(server: McpServer): void {
	server.registerTool(
		'list_content_requests',
		{
			title: 'List content requests',
			description:
				'The content request queue in front of the Content Studio (content_requests). Defaults to open requests (requested / accepted / in_studio) in queue order: soonest due first, undated last, then priority. Each row carries its SLA clock: accept_by (24h after filing) while requested, due_on once accepted, and whether it is late. Filter by client, status, or asset type.',
			inputSchema: {
				client_id: UUID.optional(),
				status: z.enum(REQUEST_STATUSES).optional(),
				asset_type: z.enum(ASSET_TYPES).optional(),
				include_closed: z.boolean().default(false),
				limit: LIMIT,
			},
		},
		async ({ client_id, status, asset_type, include_closed, limit }, extra) =>
			audited('list_content_requests', 'clients:read', extra.authInfo, { client_id, status, asset_type, include_closed, limit }, 'content requests', async () => {
				const supabase = createServiceRoleClient();
				let query = supabase.from('content_requests').select(REQUEST_COLUMNS).limit(MAX_SCAN);
				if (client_id) query = query.eq('client_id', client_id);
				if (status) query = query.eq('status', status);
				else if (!include_closed) query = query.in('status', ['requested', 'accepted', 'in_studio']);
				if (asset_type) query = query.eq('asset_type', asset_type);
				const { data, error } = await query.returns<ContentRequestRow[]>();
				if (error) throw error;
				const rows = sortQueue(data ?? []);
				const truncated = rows.length > limit || rows.length >= MAX_SCAN;
				const mapped = rows.slice(0, limit).map((r) => mapContentRequest(r));
				return { payload: { rows: mapped, count: rows.length, truncated }, rows: mapped.length };
			}),
	);

	server.registerTool(
		'propose_content_request',
		{
			title: 'Propose a content request',
			description:
				'Files a content request for the content queue to accept: asset type (post, video, clip, thumbnail, podcast_episode, other), a one-line title, the brief, optional client_id, due_on and priority. Nothing is written until a person in the content queue files it at /social/studio/requests; filing starts the 24 hour accept clock. Returns the proposal id. Give reasoning a reviewer can act on (who asked, where, why now).',
			inputSchema: {
				asset_type: z.enum(ASSET_TYPES),
				title: z.string().min(3).max(200),
				brief: z.string().max(5000).optional(),
				client_id: UUID.optional(),
				due_on: z.string().date().optional(),
				priority: z.enum(PRIORITIES).default('normal'),
				reasoning: z.string().min(10).max(4000),
			},
		},
		async ({ asset_type, title, brief, client_id, due_on, priority, reasoning }, extra) =>
			audited('propose_content_request', 'content:propose', extra.authInfo, { asset_type, title, client_id, due_on, priority }, 'this proposal', async () => {
				const identity = await boundIdentity(extra);
				const supabase = createServiceRoleClient();
				if (client_id) {
					const { data: client } = await supabase.from('clients_v2').select('id').eq('id', client_id).maybeSingle<{ id: string }>();
					if (!client) throw userError(`No client with id ${client_id}. Use list_clients to find the clients_v2 id.`);
				}
				const { data, error } = await supabase.rpc('spine_propose_action', {
					p_action_type: 'content_request.create',
					p_identity_slug: identity,
					p_skill_run_id: null,
					p_work_item_id: null,
					p_reasoning: reasoning,
					p_payload: { asset_type, title, brief: brief ?? null, client_id: client_id ?? null, due_on: due_on ?? null, priority },
				});
				if (error) {
					if (/is not enabled|action_types/.test(error.message)) throw userError(error.message);
					throw new Error(error.message);
				}
				return { payload: { proposal_id: data as string, status: 'pending', review_url: '/social/studio/requests' }, rows: 1 };
			}),
	);
}
