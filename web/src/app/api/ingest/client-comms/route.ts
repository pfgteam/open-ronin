// POST /api/ingest/client-comms — communication log append (integration plan
// §5.9). Starts with CALLS ONLY by decision — email/chat is a materially
// bigger consent decision; widening `channel` is where it becomes concrete.
// Idempotent append: unique (source, source_id) added in 0041, so a retried
// batch re-sends the same source_ids and writes nothing new.

import { clientCommRow } from '@/lib/ingest/contract';
import { knownContractIds, runIngestBatch, type Unmatched } from '@/lib/ingest/server';
import { upsertByShape } from '@/lib/ingest/upsert';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	return runIngestBatch(request, 'client-comms', clientCommRow, async (supabase, rows) => {
		const known = await knownContractIds(supabase, rows.map((r) => r.airtable_contract_id));
		const unmatched: Unmatched[] = [];
		const writable = rows.filter((r) => {
			if (known.has(r.airtable_contract_id)) return true;
			unmatched.push({ row: r, reason: 'contract_not_found' });
			return false;
		});
		if (writable.length > 0) {
			const { error } = await upsertByShape(
				supabase,
				'client_comms',
				writable.map((r) => ({ ...r, source: 'beacon' })),
				{
					onConflict: 'source,source_id',
					ignoreDuplicates: true, // append semantics: never rewrite history
				},
			);
			if (error) throw new Error(`client_comms upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
