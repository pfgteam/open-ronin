// Server readers for the client key (clients_v2 / contracts). Imports
// lib/supabase/server, so keep this OUT of any 'use client' tree — the pure
// vocabulary lives in ./key.ts.

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { contractToClientMap, isAirtableRecordId, isClientId, sortContractsByPrimacy } from './key';

export interface ClientRecord {
	id: string;
	display_name: string;
	status: string;
	org_tag_id: string | null;
}

export interface ContractRecord {
	id: string;
	client_id: string;
	airtable_contract_id: string | null;
	package: string | null;
	per_month_cents: number | null;
	starts_on: string | null;
	ends_on: string | null;
	status: string;
}

export const CONTRACT_COLUMNS = 'id, client_id, airtable_contract_id, package, per_month_cents, starts_on, ends_on, status';

export interface ClientWithContracts {
	client: ClientRecord;
	/** Sorted by primacy: active first, then hold, closed last (see key.ts). */
	contracts: ContractRecord[];
	primary: ContractRecord | null;
	/** Every Airtable contract id under this client — the join key for the mirror tables. */
	airtableIds: string[];
}

/** clients_v2 row + its contracts. React-cached per render pass. */
export const getClientWithContracts = cache(async (clientId: string): Promise<ClientWithContracts | null> => {
	if (!isClientId(clientId)) return null;
	const supabase = await createClient();
	const [{ data: client }, { data: contracts }] = await Promise.all([
		supabase.from('clients_v2').select('id, display_name, status, org_tag_id').eq('id', clientId).maybeSingle<ClientRecord>(),
		supabase.from('contracts').select(CONTRACT_COLUMNS).eq('client_id', clientId).returns<ContractRecord[]>(),
	]);
	if (!client) return null;
	const sorted = sortContractsByPrimacy(contracts ?? []);
	return {
		client,
		contracts: sorted,
		primary: sorted[0] ?? null,
		airtableIds: sorted.map((c) => c.airtable_contract_id).filter((v): v is string => !!v),
	};
});

/** Legacy alias: Airtable Contract Agreement record id -> clients_v2.id. */
export const clientIdForAirtableContract = cache(async (rec: string): Promise<string | null> => {
	if (!isAirtableRecordId(rec)) return null;
	const supabase = await createClient();
	const { data } = await supabase.from('contracts').select('client_id').eq('airtable_contract_id', rec).maybeSingle<{ client_id: string }>();
	return data?.client_id ?? null;
});

/**
 * airtable_contract_id -> client_id for a batch of Airtable ids (list pages
 * that still walk the Airtable roster but must link by client id).
 */
export async function clientIdsForAirtableContracts(recs: string[]): Promise<Map<string, string>> {
	const unique = [...new Set(recs.filter(isAirtableRecordId))];
	if (unique.length === 0) return new Map();
	const supabase = await createClient();
	const out = new Map<string, string>();
	for (let i = 0; i < unique.length; i += 200) {
		const { data } = await supabase
			.from('contracts')
			.select('client_id, airtable_contract_id, status')
			.in('airtable_contract_id', unique.slice(i, i + 200))
			.returns<{ client_id: string; airtable_contract_id: string | null; status: string }[]>();
		for (const [k, v] of contractToClientMap(data ?? [])) out.set(k, v);
	}
	return out;
}
