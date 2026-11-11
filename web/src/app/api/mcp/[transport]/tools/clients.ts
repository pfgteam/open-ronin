import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listFullTable } from '@/lib/data/cachedList';
import { BASE_IDS } from '@/lib/data';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError } from '@/lib/mcp/tooling';
import { mapClientRow, parseStatusFilter, type ClientRow } from '@/lib/mcp/mappers/clients';
import { latestAnalysisPerCall } from '@/lib/sessions/analysis';
import { contractToClientMap, isAirtableRecordId, isClientId, sortContractsByPrimacy } from '@/lib/clients/key';
import { pickClientHealth, type HealthScoreRow } from '@/lib/health/shared';

const FIELDS = ['Client', 'Client Status', 'Industry', 'Packages', 'Acct Lead', 'Media Specialist', 'Client Health', 'End of Service'];
const STATUS = z.enum(['active', '30-day', '60-day', 'hold', 'post-contract', 'closed', 'internal', 'all']).optional();
const LIMIT = z.number().int().min(1).max(200).default(50);

type ContractRow = {
	id: string;
	client_id: string;
	airtable_contract_id: string | null;
	package: string | null;
	starts_on: string | null;
	ends_on: string | null;
	status: string;
};

/**
 * The Airtable roster joined to the contracts mirror so every row carries
 * BOTH keys: airtable_contract_id (the tracker id) and client_id
 * (clients_v2.id, the /clients/[id] route key since the rekey).
 */
async function allClients(): Promise<{ rows: ClientRow[]; truncated: boolean; contracts: ContractRow[] }> {
	const supabase = createServiceRoleClient();
	const [{ rows, truncated }, { data: contracts }] = await Promise.all([
		listFullTable<Record<string, unknown>>(BASE_IDS.CLIENT_CENTRAL, 'Contract Agreement', { fields: FIELDS }),
		supabase.from('contracts').select('id, client_id, airtable_contract_id, package, starts_on, ends_on, status').returns<ContractRow[]>(),
	]);
	const byRec = contractToClientMap(contracts ?? []);
	return { rows: rows.map((r) => mapClientRow(r, byRec.get(r.id) ?? null)), truncated, contracts: contracts ?? [] };
}

