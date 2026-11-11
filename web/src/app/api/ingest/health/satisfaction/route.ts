// POST /api/ingest/health/satisfaction — per-call satisfaction upsert
// (integration plan §5.5; 15% of the health score). The source is the call
// RECORDING, not a form — qualitative_md should carry the quoted span, and an
// extractor that can't tell says sentiment='ambiguous' rather than 'neutral'.
// Natural key: (airtable_contract_id, captured_at, source) — added in 0041.

import { satisfactionRow } from '@/lib/ingest/contract';
import { knownContractIds, runIngestBatch, type Unmatched } from '@/lib/ingest/server';
import { upsertByShape } from '@/lib/ingest/upsert';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	return runIngestBatch(request, 'health/satisfaction', satisfactionRow, async (supabase, rows) => {
		const known = await knownContractIds(supabase, rows.map((r) => r.airtable_contract_id));
		const unmatched: Unmatched[] = [];
		const writable = rows.filter((r) => {
			if (known.has(r.airtable_contract_id)) return true;
			unmatched.push({ row: r, reason: 'contract_not_found' });
			return false;
		});
		if (writable.length > 0) {
			const { error } = await upsertByShape(supabase, 'client_satisfaction', writable, {
				onConflict: 'airtable_contract_id,captured_at,source',
			});
			if (error) throw new Error(`client_satisfaction upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
