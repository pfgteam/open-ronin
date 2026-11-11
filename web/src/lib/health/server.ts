// Health score reader keyed by clients_v2.id. Reads through contracts
// (client_id -> airtable_contract_id[]) because health_scores still keys on
// the Airtable contract id. Server only.

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getClientWithContracts } from '@/lib/clients/server';
import { pickClientHealth, type ClientHealth, type HealthScoreRow } from './shared';

export const HEALTH_COLUMNS = 'airtable_contract_id, period_month, total_score, computed_at, factor_breakdown';

/** Latest + current-month health for a client, or null when no score exists. */
export const getClientHealth = cache(async (clientId: string): Promise<ClientHealth | null> => {
	const bundle = await getClientWithContracts(clientId);
	if (!bundle || bundle.airtableIds.length === 0) return null;
	const supabase = await createClient();
	const { data } = await supabase
		.from('health_scores')
		.select(HEALTH_COLUMNS)
		.in('airtable_contract_id', bundle.airtableIds)
		.order('period_month', { ascending: false })
		.limit(24)
		.returns<HealthScoreRow[]>();
	return pickClientHealth(data ?? [], bundle.primary?.airtable_contract_id ?? null);
});

/** Score history for the client's primary contract (newest first). */
export const getClientHealthHistory = cache(async (clientId: string, months = 12): Promise<HealthScoreRow[]> => {
	const bundle = await getClientWithContracts(clientId);
	const rec = bundle?.primary?.airtable_contract_id;
	if (!rec) return [];
	const supabase = await createClient();
	const { data } = await supabase
		.from('health_scores')
		.select(HEALTH_COLUMNS)
		.eq('airtable_contract_id', rec)
		.order('period_month', { ascending: false })
		.limit(months)
		.returns<HealthScoreRow[]>();
	return data ?? [];
});
