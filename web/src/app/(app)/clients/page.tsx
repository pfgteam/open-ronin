// /clients — the client roster. Two sources:
//   - native (default): public.clients_v2, read under RLS;
//   - Airtable (optional legacy mirror): when AIRTABLE_PAT and
//     AIRTABLE_BASE_CLIENT_CENTRAL are set, the Contract Agreement table is the
//     roster and each contract links to its clients_v2 row through the
//     contracts mirror.
// Either way the rows go to the client-side ClientsTable for filter/search.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { BASE_IDS, DataAdapterError, type DataRecord } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { clientIdsForAirtableContracts } from '@/lib/clients/server';
import { createClient } from '@/lib/supabase/server';
import ClientsTable, { type ClientFields } from './ClientsTable';

export const metadata = { title: 'Clients' };

export const dynamic = 'force-dynamic';

const AIRTABLE_ON = Boolean(process.env.AIRTABLE_PAT && BASE_IDS.CLIENT_CENTRAL);

function titleCase(s: string | null): string | undefined {
	if (!s) return undefined;
	return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

async function fetchNativeClients(): Promise<{ rows: DataRecord<ClientFields>[]; error: string | null }> {
	const supabase = await createClient();
	const { data, error } = await supabase.from('clients_v2').select('id, display_name, status, created_at').order('display_name');
	if (error) return { rows: [], error: error.message };
	return {
		rows: (data ?? []).map((c) => ({
			id: c.id as string,
			createdTime: c.created_at as string,
			fields: { Client: c.display_name as string, 'Client Status': titleCase(c.status as string | null) },
		})),
		error: null,
	};
}

// Pull every record (cached and shared across viewers; see lib/data/cachedList).
async function fetchAirtableClients(): Promise<{ rows: DataRecord<ClientFields>[]; error: string | null }> {
	const fields = ['Client', 'Client Status', 'Industry', 'Packages', 'Per Month', 'Acct Lead', 'Media Specialist', 'Client Health', 'End of Service', 'POC Email', 'Lead Source'];
	try {
		const { rows } = await listFullTable<ClientFields>(BASE_IDS.CLIENT_CENTRAL, 'Contract Agreement', { fields });
		return { rows, error: null };
	} catch (e) {
		const msg = e instanceof DataAdapterError ? `${e.status} — ${e.message}` : e instanceof Error ? e.message : String(e);
		return { rows: [], error: msg };
	}
}

export default async function ClientsPage() {
	if (!AIRTABLE_ON) {
		const { rows, error } = await fetchNativeClients();
		return (
			<>
				<PageHeader title="Clients" description={`${rows.length} clients`} />
				{error && (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Failed to load clients:</strong> {error}
						</p>
					</Card>
				)}
				<ClientsTable rows={rows} clientIds={Object.fromEntries(rows.map((r) => [r.id, r.id]))} />
			</>
		);
	}

	const { rows, error } = await fetchAirtableClients();
	// Airtable contract id -> clients_v2.id. A contract the mirror has not seen
	// yet links nowhere rather than to a 404, and the table says so.
	const clientIds = await clientIdsForAirtableContracts(rows.map((r) => r.id));
	const unmirrored = rows.length - rows.filter((r) => clientIds.has(r.id)).length;

	return (
		<>
			<PageHeader
				title="Clients"
				description={`From Airtable · Contract Agreement · ${rows.length} records${unmirrored ? ` · ${unmirrored} not yet mirrored to clients_v2` : ''}`}
			/>
			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load clients:</strong> {error}
					</p>
					<p className="text-xs text-red-600 dark:text-red-400 mt-1">
						Check <code>/admin/airtable-test</code> for a full diagnostic.
					</p>
				</Card>
			)}
			<ClientsTable rows={rows} clientIds={Object.fromEntries(clientIds)} />
		</>
	);
}
