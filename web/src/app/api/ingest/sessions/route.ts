// POST /api/ingest/sessions — the n8n Zoom pipeline sends call + transcript +
// analysis + suggested tasks in one row (spec 2026-08-31).
//
// Natural key: 'zoom:' + zoom_meeting_id written into calls.external_call_id
// (see the 0056 column comment). Re-send semantics: call and transcript
// UPSERT; the analysis APPENDS a new row. The new analysis SUPERSEDES any
// still-pending suggestions from older analyses of the same call (deleted,
// not dismissed — they were never seen/acted on, so dismissing would put a
// false "decided" stamp on something nobody decided) before the new
// suggestions are inserted; accepted/dismissed suggestions are history and
// are never touched. A client ref that is present but unresolvable goes to
// unmatched.

import { envOrgDomains } from '@/lib/tenant/domains';
import { sessionRow } from '@/lib/ingest/contract';
import { clientResolver, profileIdsByEmail, runIngestBatch, type Unmatched } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

const INTERNAL_DOMAINS = new Set(envOrgDomains()); // org.allowed_email_domains

export async function POST(request: Request) {
	return runIngestBatch(request, 'sessions', sessionRow, async (supabase, rows) => {
		const resolve = await clientResolver(supabase, rows.map((r) => r.client));
		// Scored participants are a subset of attendee_emails (the contract's
		// superRefine enforces that), so this flatMap already covers them —
		// but only for rows whose participant happens to sit on an internal
		// domain, which is the same filter the attendee list uses.
		const internalEmails = rows
			.flatMap((r) => r.attendee_emails)
			.filter((e) => INTERNAL_DOMAINS.has(e.split('@')[1]?.toLowerCase() ?? ''));
		const profileByEmail = await profileIdsByEmail(supabase, internalEmails);

		const unmatched: Unmatched[] = [];
		let written = 0;

		// Row-by-row, not batched: each row is call+transcript+analysis+
		// suggestions, and a partial write (call without its analysis) is the
		// corruption the spec forbids. Batches are small (n8n sends per-call).
		for (const r of rows) {
			const clientId = resolve(r.client);
			if (r.client && !clientId) {
				unmatched.push({ row: r, reason: 'client_not_found' });
				continue;
			}
			const userIds: string[] = [];
			const external: string[] = [];
			for (const e of r.attendee_emails) {
				const pid = profileByEmail.get(e.toLowerCase());
				if (pid) userIds.push(pid);
				else external.push(e);
			}

			const { data: call, error: callError } = await supabase
				.from('calls')
				.upsert(
					{
						external_call_id: `zoom:${r.zoom_meeting_id}`,
						client_id: clientId,
						call_type: r.call_type,
						occurred_at: r.occurred_at,
						duration_minutes: r.duration_minutes ?? null,
						recording_url: r.recording_url ?? null,
						attendee_user_ids: userIds,
						attendee_external: external,
					},
					{ onConflict: 'external_call_id' },
				)
				.select('id')
				.single();
			if (callError || !call) {
				unmatched.push({ row: r, reason: `call_upsert_failed: ${callError?.message}` });
				continue;
			}

			const { error: trError } = await supabase.from('call_transcripts').upsert(
				{
					call_id: call.id,
					content: r.transcript.content,
					language: r.transcript.language ?? null,
					word_count: r.transcript.word_count ?? null,
					source: 'zoom',
				},
				{ onConflict: 'call_id' },
			);
			if (trError) {
				unmatched.push({ row: r, reason: `transcript_upsert_failed: ${trError.message}` });
				continue;
			}

			const { data: analysis, error: anError } = await supabase
				.from('call_analyses')
				.insert({
					call_id: call.id,
					analyzer: r.analysis.analyzer,
					prompt_version: r.analysis.prompt_version ?? null,
					overall_score: r.analysis.overall_score,
					summary_md: r.analysis.summary_md,
					dimensions: r.analysis.dimensions,
					attention_points: r.analysis.attention_points,
				})
				.select('id')
				.single();
			if (anError || !analysis) {
				unmatched.push({ row: r, reason: `analysis_insert_failed: ${anError?.message}` });
				continue;
			}

			// Supersede-by-delete: older pending suggestions from a previous
			// analysis of this same call are stale the moment a new analysis
			// lands — the new analysis re-derives its own view of what needs
			// doing, and leaving the old pending rows in place is what caused
			// re-sends to show every suggestion twice. Only `pending` rows are
			// removed; `accepted`/`dismissed` rows are a human decision and
			// stay untouched regardless of which analysis they came from.
			const { error: supersedeError } = await supabase
				.from('call_suggested_tasks')
				.delete()
				.eq('call_id', call.id)
				.eq('status', 'pending')
				.neq('analysis_id', analysis.id);
			if (supersedeError) {
				unmatched.push({ row: r, reason: `superseded_cleanup_failed: ${supersedeError.message}` });
				continue;
			}

			if (r.analysis.suggested_tasks.length > 0) {
				const { error: stError } = await supabase.from('call_suggested_tasks').insert(
					r.analysis.suggested_tasks.map((t) => ({
						call_id: call.id,
						analysis_id: analysis.id,
						title: t.title,
						detail_md: t.detail_md ?? null,
						suggested_owner_email: t.suggested_owner_email ?? null,
					})),
				);
				if (stError) {
					unmatched.push({ row: r, reason: `suggestions_insert_failed: ${stError.message}` });
					continue;
				}
			}

			// Per-participant LARA scores (0087). Internal only: an email with
			// no profile is DROPPED, not failed — same treatment the call's own
			// external attendees get above. A typo'd internal address is
			// therefore invisible here by design; it shows on the call as a
			// participant without a score.
			const scoreRows = r.analysis.participants
				.map((p) => ({ pid: profileByEmail.get(p.email.toLowerCase()), p }))
				.filter((x): x is { pid: string; p: typeof x.p } => Boolean(x.pid))
				.map(({ pid, p }) => ({
					call_id: call.id,
					analysis_id: analysis.id,
					user_id: pid,
					listening: p.listening,
					affirming: p.affirming,
					responding: p.responding,
					asking: p.asking,
					overall: p.overall,
					notes_md: p.notes_md ?? null,
				}));
			if (scoreRows.length > 0) {
				const { error: psError } = await supabase
					.from('call_participant_scores')
					.upsert(scoreRows, { onConflict: 'analysis_id,user_id' });
				if (psError) {
					unmatched.push({ row: r, reason: `participant_scores_insert_failed: ${psError.message}` });
					continue;
				}
			}
			written += 1;

			// Meeting-prep linking (0150): transcript speakers -> attendees,
			// calendar event, series, rule type when untyped, Alex's to-talk
			// lines. Best effort: a failure here (or the migration not applied
			// yet) never fails an ingest that already landed.
			const { error: linkError } = await supabase.rpc('meeting_link_call', { p_call_id: call.id });
			if (linkError && !/meeting_link_call|schema cache|does not exist/i.test(linkError.message)) {
				console.error(`[ingest/sessions] meeting_link_call failed for ${call.id}:`, linkError.message);
			}
		}
		return { written, unmatched };
	});
}
