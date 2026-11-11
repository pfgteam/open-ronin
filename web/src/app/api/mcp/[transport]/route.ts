// Open Ronin MCP server (spec 2026-09-02). Streamable HTTP only — SSE is
// disabled, so no Redis. Mounted under /api/mcp: with basePath '/api/mcp'
// mcp-handler derives the endpoint /api/mcp/mcp; the [transport] segment is
// what it routes on. Auth is a per-consumer bearer token (0057), verified
// before any tool runs; tools are registered in ./tools/*.
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { verifyMcpToken } from '@/lib/mcp/auth';
import { registerTools } from './tools';

const handler = createMcpHandler(
	(server) => {
		registerTools(server);
	},
	{ serverInfo: { name: 'open-ronin', version: '1.0.0' } },
	{ basePath: '/api/mcp', disableSse: true, maxDuration: 30, verboseLogs: false },
);

const authed = withMcpAuth(handler, verifyMcpToken, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
export const dynamic = 'force-dynamic';
// Vercel reads the function timeout from THIS export. The `maxDuration` in
// the handler config above only bounds the (disabled) SSE stream.
export const maxDuration = 30;
