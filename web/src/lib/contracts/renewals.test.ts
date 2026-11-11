import { describe, expect, it } from 'vitest';
import { contractsToAlert, renewalCopy, renewalDedupeKey } from './renewals';
import { mapContract, type ContractRow } from '@/lib/mcp/mappers/finance';

const TODAY = '2026-09-19';
const base: ContractRow = {
	contract_id: 'c1', client_id: 'cl1', display_name: 'Acme', airtable_contract_id: 'recA', status: 'active', package: 'Grow & Scale 6',
	package_family: 'Grow & Scale', per_month_cents: 450000, starts_on: '2026-04-01', ends_on: null, term_months: 6, renewal_on: '2026-10-01',
	last_secured_month: null, last_live_month: null, days_since_last_secured: null,
};

describe('contractsToAlert', () => {
	it('only active contracts inside 90 days, tagged with their window', () => {
		const rows = [
			mapContract(base, TODAY),
			mapContract({ ...base, contract_id: 'c2', renewal_on: '2026-11-10' }, TODAY),
			mapContract({ ...base, contract_id: 'c3', renewal_on: '2027-03-01' }, TODAY),
			mapContract({ ...base, contract_id: 'c4', status: 'closed' }, TODAY),
			mapContract({ ...base, contract_id: 'c5', renewal_on: null }, TODAY),
		];
		expect(contractsToAlert(rows).map((a) => [a.contract.id, a.window])).toEqual([['c1', '30'], ['c2', '60']]);
	});
});

describe('renewalCopy / dedupe', () => {
	it('names the client, the timing and the money; key is per contract+window', () => {
		const c = mapContract(base, TODAY);
		const { title, body } = renewalCopy(c);
		expect(title).toBe('Acme contract renews in 12 days');
		expect(body).toContain('$4,500/mo');
		expect(body).toContain('2026-10-01');
		expect(renewalDedupeKey('c1', '30')).toBe('contract-renewal:c1:30');
	});
});
