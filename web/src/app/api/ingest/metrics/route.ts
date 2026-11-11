// POST /api/ingest/metrics — batch metric upsert (integration plan §5.8).
// Natural key: (subject_type, subject_key, metric_key, period, source) where
// subject_key is the generated COALESCE(subject_id, subject_ref) column and
// source is always 'beacon' here — manual entries can never be overwritten by
// a feed, and a retried nightly job overwrites itself instead of duplicating.
//
// Subject resolution (§4.3 — column names invite the wrong assumption):
//   user   -> subject_email  -> profiles.id        -> subject_id
//   client -> client ref     -> clients_v2.id      -> subject_ref (uuid AS TEXT)
//   team   -> subject_ref passed through
//
// Corrections are visible: the 0041 metrics_log_revision trigger snapshots the
// old value into metric_revisions on every changing update.
//
// NOT wired to compensation. bonus_type='pay_per' consumption stays read-only
// until Alex opens that gate (integration plan §5.8 / decision 4).

import { metricRow } from '@/lib/ingest/contract';
import { clientResolver, profileIdsByEmail, runIngestBatch, type Unmatched } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	return runIngestBatch(request, 'metrics', metricRow, async (supabase, rows) => {
		// pre-resolve everything in three lookups
		const emails = rows.flatMap((r) => (r.subject_type === 'user' && r.subject_email ? [r.subject_email] : []));
		const profileByEmail = await profileIdsByEmail(supabase, emails);
		const resolveClient = await clientResolver(
			supabase,
			rows.map((r) => (r.subject_type === 'client' ? r.subject_client : undefined)),
		);
		const keys = [...new Set(rows.map((r) => r.metric_key))];
		const { data: defs, error: defsError } = await supabase
			.from('metric_definitions')
			.select('key')
			.in('key', keys);
		if (defsError) throw new Error(`metric_definitions lookup failed: ${defsError.message}`);
		const knownKeys = new Set((defs ?? []).map((d) => d.key as string));

		const unmatched: Unmatched[] = [];
		const writable: Array<Record<string, unknown>> = [];
		const computedAt = new Date().toISOString();
		for (const r of rows) {
			if (!knownKeys.has(r.metric_key)) {
				unmatched.push({ row: r, reason: 'metric_key_unknown' });
				continue;
			}
			let subjectId: string | null = null;
			let subjectRef: string | null = null;
			if (r.subject_type === 'user') {
				subjectId = profileByEmail.get(r.subject_email!.toLowerCase()) ?? null;
				if (!subjectId) {
					unmatched.push({ row: r, reason: 'user_not_found' });
					continue;
				}
			} else if (r.subject_type === 'client') {
				subjectRef = resolveClient(r.subject_client);
				if (!subjectRef) {
					unmatched.push({ row: r, reason: 'client_not_found' });
					continue;
				}
			} else {
				subjectRef = r.subject_ref!;
			}
			writable.push({
				subject_type: r.subject_type,
				subject_id: subjectId,
				subject_ref: subjectRef,
				metric_key: r.metric_key,
				period: r.period,
				value: r.value ?? null,
				goal: r.goal ?? null,
				source: 'beacon',
				meta: r.meta ?? {},
				computed_at: computedAt,
			});
		}
		if (writable.length > 0) {
			const { error } = await supabase
				.from('metrics')
				.upsert(writable, { onConflict: 'subject_type,subject_key,metric_key,period,source' });
			if (error) throw new Error(`metrics upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
