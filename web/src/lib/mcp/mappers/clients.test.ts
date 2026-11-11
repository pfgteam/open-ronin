import { describe, expect, it } from 'vitest';
import { mapClientRow, parseStatusFilter } from './clients';

const rec = {
	id: 'recABC',
	fields: {
		Client: 'Acme', 'Client Status': 'Active', Industry: 'CPG', Packages: ['Growth', 'Social'],
		'Per Month': 4500,
		// Airtable COLLABORATOR fields are objects (see ClientsTable.tsx:27-31),
		// and they carry the staff member's email — only the name may leave.
		'Acct Lead': { id: 'usr1', email: 'user-8a8dee@example.com', name: 'Jane Doe' },
		'Media Specialist': { id: 'usr2', email: 'user-aa153b@example.com', name: 'Ravi K' },
		'Client Health': 82, 'End of Service': '2026-12-31', 'POC Email': 'ceo@acme.com', 'Lead Source': 'Referral',
	},
};

describe('mapClientRow', () => {
	it('exposes exactly the allowlist — no revenue, no POC email, no lead source', () => {
		const row = mapClientRow(rec, 'c0ffee00-0000-4000-8000-000000000001');
		expect(Object.keys(row).sort()).toEqual([
			'acct_lead', 'airtable_contract_id', 'client', 'client_health', 'client_id', 'client_status',
			'end_of_service', 'industry', 'media_specialist', 'packages', 'url',
		]);
		expect(row.airtable_contract_id).toBe('recABC');
		expect(row.client_id).toBe('c0ffee00-0000-4000-8000-000000000001');
		expect(row.url).toBe('/clients/c0ffee00-0000-4000-8000-000000000001');
		expect(row.acct_lead).toBe('Jane Doe');
		expect(row.media_specialist).toBe('Ravi K');
		expect(row.packages).toBe('Growth + Social');
		expect(JSON.stringify(row)).not.toContain('example.com');
	});
	it('an unmirrored tracker row carries a null client_id and no url', () => {
		const row = mapClientRow(rec);
		expect(row.client_id).toBeNull();
		expect(row.url).toBeNull();
	});
	it('tolerates a collaborator array (multi-collaborator field) and a missing name', () => {
		expect(mapClientRow({ id: 'r', fields: { 'Acct Lead': [{ id: 'u', name: 'Sam' }] } }).acct_lead).toBe('Sam');
		expect(mapClientRow({ id: 'r', fields: { 'Acct Lead': { id: 'u', email: 'x@y.z' } } }).acct_lead).toBeNull();
		expect(mapClientRow({ id: 'r', fields: {} }).acct_lead).toBeNull();
	});
	it('packages tolerates a multi-select array, a bare string, and a missing value', () => {
		expect(mapClientRow({ id: 'r', fields: { Packages: ['Growth', 'Social'] } }).packages).toBe('Growth + Social');
		expect(mapClientRow({ id: 'r', fields: { Packages: 'Growth' } }).packages).toBe('Growth');
		expect(mapClientRow({ id: 'r', fields: {} }).packages).toBeNull();
	});
});

describe('parseStatusFilter', () => {
	it('default "active" = Active + 30-day + 60-day', () => {
		const f = parseStatusFilter(undefined);
		expect(f('Active')).toBe(true); expect(f('30-day')).toBe(true); expect(f('60-day')).toBe(true);
		expect(f('Hold')).toBe(false); expect(f('Closed')).toBe(false);
	});
	it('"all" passes everything, a specific value matches case-insensitively', () => {
		expect(parseStatusFilter('all')('Whatever')).toBe(true);
		expect(parseStatusFilter('hold')('Hold')).toBe(true);
		expect(parseStatusFilter('post-contract')('Post Contract Fulfillment')).toBe(true);
	});
});
