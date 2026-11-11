// POST /api/ingest/todos — Zoom summary_next_steps items (integration plan
// §5.7). "A JSON parse, not an AI feature" — Zoom already extracted these;
// the sender forwards them per item with the assignee's email.
//
// Assignee resolution honours the todos CHECK constraint:
//   internal email  -> assignee_type='team' + assignee_team_id (profiles)
//   external email  -> assignee_type NULL + assignee_email kept (client_contacts
//                      is empty today; attach contacts in a later pass)
//   no email        -> unassigned
//
// Idempotent APPEND on (source, source_id) with ignoreDuplicates: a re-parse
// of the same call never clobbers workflow state (status/completed_at belong
// to the people using the todo, not the feed).

import { envOrgDomains } from '@/lib/tenant/domains';
import { todoRow } from '@/lib/ingest/contract';
import { knownContractIds, profileIdsByEmail, runIngestBatch, type Unmatched } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

const INTERNAL_DOMAINS = new Set(envOrgDomains()); // org.allowed_email_domains

export async function POST(request: Request) {
	return runIngestBatch(request, 'todos', todoRow, async (supabase, rows) => {
		const known = await knownContractIds(supabase, rows.map((r) => r.airtable_contract_id));
		const internalEmails = rows.flatMap((r) => {
			const d = r.assignee_email?.split('@')[1]?.toLowerCase();
			return r.assignee_email && d && INTERNAL_DOMAINS.has(d) ? [r.assignee_email] : [];
		});
		const profileByEmail = await profileIdsByEmail(supabase, internalEmails);

		const unmatched: Unmatched[] = [];
		const writable: Array<Record<string, unknown>> = [];
		for (const r of rows) {
			if (!known.has(r.airtable_contract_id)) {
				unmatched.push({ row: r, reason: 'contract_not_found' });
				continue;
			}
			const profileId = r.assignee_email
				? profileByEmail.get(r.assignee_email.toLowerCase())
				: undefined;
			writable.push({
				airtable_contract_id: r.airtable_contract_id,
				title: r.title,
				description_md: r.description_md ?? null,
				assignee_type: profileId ? 'team' : null,
				assignee_team_id: profileId ?? null,
				assignee_email: r.assignee_email ?? null,
				status: 'pending',
				priority: r.priority,
				due_at: r.due_at ?? null,
				source: 'beacon',
				source_id: r.source_id,
			});
		}
		if (writable.length > 0) {
			const { error } = await supabase
				.from('todos')
				.upsert(writable, { onConflict: 'source,source_id', ignoreDuplicates: true });
			if (error) throw new Error(`todos upsert failed: ${error.message}`);
		}
		return { written: writable.length, unmatched };
	});
}