export function registerClientTools(server: McpServer): void {
	server.registerTool(
		'list_clients',
		{
			title: 'List clients',
			description:
				'Open Ronin clients from the Contract Agreement tracker joined to the clients_v2 mirror. `status` defaults to "active" = Active + 30-day + 60-day (the playbook definition; unlike the /clients page this does NOT exclude Beacon-package clients). Every row returns BOTH keys: client_id (clients_v2.id — the /clients/[id] URL key and the key finance/contracts/work tools use) and airtable_contract_id (the tracker record id), plus name, status, industry, packages, account lead, media specialist, health, end-of-service and url. Never returns revenue or client contact emails.',
			inputSchema: { status: STATUS, limit: LIMIT },
		},
		async ({ status, limit }, extra) =>
			audited('list_clients', 'clients:read', extra.authInfo, { status, limit }, 'clients', async () => {
				const { rows, truncated } = await allClients();
				const keep = parseStatusFilter(status);
				const filtered = rows.filter((r) => keep(r.client_status ?? undefined));
				return { payload: { rows: filtered.slice(0, limit), count: filtered.length, truncated: truncated || filtered.length > limit }, rows: Math.min(filtered.length, limit) };
			}),
	);

	server.registerTool(
		'get_client',
		{
			title: 'Get one client',
			description:
				'One client by client_id (clients_v2.id, preferred), by Contract Agreement record id (recXXX), or by exact/partial name (case-insensitive). Adds the current health score with the 6-factor breakdown (measured/unmeasured per factor), every contract under the client, and the 10 most recent recorded calls. An ambiguous name throws a tool error naming the candidates — pass client_id instead.',
			inputSchema: {
				client_id: z.string().uuid().optional(),
				airtable_contract_id: z.string().optional(),
				name: z.string().min(2).optional(),
			},
		},
		async ({ client_id, airtable_contract_id, name }, extra) =>
			audited('get_client', 'clients:read', extra.authInfo, { client_id, airtable_contract_id, name }, 'this client', async () => {
				if (!client_id && !airtable_contract_id && !name) throw userError('Pass client_id, airtable_contract_id or name.');
				if (airtable_contract_id && !isAirtableRecordId(airtable_contract_id) && !isClientId(airtable_contract_id)) {
					throw userError('airtable_contract_id must be an Airtable record id (recXXXXXXXXXXXXXX).');
				}
				// A uuid passed in the legacy slot is treated as a client id.
				const wantClient = client_id ?? (isClientId(airtable_contract_id) ? airtable_contract_id : undefined);
				const wantRec = wantClient ? undefined : airtable_contract_id;

				const { rows, contracts } = await allClients();
				let hit: ClientRow | undefined;
				if (wantClient) {
					const mine = rows.filter((r) => r.client_id === wantClient);
					// Several tracker rows can share one client; the primary contract's row speaks for it.
					const order = sortContractsByPrimacy(contracts.filter((c) => c.client_id === wantClient)).map((c) => c.airtable_contract_id);
					hit = mine.sort((a, b) => order.indexOf(a.airtable_contract_id) - order.indexOf(b.airtable_contract_id))[0];
				} else if (wantRec) {
					hit = rows.find((r) => r.airtable_contract_id === wantRec);
				}
				if (!hit && name) {
					const q = name.toLowerCase();
					const exact = rows.filter((r) => (r.client ?? '').toLowerCase() === q);
					const pool = exact.length ? exact : rows.filter((r) => (r.client ?? '').toLowerCase().includes(q));
					// Collapse tracker rows that belong to the same client before calling it ambiguous.
					const distinct = new Map<string, ClientRow>();
					for (const r of pool) {
						const k = r.client_id ?? r.airtable_contract_id;
						if (!distinct.has(k)) distinct.set(k, r);
					}
					if (distinct.size > 1) {
						const names = [...distinct.values()].slice(0, 5).map((r) => `${r.client} (${r.client_id ?? r.airtable_contract_id})`).join(', ');
						throw userError(`That name matches several clients: ${names}. Pass client_id.`);
					}
					hit = [...distinct.values()][0];
				}
				if (!hit) throw userError('No client found for that id or name.');

				const supabase = createServiceRoleClient();
				const clientContracts = hit.client_id
					? sortContractsByPrimacy(contracts.filter((c) => c.client_id === hit.client_id))
					: contracts.filter((c) => c.airtable_contract_id === hit.airtable_contract_id);
				const airtableIds = clientContracts.map((c) => c.airtable_contract_id).filter((v): v is string => !!v);
				if (!airtableIds.includes(hit.airtable_contract_id)) airtableIds.push(hit.airtable_contract_id);
				const clientIds = Array.from(new Set(clientContracts.map((c) => c.client_id)));

				const [{ data: healthRows }, clientRow] = await Promise.all([
					supabase.from('health_scores').select('airtable_contract_id, period_month, total_score, computed_at, factor_breakdown')
						.in('airtable_contract_id', airtableIds).order('period_month', { ascending: false }).limit(24).returns<HealthScoreRow[]>(),
					hit.client_id
						? supabase.from('clients_v2').select('id, display_name, status, org_tag_id').eq('id', hit.client_id).maybeSingle()
						: Promise.resolve({ data: null }),
				]);
				const primaryRec = clientContracts[0]?.airtable_contract_id ?? hit.airtable_contract_id;
				const health = pickClientHealth(healthRows ?? [], primaryRec);

				let recent_calls: unknown[] = [];
				if (clientIds.length) {
					const { data: calls } = await supabase.from('calls').select('id, occurred_at, call_type')
						.in('client_id', clientIds).order('occurred_at', { ascending: false }).limit(10);
					const ids = (calls ?? []).map((c) => c.id as string);
					const { data: analyses } = ids.length
						? await supabase.from('call_analyses').select('call_id, overall_score, created_at').in('call_id', ids)
						: { data: [] as Array<{ call_id: string; overall_score: number; created_at: string }> };
					const latest = latestAnalysisPerCall((analyses ?? []) as Array<{ call_id: string; overall_score: number; created_at: string }>);
					recent_calls = (calls ?? []).map((c) => ({ id: c.id, occurred_at: c.occurred_at, call_type: c.call_type, overall_score: latest.get(c.id as string)?.overall_score ?? null, url: `/team/sessions/${c.id}` }));
				}
				return {
					payload: {
						item: {
							...hit,
							mirror: clientRow.data ? { display_name: clientRow.data.display_name, status: clientRow.data.status, org_tag_id: clientRow.data.org_tag_id } : null,
							health: health
								? {
										period_month: health.period_month,
										is_current_month: health.is_current_month,
										total_score: health.total_score,
										computed_at: health.computed_at,
										scored_contract: health.airtable_contract_id,
										coverage: health.coverage,
										factors: health.factors.map((f) => ({ key: f.key, label: f.label, measured: f.measured, value: f.value, weight_pct: f.weight_pct, note: f.note, pending: f.measured ? null : f.pending })),
									}
								: null,
							// Kept for callers written against the pre-rekey shape.
							latest_health: health ? { period_month: health.period_month, total_score: health.total_score } : null,
							contracts: clientContracts.map(({ id, airtable_contract_id, package: pkg, starts_on, ends_on, status }) => ({ id, airtable_contract_id, package: pkg, starts_on, ends_on, status })),
							recent_calls,
						},
					},
					rows: 1,
				};
			}),
	);
}
