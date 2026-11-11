// POST /api/ingest/calls — thin call records (integration plan §5.6).
// Content (recording, transcript) stays in Beacon; this row makes a call
// clickable from a client and a person. Natural key: external_call_id.
//
// call_type comes from the sender using the WP5 empirical taxonomy; bare-name
// titles must arrive as 'untyped' — this API never guesses.
// A client ref that is PRESENT but unresolvable goes to unmatched (a silently
// null link is exactly the corruption §2.4 warns about); an ABSENT client ref
// means an internal call and writes with client_id null.

import { envOrgDomains } from '@/lib/tenant/domains';
import { callRow } from '@/lib/ingest/contract';
import { clientResolver, profileIdsByEmail, runIngestBatch, type Unmatched } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

const INTERNAL_DOMAINS = new Set(envOrgDomains()); // org.allowed_email_domains

export async function POST(request: Request) {
	return runIngestBatch(request, 'calls', callRow, async (supabase, rows) => {
		const resolve = await clientResolver(supabase, rows.map((r) => r.client));
		const allEmails = rows.flatMap((r) => r.attendee_emails ?? []);
		const internalEmails = allEmails.filter((e) =>
			INTERNAL_DOMAINS.has(e.split('@')[1]?.toLowerCase() ?? ''),
		);
		const profileByEmail = await profileIdsByEmail(supabase, internalEmails);

		const unmatched: Unmatched[] = [];
		const writable: Array<Record<string, unknown>> = [];
		for (const r of rows) {
			const clientId = resolve(r.client);
			if (r.client && !clientId) {
				unmatched.push({ row: r, reason: 'client_not_found' });
				continue;
			}
			const userIds: string[] = [];
			const external: string[] = [];
			for (const e of r.attendee_emails ?? []) {
				const pid = profileByEmail.get(e.toLowerCase());
				if (pid) userIds.push(pid);
				else external.push(e);
			}
			writable.push({
				external_call_id: r.external_call_id,
				client_id: clientId,
				call_type: r.call_type,
				occurred_at: r.occurred_at,
				duration_minutes: r.duration_minutes ?? null,
				recording_url: r.recording_url ?? null,
				transcript_url: r.transcript_url ?? null,
				attendee_user_ids: userIds,
				attendee_external: external,
			});
		}
		if (writable.length > 0) {
			const { error } = await supabase
				.from('calls')
				.upsert(writable, { onConflict: 'external_call_id' });
			if (error) throw new Error(`calls upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
