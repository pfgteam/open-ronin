// Candidate comms (0132, H5). Every message is drafted, REVIEWED (approved by
// a person) and only then sent by the app: email from careers@ through
// Resend, SMS / WhatsApp through the GHL Open Ronin sub-account's hiring number
// (555) 010-0263 via the conversations API. Both degrade honestly: no key /
// no connection -> the message stays approved with a clear error and the
// reviewer can copy the text and send it by hand.

import type { SupabaseClient } from '@supabase/supabase-js';
import { firstName, renderTemplate, toSmsText, type Channel, type MessageVars } from './pipeline';

type Db = SupabaseClient;

export interface Senders {
	email: string;
	sms_number: string;
	sms_label: string;
}

export async function loadSenders(db: Db): Promise<Senders> {
	const { data } = await db.from('hire_settings').select('value').eq('key', 'senders').maybeSingle();
	const v = ((data as { value?: Record<string, string> } | null)?.value ?? {}) as Record<string, string>;
	return { email: v.email ?? 'careers@example.com', sms_number: v.sms_number ?? '+15550100263', sms_label: v.sms_label ?? 'Hiring' };
}

export function emailConfigured(): boolean {
	return !!process.env.RESEND_API_KEY;
}

async function sendEmail(to: string, from: string, subject: string, markdown: string): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
	const key = process.env.RESEND_API_KEY;
	if (!key) return { ok: false, error: 'RESEND_API_KEY not set: copy the text and send from careers@ by hand.' };
	const html = markdown
		.split(/\n{2,}/)
		.map((p) => `<p style="margin:0 0 12px">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`)
		.join('');
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
		body: JSON.stringify({ from: `Open Ronin Careers <${from}>`, to: [to], reply_to: from, subject, html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:640px">${html}</div>`, text: markdown }),
	});
	if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
	const j = (await res.json()) as { id?: string };
	return { ok: true, ref: j.id ?? null };
}

async function sendSms(db: Db, toE164: string, fromNumber: string, text: string, channel: 'sms' | 'whatsapp'): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
	// The Open Ronin sub-account connection (0007 / 0123). Private token or OAuth.
	const { data } = await db.from('ghl_connections').select('id, ghl_location_id, org, is_default').is('disconnected_at', null).order('installed_at');
	const rows = (data ?? []) as { id: string; ghl_location_id: string | null; org: string | null; is_default: boolean }[];
	const conn = rows.find((c) => c.org === 'main') ?? rows.find((c) => c.is_default) ?? rows[0];
	if (!conn) return { ok: false, error: 'No GHL connection: connect the Open Ronin sub-account in Admin → Connections, then resend.' };
	try {
		const { ghlFetch } = await import('@/lib/ghl/client');
		// 1) upsert the contact by phone in the location
		const up = await ghlFetch<{ contact?: { id: string } }>(conn.id, '/contacts/upsert', { method: 'POST', body: JSON.stringify({ locationId: conn.ghl_location_id, phone: toE164, tags: ['hiring'] }) });
		const contactId = up.contact?.id;
		if (!contactId) return { ok: false, error: 'GHL contact upsert returned no id.' };
		// 2) send through conversations
		const msg = await ghlFetch<{ messageId?: string; conversationId?: string }>(conn.id, '/conversations/messages', { method: 'POST', body: JSON.stringify({ type: channel === 'whatsapp' ? 'WhatsApp' : 'SMS', contactId, message: text, fromNumber }) });
		return { ok: true, ref: msg.messageId ?? msg.conversationId ?? null };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'GHL send failed' };
	}
}

export interface DraftInput {
	application_id: string | null;
	candidate_id: string;
	interview_id?: string | null;
	template_key: string | null;
	channel: Channel;
	vars: MessageVars;
	to: string;
	subject?: string | null;
	body_md?: string | null;
	drafted_by: string | null;
	scheduled_for?: string | null;
}

/** Draft a message from a template (or raw subject/body) into hire_messages. Nothing is sent. */
export async function draftMessage(db: Db, input: DraftInput): Promise<{ ok: true; id: string; subject: string | null; body: string } | { ok: false; error: string }> {
	let subject = input.subject ?? null;
	let body = input.body_md ?? '';
	if (input.template_key) {
		const { data } = await db.from('hire_message_templates').select('subject, body_md, channel').eq('key', input.template_key).maybeSingle();
		const t = data as { subject: string | null; body_md: string; channel: Channel } | null;
		if (!t) return { ok: false, error: `Template ${input.template_key} not found.` };
		subject = subject ?? (t.subject ? renderTemplate(t.subject, input.vars) : null);
		body = body || renderTemplate(t.body_md, input.vars);
	}
	if (input.channel !== 'email') body = toSmsText(body);
	if (!body.trim()) return { ok: false, error: 'Empty message.' };
	const senders = await loadSenders(db);
	const { data, error } = await db
		.from('hire_messages')
		.insert({ application_id: input.application_id, candidate_id: input.candidate_id, interview_id: input.interview_id ?? null, channel: input.channel, template_key: input.template_key, to_address: input.to, from_address: input.channel === 'email' ? senders.email : senders.sms_number, subject: input.channel === 'email' ? subject : null, body_md: body, status: 'draft', drafted_by: input.drafted_by, scheduled_for: input.scheduled_for ?? null })
		.select('id')
		.single();
	if (error) return { ok: false, error: error.message };
	return { ok: true, id: (data as { id: string }).id, subject, body };
}

