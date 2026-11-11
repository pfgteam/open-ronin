import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError, MAX_SCAN } from '@/lib/mcp/tooling';
import { businessToday } from '@/lib/format';
import { STATUS_KIND_ALIASES } from '@/lib/work/statusKindAliases';
import { WORK_ITEM_KINDS, BUG_SEVERITIES, BUG_ENVIRONMENTS, mapWorkItem, mapBug, isOverdue, terminalKey, buildTerminalSet, resolveTerminalKind, type ProjectRow, type BugProjectRow } from '@/lib/mcp/mappers/work';

const LIMIT = z.number().int().min(1).max(200).default(50);

const PROJECT_COLUMNS = 'id, name, kind, status, priority, owner_id, starts_at, ends_at, description_md, client_id';
// Bug fields live in the 0162 columns (severity, environment, is_regression).
const BUG_COLUMNS = `${PROJECT_COLUMNS}, severity, environment, is_regression, created_at, updated_at`;

const BUG_TERMINAL = new Set(['fixed', 'wont_fix', 'duplicate']); // 0162 bug status set
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type OwnerLite = { id: string; first_name: string | null; last_name: string | null; email: string };

async function ownersById(supabase: ReturnType<typeof createServiceRoleClient>, ids: (string | null)[]): Promise<Map<string, OwnerLite>> {
	const unique = [...new Set(ids.filter((v): v is string => !!v))];
	if (unique.length === 0) return new Map();
	const { data } = await supabase.from('profiles').select('id, first_name, last_name, email').in('id', unique).returns<OwnerLite[]>();
	return new Map((data ?? []).map((o) => [o.id, o]));
}

