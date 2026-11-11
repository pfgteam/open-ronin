import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));

import { recordAudit } from '@/lib/audit';
import { audited, userError } from './tooling';

const auth = { token: 't', clientId: 'hermes', scopes: ['clients:read'] };

describe('audited', () => {
	it('returns the payload as JSON text and audits with the row count', async () => {
		const res = await audited('list_clients', 'clients:read', auth, { limit: 5 }, 'clients', async () => ({ payload: { rows: [1, 2] }, rows: 2 }));
		expect(res.isError).toBeUndefined();
		expect(JSON.parse(res.content[0].text)).toEqual({ rows: [1, 2] });
		expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ entity_kind: 'mcp', entity_ref: 'mcp_consumers/hermes', action: 'mcp.tool.list_clients', diff: expect.objectContaining({ rows: 2 }) }));
	});
	it('refuses a missing scope before running the body', async () => {
		const body = vi.fn();
		const res = await audited('list_calls', 'sessions:read', auth, {}, 'calls', body);
		expect(res.isError).toBe(true);
		expect(body).not.toHaveBeenCalled();
	});
	it('hides upstream errors behind the English sentence', async () => {
		const res = await audited('list_clients', 'clients:read', auth, {}, 'clients', async () => { throw new Error('PGRST301 raw postgres text'); });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toBe('Could not read clients right now — try again in a minute.');
	});
	it('lets a userError message through verbatim', async () => {
		const res = await audited('get_client', 'clients:read', auth, {}, 'this client', async () => { throw userError('Pass airtable_contract_id or name.'); });
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toBe('Pass airtable_contract_id or name.');
	});
});