/** Send one APPROVED message through its channel. Service role. */
export async function sendMessage(db: Db, messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	const { data } = await db.from('hire_messages').select('*').eq('id', messageId).maybeSingle();
	const m = data as { id: string; status: string; channel: Channel; to_address: string; from_address: string | null; subject: string | null; body_md: string; candidate_id: string; application_id: string | null } | null;
	if (!m) return { ok: false, error: 'Message not found.' };
	if (m.status !== 'approved') return { ok: false, error: `Message is ${m.status}; approve it first.` };
	const senders = await loadSenders(db);
	const r = m.channel === 'email' ? await sendEmail(m.to_address, m.from_address ?? senders.email, m.subject ?? '(no subject)', m.body_md) : await sendSms(db, m.to_address, m.from_address ?? senders.sms_number, m.body_md, m.channel);
	if (!r.ok) {
		await db.from('hire_messages').update({ error: r.error }).eq('id', messageId);
		return r;
	}
	await db.from('hire_messages').update({ status: 'sent', sent_at: new Date().toISOString(), provider: m.channel === 'email' ? 'resend' : 'ghl', provider_ref: r.ref, error: null }).eq('id', messageId);
	if (m.application_id) await db.from('hire_application_events').insert({ application_id: m.application_id, kind: 'message', summary: `${m.channel} sent: ${m.subject ?? m.body_md.slice(0, 60)}`, payload: { message_id: messageId, channel: m.channel } });
	return { ok: true };
}

/** Cron: send approved messages whose scheduled_for has passed (reminders) or is null. */
export async function sendDue(db: Db, limit = 20): Promise<{ sent: number; failed: string[] }> {
	const { data } = await db.from('hire_messages').select('id').eq('status', 'approved').is('sent_at', null).or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`).order('created_at').limit(limit);
	const out = { sent: 0, failed: [] as string[] };
	for (const m of (data ?? []) as { id: string }[]) {
		const r = await sendMessage(db, m.id);
		if (r.ok) out.sent++;
		else out.failed.push(`${m.id.slice(0, 8)}: ${r.error}`);
	}
	return out;
}

/** Vars for a candidate + position (+ sender). */
export async function messageVars(db: Db, applicationId: string, senderId: string | null): Promise<{ vars: MessageVars; candidate: { id: string; full_name: string; email: string; phone_e164: string | null }; position: { id: string; title: string; brand: string } } | null> {
	const { data } = await db.from('hire_applications').select('id, candidate:hire_candidates!hire_applications_candidate_id_fkey(id, full_name, email, phone_e164), position:hire_positions!hire_applications_position_id_fkey(id, title, brand)').eq('id', applicationId).maybeSingle();
	const a = data as unknown as { candidate: { id: string; full_name: string; email: string; phone_e164: string | null }; position: { id: string; title: string; brand: string } } | null;
	if (!a?.candidate || !a.position) return null;
	let sender = { name: 'The Open Ronin hiring team', title: '' };
	if (senderId) {
		const { data: p } = await db.from('profiles').select('first_name, last_name, job_role, title').eq('id', senderId).maybeSingle();
		const pr = p as { first_name: string | null; last_name: string | null; job_role: string | null; title: string | null } | null;
		if (pr) sender = { name: [pr.first_name, pr.last_name].filter(Boolean).join(' '), title: pr.job_role ?? pr.title ?? '' };
	}
	const brand = ({ main: 'Open Ronin', premium: 'Premium', beacon: 'Beacon' } as Record<string, string>)[a.position.brand] ?? 'Open Ronin';
	return {
		vars: { first_name: firstName(a.candidate.full_name), full_name: a.candidate.full_name, position: a.position.title, brand, sender_name: sender.name, sender_title: sender.title, signature: `${sender.name}${sender.title ? `\n${sender.title}` : ''}\n${brand}` },
		candidate: a.candidate,
		position: a.position,
	};
}
