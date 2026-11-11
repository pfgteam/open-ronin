import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAcquisitionTools } from './acquisitions';
import { registerCalendarTools } from './calendar';
import { registerClientTools } from './clients';
import { registerContentTools } from './content';
import { registerContentRequestTools } from './contentRequests';
import { registerDataTools } from './data';
import { registerContractTools, registerFinanceTools } from './finance';
import { registerIdentityTools } from './identities';
import { registerSessionTools } from './sessions';
import { registerSpineTools } from './spine';
import { registerTeamTools } from './team';
import { registerWorkTools } from './work';

/** Tool families register here. */
export function registerTools(server: McpServer): void {
	registerAcquisitionTools(server);
	registerCalendarTools(server);
	registerClientTools(server);
	registerContentTools(server);
	registerContentRequestTools(server);
	registerDataTools(server);
	registerFinanceTools(server);
	registerContractTools(server);
	registerIdentityTools(server);
	registerSessionTools(server);
	registerSpineTools(server);
	registerTeamTools(server);
	registerWorkTools(server);
}
