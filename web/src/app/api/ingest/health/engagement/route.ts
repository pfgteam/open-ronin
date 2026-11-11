// POST /api/ingest/health/engagement — monthly client-engagement upsert
// (integration plan §5.4; 25% of the health score).
// Natural key: (airtable_contract_id, period_month). Idempotent by upsert.

import { engagementRow } from '@/lib/ingest/contract';
import { knownContractIds, runIngestBatch, type Unmatched } from '@/lib/ingest/server';
import { upsertByShape } from '@/lib/ingest/upsert';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	return runIngestBatch(request, 'health/engagement', engagementRow, async (supabase, rows) => {
		const known = await knownContractIds(supabase, rows.map((r) => r.airtable_contract_id));
		const unmatched: Unmatched[] = [];
		const writable = rows.filter((r) => {
			if (known.has(r.airtable_contract_id)) return true;
			unmatched.push({ row: r, reason: 'contract_not_found' });
			return false;
		});
		if (writable.length > 0) {
			// Grouped by key shape so a batch that omits, say, email counts
			// cannot zero the stored ones — see lib/ingest/upsert.ts.
			const { error } = await upsertByShape(supabase, 'client_engagement', writable, {
				onConflict: 'airtable_contract_id,period_month',
			});
			if (error) throw new Error(`client_engagement upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
