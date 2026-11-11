// POST /api/ingest/live-links — placement detections (integration plan §5.3).
// Natural key: lower(url) via the generated url_key column (0041) — a
// placement re-detected by a monitoring sweep updates, never duplicates.
// Provenance: source='beacon' (column default) + source_id (placement id).
//
// WP1 caveat, enforced by scope: this table only ever sees WINS. Do not infer
// accept rates from it.

import { liveLinkRow } from '@/lib/ingest/contract';
import { knownContractIds, runIngestBatch, type Unmatched } from '@/lib/ingest/server';
import { upsertByShape } from '@/lib/ingest/upsert';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	return runIngestBatch(request, 'live-links', liveLinkRow, async (supabase, rows) => {
		const known = await knownContractIds(supabase, rows.map((r) => r.airtable_contract_id));
		const unmatched: Unmatched[] = [];
		const writable = rows.filter((r) => {
			if (known.has(r.airtable_contract_id)) return true;
			unmatched.push({ row: r, reason: 'contract_not_found' });
			return false;
		});
		if (writable.length > 0) {
			const { error } = await upsertByShape(supabase, 'live_links', writable, {
				onConflict: 'url_key',
			});
			if (error) throw new Error(`live_links upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
