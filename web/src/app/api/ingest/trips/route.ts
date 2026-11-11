// POST /api/ingest/trips — travel feed (0111, Tier B #13, Sheridan). Same
// machinery as /api/ingest/todos: service token, contract-version gate,
// per-row zod, unmatched rows recorded in ingest_unmatched.
//
// Resolution:
//   traveler_email -> profiles.id (required; unknown email = unmatched)
//   client         -> clients_v2.id via clientRef (optional; unresolvable
//                     client = row still written, client_id null)
//
// Idempotent APPEND on (source='ingest', source_id) with ignoreDuplicates: a
// re-sent itinerary never clobbers a trip someone edited in the app.

import { tripRow } from '@/lib/ingest/contract';
import { clientResolver, profileIdsByEmail, runIngestBatch, type Unmatched } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	return runIngestBatch(request, 'trips', tripRow, async (supabase, rows) => {
		const profileByEmail = await profileIdsByEmail(supabase, rows.map((r) => r.traveler_email));
		const resolveClient = await clientResolver(supabase, rows.map((r) => r.client));

		const unmatched: Unmatched[] = [];
		const writable: Array<Record<string, unknown>> = [];
		for (const r of rows) {
			const travelerId = profileByEmail.get(r.traveler_email.toLowerCase());
			if (!travelerId) {
				unmatched.push({ row: r, reason: 'traveler_not_found' });
				continue;
			}
			writable.push({
				traveler_id: travelerId,
				purpose: r.purpose,
				destination: r.destination,
				depart_on: r.depart_on,
				return_on: r.return_on,
				client_id: resolveClient(r.client),
				status: r.status,
				cost_usd: r.cost_usd ?? null,
				notes_md: r.notes_md ?? null,
				source: 'ingest',
				source_id: r.source_id,
			});
		}
		if (writable.length > 0) {
			const { error } = await supabase
				.from('trips')
				.upsert(writable, { onConflict: 'source,source_id', ignoreDuplicates: true });
			if (error) {
				if (error.code === '42P01') throw new Error('trips table missing: migration 0111 is not applied');
				throw new Error(`trips upsert failed: ${error.message}`);
			}
		}
		return { written: writable.length, unmatched };
	});
}
