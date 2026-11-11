import { describe, expect, it } from 'vitest';
import {
	contractToClientMap,
	isAirtableRecordId,
	isClientId,
	primaryContract,
	rekeyClientPath,
	sortContractsByPrimacy,
} from './key';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('key predicates', () => {
	it('tells an Airtable record id from a clients_v2 uuid', () => {
		expect(isAirtableRecordId('recTESTRECORD0001')).toBe(true);
		expect(isAirtableRecordId('rec123')).toBe(false);
		expect(isAirtableRecordId(U1)).toBe(false);
		expect(isClientId(U1)).toBe(true);
		expect(isClientId('recTESTRECORD0001')).toBe(false);
		expect(isClientId(undefined)).toBe(false);
	});
});

describe('sortContractsByPrimacy / primaryContract', () => {
	const rows = [
		{ client_id: U1, airtable_contract_id: 'recAAAAAAAAAAAAA1', status: 'closed', starts_on: '2024-07-01' },
		{ client_id: U1, airtable_contract_id: 'recAAAAAAAAAAAAA2', status: 'active', starts_on: '2024-08-05' },
		{ client_id: U1, airtable_contract_id: 'recAAAAAAAAAAAAA3', status: 'hold', starts_on: '2025-01-01' },
		{ client_id: U1, airtable_contract_id: 'recAAAAAAAAAAAAA4', status: 'active', starts_on: '2023-01-01' },
	];
	it('puts the live engagement first, then hold, closed last; ties by newest start', () => {
		expect(sortContractsByPrimacy(rows).map((r) => r.airtable_contract_id)).toEqual([
			'recAAAAAAAAAAAAA2', 'recAAAAAAAAAAAAA4', 'recAAAAAAAAAAAAA3', 'recAAAAAAAAAAAAA1',
		]);
		expect(primaryContract(rows)?.airtable_contract_id).toBe('recAAAAAAAAAAAAA2');
		expect(primaryContract([])).toBeNull();
	});
	it('does not mutate its input', () => {
		const copy = [...rows];
		sortContractsByPrimacy(rows);
		expect(rows).toEqual(copy);
	});
	it('unknown statuses rank between internal and closed, missing start dates sort last within a rank', () => {
		const r = sortContractsByPrimacy([
			{ client_id: U1, airtable_contract_id: 'recBBBBBBBBBBBBB1', status: 'closed', starts_on: null },
			{ client_id: U1, airtable_contract_id: 'recBBBBBBBBBBBBB2', status: 'weird', starts_on: null },
			{ client_id: U1, airtable_contract_id: 'recBBBBBBBBBBBBB3', status: 'closed', starts_on: '2020-01-01' },
		]);
		expect(r.map((x) => x.airtable_contract_id)).toEqual(['recBBBBBBBBBBBBB2', 'recBBBBBBBBBBBBB3', 'recBBBBBBBBBBBBB1']);
	});
});

describe('contractToClientMap', () => {
	it('maps every airtable id to its client and skips rows without one', () => {
		const m = contractToClientMap([
			{ client_id: U1, airtable_contract_id: 'recAAAAAAAAAAAAA1', status: 'active' },
			{ client_id: U1, airtable_contract_id: null, status: 'active' },
		]);
		expect(m.get('recAAAAAAAAAAAAA1')).toBe(U1);
		expect(m.size).toBe(1);
	});
});

describe('rekeyClientPath', () => {
	it('rewrites a legacy /clients/<rec> path keeping the tab tail and the query', () => {
		expect(rekeyClientPath('/clients/recTESTRECORD0001', '', U1)).toBe(`/clients/${U1}`);
		expect(rekeyClientPath('/clients/recTESTRECORD0001/health', '?x=1', U1)).toBe(`/clients/${U1}/health?x=1`);
	});
	it('leaves non-legacy paths alone', () => {
		expect(rekeyClientPath(`/clients/${U1}`, '', U1)).toBeNull();
		expect(rekeyClientPath('/clients/analytics', '', U1)).toBeNull();
	});
});
