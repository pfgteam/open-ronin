// Submission notifications (0158). One email per submission to the form's
// notify_emails through Resend, the same sender the hiring and Flywheel
// mailers use. No key -> an honest error recorded on the row, never a throw.

import type { FormField, FormValues } from './logic';
import { answerText, appUrl, type UploadedFile } from './shared';

export function notifyConfigured(): boolean {
	return !!process.env.RESEND_API_KEY;
}

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface NotifyInput {
	to: string[];
	form: { slug: string; title: string; brand_label: string | null; confidential?: boolean };
	fields: FormField[];
	data: FormValues;
	files: UploadedFile[];
	submission_id: string;
	source_url: string | null;
	utm: Record<string, string>;
	created_at: string;
}

/** Subject + plain text + HTML for one submission. Pure, so it is testable. */
export function renderNotification(n: NotifyInput): { subject: string; text: string; html: string } {
	const inbox = `${appUrl()}/data/forms/${n.form.slug}/submissions/${n.submission_id}`;
	const nameKey = n.fields.find((f) => f.key === 'name' || f.type === 'text')?.key;
	const who = nameKey ? answerText(undefined, n.data[nameKey]) : '';
	const subject = `${n.form.confidential ? '[CONFIDENTIAL] ' : ''}[${n.form.title}] New submission${who ? ` from ${who}` : ''}`;
	const rows = n.fields.map((f) => ({ label: f.label, value: answerText(f, n.data[f.key], n.files) }));
	const meta: [string, string][] = ([
		['Submitted', n.created_at],
		['Source page', n.source_url ?? ''],
		...Object.entries(n.utm),
	] as [string, string][]).filter(([, v]) => !!v);

	const text = [
		`${n.form.title} — new submission`,
		'',
		...rows.map((r) => `${r.label}: ${r.value || '—'}`),
		'',
		...meta.map(([k, v]) => `${k}: ${v}`),
		'',
		`Open in Open Ronin: ${inbox}`,
	].join('\n');

	const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:640px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">${esc(n.form.brand_label ?? 'Open Ronin')} · Forms${n.form.confidential ? ' · <span style="color:#b91c1c">Confidential</span>' : ''}</p>
<h2 style="margin:0 0 16px;font-size:20px">${esc(n.form.title)}: new submission</h2>
<table style="border-collapse:collapse;width:100%">${rows
		.map((r) => `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;color:#64748b;white-space:nowrap">${esc(r.label)}</td><td style="padding:6px 0;vertical-align:top;white-space:pre-wrap">${r.value ? esc(r.value) : '<span style="color:#cbd5e1">—</span>'}</td></tr>`)
		.join('')}</table>
${meta.length ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${meta.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}</p>` : ''}
<p style="margin:20px 0 0"><a href="${esc(inbox)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600">Open in Open Ronin</a></p>
</div>`;
	return { subject, text, html };
}

export async function sendNotification(n: NotifyInput): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
	const key = process.env.RESEND_API_KEY;
	if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
	const to = n.to.map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
	if (!to.length) return { ok: false, error: 'no valid notify_emails' };
	const from = process.env.RESEND_FROM_EMAIL || 'forms@example.com';
	const fromName = `${n.form.brand_label ?? 'Open Ronin'} Forms`;
	const replyTo = typeof n.data.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n.data.email) ? n.data.email : undefined;
	const { subject, text, html } = renderNotification(n);
	try {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify({ from: `${fromName} <${from}>`, to, ...(replyTo ? { reply_to: replyTo } : {}), subject, html, text }),
		});
		if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
		const j = (await res.json()) as { id?: string };
		return { ok: true, ref: j.id ?? null };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
	}
}