function ownerLabels(owner: OwnerLite | undefined) {
	return {
		ownerName: owner ? [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email : null,
		ownerEmail: owner?.email ?? null,
	};
}

type StatusRow = { slug: string; is_terminal: boolean; work_item_status_configs: { kind: string } | { kind: string }[] | null };

export function registerWorkTools(server: McpServer): void {
	server.registerTool(
		'list_bugs',
		{
			title: 'List bugs',
			description:
				'QA findings: work items of kind `bug` (0162) with severity (critical/high/medium/low), environment (free text: production, a browser, a device) and a regression flag. Defaults to open bugs only (status not fixed/wont_fix/duplicate). Ordered by severity (critical first) then newest. Same allowlist as list_work_items: never returns notes or planning fields.',
			inputSchema: {
				severity: z.enum(BUG_SEVERITIES).optional(),
				environment: z.enum(BUG_ENVIRONMENTS).optional(),
				regression_only: z.boolean().default(false),
				status: z.string().optional(),
				include_closed: z.boolean().default(false),
				owner_email: z.string().email().optional(),
				limit: LIMIT,
			},
		},
		async ({ severity, environment, regression_only, status, include_closed, owner_email, limit }, extra) =>
			audited(
				'list_bugs',
				'work:read',
				extra.authInfo,
				{ severity, environment, regression_only, status, include_closed, owner_email, limit },
				'bugs',
				async () => {
					const supabase = createServiceRoleClient();
					let ownerId: string | null = null;
					if (owner_email) {
						const { data: owner } = await supabase.from('profiles').select('id').eq('email', owner_email).maybeSingle<{ id: string }>();
						if (!owner) throw userError(`No team member found with email ${owner_email}.`);
						ownerId = owner.id;
					}
					let query = supabase.from('projects').select(BUG_COLUMNS).eq('kind', 'bug').eq('archived', false).limit(MAX_SCAN);
					if (severity) query = query.eq('severity', severity);
					if (environment) query = query.eq('environment', environment);
					if (regression_only) query = query.eq('is_regression', true);
					if (status) query = query.eq('status', status);
					if (ownerId) query = query.eq('owner_id', ownerId);
					const { data, error } = await query.order('created_at', { ascending: false }).returns<BugProjectRow[]>();
					if (error) {
						if (error.code === '42703') throw userError('Bugs are not enabled yet (migration 0111 is not applied).');
						throw error;
					}
					let rows = data ?? [];
					if (!status && !include_closed) rows = rows.filter((r) => !BUG_TERMINAL.has(r.status));
					rows.sort((a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 9) - (SEVERITY_RANK[b.severity ?? ''] ?? 9) || b.created_at.localeCompare(a.created_at));
					const truncated = rows.length > limit || (data ?? []).length >= MAX_SCAN;
					const page = rows.slice(0, limit);
					const owners = await ownersById(supabase, page.map((p) => p.owner_id));
					const mapped = page.map((p) => mapBug(p, ownerLabels(p.owner_id ? owners.get(p.owner_id) : undefined)));
					return { payload: { rows: mapped, count: rows.length, truncated }, rows: mapped.length };
				},
			),
	);

	server.registerTool(
		'list_work_items',
		{
			title: 'List work items',
			description:
				'Work items (projects table) across all 17 kinds — goals, priorities, tasks, campaigns, client work, bugs and more. Defaults to excluding items whose status is terminal for their kind (done/cancelled equivalents), unless `status` is given explicitly. Filter by owner email, kind, status, overdue-only, or the client (clients_v2 id). Ordered by end date (soonest first, nulls last). Never returns notes, lead/lag measures or process-action fields. For bug severity/environment use list_bugs.',
			inputSchema: {
				owner_email: z.string().email().optional(),
				kind: z.enum(WORK_ITEM_KINDS).optional(),
				status: z.string().optional(),
				overdue_only: z.boolean().default(false),
				client_id: z.string().uuid().optional(),
				limit: LIMIT,
			},
		},
		async ({ owner_email, kind, status, overdue_only, client_id, limit }, extra) =>
			audited(
				'list_work_items',
				'work:read',
				extra.authInfo,
				{ owner_email, kind, status, overdue_only, client_id, limit },
				'work items',
				async () => {
					const supabase = createServiceRoleClient();

					let ownerId: string | null = null;
					if (owner_email) {
						const { data: owner } = await supabase.from('profiles').select('id').eq('email', owner_email).maybeSingle<{ id: string }>();
						if (!owner) throw userError(`No team member found with email ${owner_email}.`);
						ownerId = owner.id;
					}

					let query = supabase.from('projects').select(PROJECT_COLUMNS).eq('archived', false).limit(MAX_SCAN);
					if (ownerId) query = query.eq('owner_id', ownerId);
					if (kind) query = query.eq('kind', kind);
					if (status) query = query.eq('status', status);
					if (client_id) query = query.eq('client_id', client_id);
					query = query.order('ends_at', { ascending: true, nullsFirst: false });

					const [{ data: projects, error }, { data: statusRows }] = await Promise.all([
						query.returns<ProjectRow[]>(),
						supabase
							.from('work_item_statuses')
							.select('slug, is_terminal, work_item_status_configs!inner(kind)')
							.returns<StatusRow[]>(),
					]);
					if (error) throw error;

					const flatStatusRows = (statusRows ?? []).map((s) => {
						const cfg = s.work_item_status_configs;
						const k = Array.isArray(cfg) ? cfg[0]?.kind : cfg?.kind;
						return { kind: k ?? '', slug: s.slug, is_terminal: s.is_terminal };
					}).filter((s) => s.kind);
					const terminal = buildTerminalSet(flatStatusRows);
					const kindsWithOwnConfig = new Set(flatStatusRows.map((s) => s.kind));
					// Kinds without their own status config inherit a sibling kind's set
					// (the-work/_lib.ts:49-61) — but only when that sibling itself has a
					// config, same as the page. See resolveTerminalKind.
					const terminalKindFor = (itemKind: string) =>
						resolveTerminalKind(itemKind, kindsWithOwnConfig, STATUS_KIND_ALIASES);

					const today = businessToday();
					let rows = projects ?? [];

					if (!status) {
						rows = rows.filter((p) => {
							const effectiveKind = terminalKindFor(p.kind);
							return !terminal.has(terminalKey(effectiveKind, p.status));
						});
					}

					if (overdue_only) {
						rows = rows.filter((p) => {
							const effectiveKind = terminalKindFor(p.kind);
							return isOverdue(p.ends_at, today, terminal.has(terminalKey(effectiveKind, p.status)));
						});
					}

					const truncated = rows.length > limit || (projects ?? []).length >= MAX_SCAN;
					const page = rows.slice(0, limit);

					const ownerIds = [...new Set(page.map((p) => p.owner_id).filter((v): v is string => !!v))];
					const { data: owners } = ownerIds.length
						? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', ownerIds).returns<
								{ id: string; first_name: string | null; last_name: string | null; email: string }[]
							>()
						: { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string }[] };
					const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));

					const mapped = page.map((p) => {
						const owner = p.owner_id ? ownerById.get(p.owner_id) : undefined;
						return mapWorkItem(p, {
							ownerName: owner ? [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email : null,
							ownerEmail: owner?.email ?? null,
						});
					});

					return { payload: { rows: mapped, count: rows.length, truncated }, rows: mapped.length };
				},
			),
	);
}
