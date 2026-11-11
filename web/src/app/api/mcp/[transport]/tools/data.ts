// The `data:read` family: a generic reader over the allowlist in
// lib/mcp/readableTables.ts. Three tools — discover (list_tables), inspect
// (describe_table), read (query_table) — so an agent can find its way around
// without a per-table tool for each of ~140 tables.
//
// The allowlist is the security boundary: these tools read with the SERVICE
// ROLE, which bypasses RLS. Anything absent from READABLE is denied, and
// REDACTED_COLUMNS strips comp/PII columns from tables that are otherwise
// fine to read. See readableTables.ts for what is deliberately excluded.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError } from '@/lib/mcp/tooling';
import {
	READABLE_TABLES,
	redactRows,
	redactedFor,
	ruleFor,
	splitRef,
	type ColumnRule,
} from '@/lib/mcp/readableTables';

const LIMIT = z.number().int().min(1).max(200).default(50);

/** PostgREST only serves `public` here; comms/spine go through the 0092 RPC. */
const RPC_SCHEMAS = new Set(['comms', 'spine']);

/**
 * Resolves the column rule, or refuses. Same sentence for a denied table and
 * an unknown one: an agent must not be able to probe for which sensitive
 * tables exist by reading the error. Returns the rule so callers get the
 * narrowed type (null = all columns) without a second lookup.
 */
function readableRule(table: string): ColumnRule {
	const rule = ruleFor(table);
	if (rule === undefined) {
		throw userError(
			`'${table}' is not readable through this tool. Call list_tables to see what is.`,
		);
	}
	return rule;
}

type Filter = { column: string; op: string; value: string };

const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is'] as const;

