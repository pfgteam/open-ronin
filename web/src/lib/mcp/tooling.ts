// Shared shape for every tool: scope check → run → audit → JSON text result.
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { recordAudit } from '@/lib/audit';
import { requireScope, type McpScope } from './scopes';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Cap for queries with no server-side pagination (team_directory, list_work_items):
 * PostgREST silently caps an unbounded select at 1000 rows, so without an
 * explicit `.limit()` a scan past that point would look complete when it
 * isn't. Set well above any real Open Ronin table size today so it only bites a
 * genuine runaway.
 */
export const MAX_SCAN = 2000;

export function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
export function fail(message: string): ToolResult {
	return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * An error whose message is SAFE to show the agent verbatim (bad input,
 * ambiguity). Anything else thrown inside a tool body is treated as an
 * upstream failure and hidden behind the generic sentence.
 */
export class UserError extends Error {
	readonly user = true as const;
}
export const userError = (message: string) => new UserError(message);

/**
 * Runs a tool body under its scope, audits the call (awaited), and converts
 * upstream failures into the spec's English sentence — raw errors go to the
 * server log only. A `UserError` passes through verbatim.
 */
export async function audited<A extends Record<string, unknown>>(
	tool: string,
	scope: McpScope | null,
	authInfo: AuthInfo | undefined,
	args: A,
	thing: string,
	body: (args: A) => Promise<{ payload: unknown; rows: number }>,
): Promise<ToolResult> {
	const denied = requireScope(authInfo, scope);
	if (denied) return fail(denied);
	const started = Date.now();
	try {
		const { payload, rows } = await body(args);
		await recordAudit({
			actor_id: null,
			entity_kind: 'mcp',
			entity_ref: `mcp_consumers/${authInfo!.clientId}`,
			action: `mcp.tool.${tool}`,
			diff: { args, rows, ms: Date.now() - started },
		});
		return ok(payload);
	} catch (err) {
		const isUser = err instanceof UserError;
		if (!isUser) console.error(`[mcp] ${tool} failed:`, err);
		await recordAudit({
			actor_id: null,
			entity_kind: 'mcp',
			entity_ref: `mcp_consumers/${authInfo!.clientId}`,
			action: `mcp.tool.${tool}`,
			diff: { args, ms: Date.now() - started, user_error: isUser ? err.message : undefined },
			status: 'error',
		});
		return fail(isUser ? err.message : `Could not read ${thing} right now — try again in a minute.`);
	}
}
