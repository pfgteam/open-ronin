// POST /api/ingest/meeting-emails — meeting-prep source emails (migration 0150).
//
// The inbox poller (scripts/meeting_emails_push.py) sends raw AlterCall and
// Read AI emails from owner@example.com. Per row: store the raw
// email (natural key: Gmail message id; a re-send refreshes and re-parses it),
// parse it here (lib/meetings/emailParse.ts), and for an AlterCall session
// hand the parse to meeting_ingest_altercall(), which matches the calendar
// event, upserts the call (external_call_id 'zoom:<uuid>', merging with a row
// the n8n Zoom pipeline may already have written), links the series, types it
// and writes meeting_items, all in one transaction. Digests and other mail are
// stored and marked ignored. Unknown senders go to ingest_unmatched.

import { meetingEmailRow } from '@/lib/ingest/contract';
import { runIngestBatch, type Unmatched } from '@/lib/ingest/server';
import { htmlToText, parseMeetingEmail, sourceForSender } from '@/lib/meetings/emailParse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MISSING_TABLE_RE = /meeting_source_emails|meeting_ingest_altercall|schema cache|does not exist/i;

export async function POST(request: Request) {
	return runIngestBatch(request, 'meeting-emails', meetingEmailRow, async (supabase, rows) => {
		const unmatched: Unmatched[] = [];
		let written = 0;

		for (const r of rows) {
			const source = sourceForSender(r.from);
			if (!source) {
				unmatched.push({ row: { message_id: r.message_id, from: r.from, subject: r.subject }, reason: 'sender_not_a_meeting_source' });
				continue;
			}
			const html = r.html ?? '';
			const parsed = parseMeetingEmail(source, r.subject, html || (r.text ?? ''));
			const fromEmail = (/<([^>]+)>/.exec(r.from)?.[1] ?? r.from).trim().toLowerCase();

			const { data: email, error: emailError } = await supabase
				.from('meeting_source_emails')
				.upsert(
					{
						source,
						message_id: r.message_id,
						mailbox: r.mailbox.toLowerCase(),
						received_at: r.received_at,
						from_email: fromEmail,
						subject: r.subject,
						body_html: r.html ?? null,
						body_text: r.text ?? (html ? htmlToText(html) : null),
						kind: parsed.kind,
						parse_status: parsed.kind === 'session' ? 'pending' : 'ignored',
						parse_error: parsed.kind === 'other' ? parsed.reason : null,
						parsed: parsed as unknown as Record<string, unknown>,
					},
					{ onConflict: 'tenant_id,message_id' },
				)
				.select('id')
				.single<{ id: string }>();
			if (emailError || !email) {
				const msg = emailError?.message ?? 'no row';
				if (MISSING_TABLE_RE.test(msg)) throw new Error('meeting-emails: migration 0150 is not applied yet');
				unmatched.push({ row: { message_id: r.message_id, subject: r.subject }, reason: `email_upsert_failed: ${msg}` });
				continue;
			}

			if (parsed.kind === 'session') {
				const { error: ingestError } = await supabase.rpc('meeting_ingest_altercall', {
					p_email_id: email.id,
					p: parsed as unknown as Record<string, unknown>,
				});
				if (ingestError) {
					await supabase
						.from('meeting_source_emails')
						.update({ parse_status: 'error', parse_error: ingestError.message.slice(0, 1000) })
						.eq('id', email.id);
					unmatched.push({ row: { message_id: r.message_id, subject: r.subject }, reason: `ingest_failed: ${ingestError.message}` });
					continue;
				}
			}
			written += 1;
		}
		return { written, unmatched };
	});
}