export function registerDataTools(server: McpServer): void {
	server.registerTool(
		'list_tables',
		{
			title: 'List readable tables',
			description:
				'Every table this consumer can read through query_table, as "schema.table". The list is an allowlist: compensation (profile_sensitive, payroll_runs, comp_reconciliation), OAuth credentials (ghl_connections, google_calendar_connections) and MCP token material are deliberately absent and cannot be read by any tool. Optionally filter by a substring.',
			inputSchema: { contains: z.string().optional() },
		},
		async ({ contains }, extra) =>
			audited('list_tables', 'data:read', extra.authInfo, { contains }, 'the table list', async () => {
				const needle = contains?.toLowerCase();
				const tables = needle
					? READABLE_TABLES.filter((t) => t.toLowerCase().includes(needle))
					: READABLE_TABLES;
				return { payload: { tables, count: tables.length }, rows: tables.length };
			}),
	);

	server.registerTool(
		'describe_table',
		{
			title: 'Describe a readable table',
			description:
				'Column names and types for one allowlisted table, so a query_table call can name real columns. Redacted columns (compensation, personal phone numbers) are reported under `redacted` and never returned as data.',
			inputSchema: { table: z.string() },
		},
		async ({ table }, extra) =>
			audited('describe_table', 'data:read', extra.authInfo, { table }, 'this table', async () => {
				const rule = readableRule(table);
				const { schema, table: name } = splitRef(table);
				const supabase = createServiceRoleClient();
				const { data, error } = await supabase.rpc('mcp_describe_table', {
					p_schema: schema,
					p_table: name,
				});
				if (error) throw error;

				const redacted = redactedFor(table);
				// 0092 names its OUT params col_* so they cannot collide with the
				// information_schema columns of the same name inside the function.
				const all = (data ?? []) as { col_name: string; col_type: string; col_nullable: string }[];
				const visible = all
					.filter((c) => (rule === null ? true : rule.includes(c.col_name)))
					.filter((c) => !redacted.includes(c.col_name))
					.map((c) => ({ column: c.col_name, type: c.col_type, nullable: c.col_nullable === 'YES' }));

				if (visible.length === 0) {
					throw userError(`No readable columns on ${schema}.${name}.`);
				}

				return {
					payload: { table: `${schema}.${name}`, columns: visible, redacted },
					rows: visible.length,
				};
			}),
	);

	server.registerTool(
		'query_table',
		{
			title: 'Query a readable table',
			description:
				'Read rows from one allowlisted table. Filters are column/op/value triples (ops: eq, neq, gt, gte, lt, lte, like, ilike, is) and combine with AND. Use describe_table first to learn the column names. Returns at most 200 rows per call — page with `offset`. Read-only: there is no way to write through this tool.',
			inputSchema: {
				table: z.string(),
				columns: z.array(z.string()).optional(),
				filters: z
					.array(z.object({ column: z.string(), op: z.enum(FILTER_OPS), value: z.string() }))
					.max(8)
					.optional(),
				order_by: z.string().optional(),
				descending: z.boolean().default(false),
				limit: LIMIT,
				offset: z.number().int().min(0).default(0),
			},
		},
		async ({ table, columns, filters, order_by, descending, limit, offset }, extra) =>
			audited(
				'query_table',
				'data:read',
				extra.authInfo,
				{ table, columns, filters, order_by, descending, limit, offset },
				'this table',
				async () => {
					const rule = readableRule(table);
					const { schema, table: name } = splitRef(table);
					const redacted = redactedFor(table);
					const supabase = createServiceRoleClient();

					// A caller naming a redacted column should hear why, rather than
					// silently receiving a row without it.
					const blocked = (columns ?? []).filter((c) => redacted.includes(c));
					if (blocked.length > 0) {
						throw userError(
							`Column(s) ${blocked.join(', ')} on ${schema}.${name} are redacted and cannot be read.`,
						);
					}
					if (rule !== null && columns) {
						const off = columns.filter((c) => !rule.includes(c));
						if (off.length > 0) {
							throw userError(
								`Column(s) ${off.join(', ')} are not readable on ${schema}.${name}. Call describe_table for the list.`,
							);
						}
					}

					// comms/spine are not on PostgREST here (406) — 0092's RPC reads
					// them. Filters and column picks are applied after the fetch.
					if (RPC_SCHEMAS.has(schema)) {
						if (filters?.length) {
							throw userError(
								`Filters are not supported on ${schema}.${name} yet — fetch a page and filter client-side.`,
							);
						}
						const { data, error } = await supabase.rpc('mcp_read_table', {
							p_schema: schema,
							p_table: name,
							p_limit: limit,
							p_offset: offset,
							p_order: order_by ?? null,
							p_desc: descending,
						});
						if (error) throw error;
						let rows = (data ?? []) as Record<string, unknown>[];
						rows = redactRows(table, rows);
						if (rule !== null) {
							const keep = new Set(columns ?? rule);
							rows = rows.map((r) =>
								Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))),
							);
						} else if (columns) {
							const keep = new Set(columns);
							rows = rows.map((r) =>
								Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))),
							);
						}
						return { payload: { rows, count: rows.length, table: `${schema}.${name}` }, rows: rows.length };
					}

					// Never send '*': it would fetch redacted columns over the wire
					// before we strip them. Ask only for what the caller may see.
					const select = columns?.length
						? columns.join(', ')
						: rule !== null
							? rule.filter((c) => !redacted.includes(c)).join(', ')
							: '*';

					let query = supabase.from(name).select(select, { count: 'exact' });
					for (const f of (filters ?? []) as Filter[]) {
						if (redacted.includes(f.column)) {
							throw userError(`Cannot filter on redacted column ${f.column}.`);
						}
						query =
							f.op === 'is'
								? query.is(f.column, f.value === 'null' ? null : f.value === 'true')
								: query.filter(f.column, f.op, f.value);
					}
					if (order_by) query = query.order(order_by, { ascending: !descending });
					query = query.range(offset, offset + limit - 1);

					const { data, error, count } = await query;
					// A bad column or operator is the agent's mistake to fix, so the
					// message goes back verbatim rather than behind the generic line.
					if (error) throw userError(error.message);

					// The select string is built at runtime, so supabase-js cannot
					// infer a row type and widens to its error shape; the query
					// already threw above if it actually failed.
					const rows = redactRows(table, (data ?? []) as unknown as Record<string, unknown>[]);
					return {
						payload: { rows, count: rows.length, total: count ?? null, table: `${schema}.${name}` },
						rows: rows.length,
					};
				},
			),
	);
}
