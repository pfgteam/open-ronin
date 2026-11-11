// Reports + comms (F6, 0146). Server-only, service role.
//   buildReportData   assembles the template's data set for one client +
//                     window (flywheel assets, media opps, approvals, portal
//                     notes, audit, google metrics, asset views, events).
//   draftReport       AI narrative from the template's prompt → fw_reports
//                     row in awaiting_review (Alex's pipeline:
//                     ai_generated → awaiting_review → approved → sent →
//                     delivered → opened).
//   sendReport        approved → Resend (open pixel appended) → sent.
//   sendDueReminders  queued fw_reminders → Resend.
//   weeklyRecaps / monthlyReports  cron drafters.

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractJson, generateText } from './ai';

type Db = SupabaseClient;

export interface ReportTemplateRow {
	key: string;
	label: string;
	kind: 'weekly_recap' | 'monthly_report' | 'welcome' | 'quarterly' | 'custom';
	package_key: string | null;
	subject_tpl: string;
	body_tpl: string;
	data_set: { window?: string; sources?: string[]; filters?: Record<string, unknown>; metric_keys?: string[] };
	agent_key: string | null;
	ai_system_md: string | null;
	send_from: string | null;
	requires_approval: boolean;
	show_in_portal: boolean;
	is_active: boolean;
}

export interface ReportRow {
	id: string;
	client_id: string;
	program_id: string | null;
	template_key: string | null;
	kind: ReportTemplateRow['kind'];
	period_from: string;
	period_to: string;
	to_email: string | null;
	to_name: string | null;
	from_email: string | null;
	subject: string | null;
	data: Record<string, unknown>;
	draft_md: string | null;
	body_md: string | null;
	status: 'ai_generated' | 'awaiting_review' | 'approved' | 'sent' | 'delivered' | 'opened' | 'failed' | 'cancelled';
	reviewed_at: string | null;
	approved_at: string | null;
	sent_at: string | null;
	opened_at: string | null;
	open_count: number;
	error: string | null;
	show_in_portal: boolean;
	created_at: string;
}

function fill(tpl: string, vars: Record<string, string | null | undefined>): string {
	return tpl.replace(/\{\{([a-z_]+)\}\}/g, (_m, k: string) => vars[k] ?? '');
}

export async function buildReportData(db: Db, clientId: string, programId: string | null, from: string, to: string, sources: string[]): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = { window: { from, to } };
	const want = new Set(sources);
	if (want.has('flywheel_assets') && programId) {
		const [{ data: pages }, { data: cits }, { data: videos }, { data: clusters }, { count: pagesTotal }, { count: pagesLive }, { count: citsTotal }] = await Promise.all([
			db.from('fw_pages').select('number, keyword, title, status, live_url, live_at, approved_at').eq('program_id', programId).gte('updated_at', from).order('number'),
			db.from('fw_citations').select('channel_key, title, url, posted_on, status').eq('program_id', programId).in('status', ['posted', 'live']).gte('posted_on', from).lte('posted_on', to),
			db.from('fw_videos').select('month, title, status, shoot_at, youtube_url').eq('program_id', programId).gte('updated_at', from),
			db.from('fw_clusters').select('number, anchor_keyword, status, plan_status, starts_on, ends_on').eq('program_id', programId).order('number'),
			db.from('fw_pages').select('id', { count: 'exact', head: true }).eq('program_id', programId),
			db.from('fw_pages').select('id', { count: 'exact', head: true }).eq('program_id', programId).eq('status', 'live'),
			db.from('fw_citations').select('id', { count: 'exact', head: true }).eq('program_id', programId).in('status', ['posted', 'live']),
		]);
		out.flywheel = { pages_touched: pages ?? [], citations_shipped: cits ?? [], videos: videos ?? [], clusters: clusters ?? [], cumulative: { pages_live: pagesLive ?? 0, pages_total: pagesTotal ?? 0, citations_shipped: citsTotal ?? 0 } };
	}
	if (want.has('media_opps')) {
		const { data } = await db.from('media_opportunities').select('title, outlet_name, status_raw, date_secured, live_link, live_date, reach').eq('client_id', clientId).gte('updated_at', from).limit(50);
		out.media_opps = data ?? [];
	}
	if (want.has('approvals')) {
		const { data } = await db.from('fw_approvals').select('kind, title, status, requested_at, due_at, decided_at, client_comment').eq('client_id', clientId).or(`status.eq.pending,decided_at.gte.${from}`).limit(30);
		out.approvals = data ?? [];
	}
	if (want.has('portal_notes')) {
		const { data } = await db.from('fw_portal_notes').select('kind, title, status, created_at').eq('client_id', clientId).gte('created_at', from).limit(30);
		out.portal_notes = data ?? [];
	}
	if (want.has('audit') && programId) {
		const { data: runs } = await db.from('fw_audit_runs').select('kind, period_month, finished_at, presence_rate, core_presence_rate, avg_position, sov, misinfo_count').eq('program_id', programId).eq('status', 'done').order('finished_at', { ascending: false }).limit(3);
		const { data: base } = await db.from('fw_audit_runs').select('presence_rate, core_presence_rate, sov, period_month').eq('program_id', programId).eq('status', 'done').order('finished_at', { ascending: true }).limit(1).maybeSingle();
		out.audit = { recent: runs ?? [], baseline: base ?? null };
	}
	if (want.has('google_metrics')) {
		const { data } = await db.from('fw_google_metrics').select('source, period_from, period_to, dimension, metrics').eq('client_id', clientId).order('period_to', { ascending: false }).limit(60);
		out.google = data ?? [];
	}
	if (want.has('asset_views')) {
		const { data } = await db.from('fw_asset_views').select('asset_kind, url, source, day, views').eq('client_id', clientId).gte('day', from).lte('day', to).limit(200);
		const rows = (data ?? []) as { asset_kind: string; url: string | null; source: string; day: string; views: number }[];
		out.asset_views = { total: rows.reduce((s, r) => s + r.views, 0), by_kind: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.asset_kind]: (acc[r.asset_kind] ?? 0) + r.views }), {}), top: rows.sort((a, b) => b.views - a.views).slice(0, 10) };
	}
	if (want.has('events') && programId) {
		const { data } = await db.from('fw_events').select('kind, summary, created_at').eq('program_id', programId).eq('client_visible', true).gte('created_at', from).order('created_at').limit(60);
		out.events = data ?? [];
	}
	return out;
}

async function recipient(db: Db, clientId: string): Promise<{ email: string | null; name: string | null }> {
	const { data } = await db.from('fw_portal_users').select('email, display_name').eq('client_id', clientId).eq('is_active', true).order('is_primary', { ascending: false }).limit(1).maybeSingle();
	const u = data as { email: string; display_name: string | null } | null;
	return { email: u?.email ?? null, name: u?.display_name ?? null };
}

async function senders(db: Db): Promise<{ email: string; reply_to: string; name: string }> {
	const { data } = await db.from('fw_settings').select('value').eq('key', 'senders').maybeSingle();
	const v = ((data as { value?: Record<string, string> } | null)?.value ?? {}) as Record<string, string>;
	return { email: v.email ?? 'flywheel@example.com', reply_to: v.reply_to ?? v.email ?? 'flywheel@example.com', name: v.label ?? 'Flywheel' };
}

/** Draft one report (AI narrative) for a client + template + window. Lands in awaiting_review (or ai_generated when AI is off: the template with blanks). */
export async function draftReport(db: Db, input: { client_id: string; program_id: string | null; template_key: string; from: string; to: string; created_by: string | null }): Promise<{ ok: true; id: string; ai: boolean } | { ok: false; error: string }> {
	const { data: t } = await db.from('fw_report_templates').select('*').eq('key', input.template_key).maybeSingle();
	const tpl = t as ReportTemplateRow | null;
	if (!tpl || !tpl.is_active) return { ok: false, error: 'Template not found.' };
	const [{ data: client }, { data: strategist }, to, from] = await Promise.all([
		db.from('clients_v2').select('display_name').eq('id', input.client_id).maybeSingle(),
		input.program_id ? db.from('fw_program_members').select('profile:profiles!fw_program_members_user_id_fkey(first_name, last_name)').eq('program_id', input.program_id).eq('role', 'strategist').limit(1).maybeSingle() : Promise.resolve({ data: null }),
		recipient(db, input.client_id),
		senders(db),
	]);
	const clientName = (client as { display_name: string } | null)?.display_name ?? 'Client';
	const sp = (strategist as unknown as { profile: { first_name: string | null; last_name: string | null } | null } | null)?.profile;
	const senderName = sp ? [sp.first_name, sp.last_name].filter(Boolean).join(' ') : from.name;
	const { data: portal } = await db.from('fw_settings').select('value').eq('key', 'portal').maybeSingle();
	const pv = ((portal as { value?: Record<string, string> } | null)?.value ?? {}) as Record<string, string>;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const data = await buildReportData(db, input.client_id, input.program_id, input.from, input.to, tpl.data_set.sources ?? []);
	const vars: Record<string, string> = { client_name: clientName, first_name: (to.name ?? 'there').split(' ')[0], sender_name: senderName, week_of: input.from, month: new Date(input.to + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), book_call_url: pv.book_call_url ?? '', portal_url: `${appUrl}/portal` };
	let ai = false;
	if (tpl.ai_system_md && (tpl.data_set.sources ?? []).length > 0) {
		const r = await generateText(tpl.ai_system_md, `CLIENT: ${clientName}\nWINDOW: ${input.from} → ${input.to}\n\nDATA:\n${JSON.stringify(data).slice(0, 60_000)}`, 2500);
		if (r.ok) {
			const j = extractJson<Record<string, string>>(r.text);
			if (j) {
				for (const [k, v] of Object.entries(j)) vars[k] = typeof v === 'string' ? v : JSON.stringify(v);
				ai = true;
			}
		}
	}
	const body = fill(tpl.body_tpl, vars).replace(/\{\{[a-z_]+\}\}/g, '[fill in]');
	const subject = fill(tpl.subject_tpl, vars);
	const values = { client_id: input.client_id, program_id: input.program_id, template_key: tpl.key, kind: tpl.kind, period_from: input.from, period_to: input.to, to_email: to.email, to_name: to.name, from_email: tpl.send_from ?? from.email, subject, data, draft_md: body, body_md: body, status: ai ? 'awaiting_review' : 'ai_generated', show_in_portal: tpl.show_in_portal, created_by: input.created_by };
	// One live report per (client, kind, window): fw_reports_period_uq (0146) is a
	// PARTIAL unique index (status not in cancelled / failed), which PostgREST's
	// `on_conflict=` cannot name (42P10). Find the live slot first, then update
	// or insert. A sent / delivered / opened report is never overwritten.
	const { data: existing, error: findError } = await db
		.from('fw_reports')
		.select('id, status')
		.eq('client_id', input.client_id)
		.eq('kind', tpl.kind)
		.eq('period_from', input.from)
		.eq('period_to', input.to)
		.not('status', 'in', '("cancelled","failed")')
		.limit(1)
		.maybeSingle();
	if (findError) return { ok: false, error: findError.message };
	const live = existing as { id: string; status: string } | null;
	const window_ = `${input.from} → ${input.to}`;
	if (live && ['sent', 'delivered', 'opened'].includes(live.status)) return { ok: false, error: `A ${tpl.kind.replace('_', ' ')} for ${window_} was already sent to this client.` };
	// A report someone is already reviewing (or has approved) keeps its edits:
	// only an untouched AI draft is regenerated in place.
	if (live && live.status !== 'ai_generated') return { ok: false, error: `A ${tpl.kind.replace('_', ' ')} for ${window_} is already ${live.status === 'approved' ? 'approved' : 'in review'}. Edit or cancel it first.` };
	if (live) {
		const regen: Partial<typeof values> = { ...values };
		delete regen.created_by; // the first drafter stays on the row
		const { error } = await db.from('fw_reports').update(regen).eq('id', live.id);
		if (error) return { ok: false, error: error.message };
		return { ok: true, id: live.id, ai };
	}
	const { data: row, error } = await db.from('fw_reports').insert(values).select('id').single();
	// Two drafters racing between the find and the insert: the partial index wins.
	if (error?.code === '23505') return { ok: false, error: `A ${tpl.kind.replace('_', ' ')} for ${window_} was just drafted by someone else. Refresh.` };
	if (error) return { ok: false, error: error.message };
	return { ok: true, id: (row as { id: string }).id, ai };
}

function mdToHtml(md: string): string {
	return md
		.split(/\n{2,}/)
		.map((p) => `<p style="margin:0 0 12px">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`)
		.join('');
}

async function sendEmail(to: string, from: string, fromName: string, replyTo: string, subject: string, md: string, pixelUrl: string | null): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
	const key = process.env.RESEND_API_KEY;
	if (!key) return { ok: false, error: 'RESEND_API_KEY not set: copy the text and send by hand.' };
	const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:640px">${mdToHtml(md)}${pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">` : ''}</div>`;
	const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], reply_to: replyTo, subject, html, text: md }) });
	if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
	return { ok: true, ref: ((await res.json()) as { id?: string }).id ?? null };
}

/** Send one APPROVED report. Service role. */
export async function sendReport(db: Db, reportId: string, sentBy: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
	const { data } = await db.from('fw_reports').select('*').eq('id', reportId).maybeSingle();
	const r = data as (ReportRow & { open_token: string }) | null;
	if (!r) return { ok: false, error: 'Report not found.' };
	if (r.status !== 'approved') return { ok: false, error: `Report is ${r.status}; approve it first.` };
	if (!r.to_email) return { ok: false, error: 'No portal contact on this client to send to — invite one first.' };
	const s = await senders(db);
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const res = await sendEmail(r.to_email, r.from_email ?? s.email, 'Open Ronin', s.reply_to, r.subject ?? r.kind, r.body_md ?? '', `${appUrl}/api/portal/open/${r.open_token}.gif`);
	if (!res.ok) {
		await db.from('fw_reports').update({ error: res.error }).eq('id', reportId);
		return res;
	}
	await db.from('fw_reports').update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: sentBy, provider: 'resend', provider_ref: res.ref, error: null }).eq('id', reportId);
	return { ok: true };
}

/** Queued client reminders → email (service role). */
export async function sendDueReminders(db: Db, limit = 20): Promise<{ sent: number; failed: number }> {
	const { data } = await db.from('fw_reminders').select('id, client_id, program_id, approval_id, to_email, subject, body_md').eq('status', 'queued').eq('channel', 'email').order('created_at').limit(limit);
	const out = { sent: 0, failed: 0 };
	const s = await senders(db);
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	for (const r of (data ?? []) as { id: string; client_id: string; program_id: string; approval_id: string | null; to_email: string | null; subject: string | null; body_md: string | null }[]) {
		if (!r.to_email) {
			await db.from('fw_reminders').update({ status: 'skipped', error: 'no portal contact' }).eq('id', r.id);
			continue;
		}
		const { data: a } = r.approval_id ? await db.from('fw_approvals').select('title, due_at').eq('id', r.approval_id).maybeSingle() : { data: null };
		const ap = a as { title: string; due_at: string | null } | null;
		const to = await recipient(db, r.client_id);
		const body = fill(r.body_md ?? '', { first_name: (to.name ?? 'there').split(' ')[0], title: ap?.title ?? '', portal_url: `${appUrl}/portal?tab=approvals`, window_line: ap?.due_at ? `If we don't hear back it's approved automatically on ${ap.due_at.slice(0, 10)} (your auto-approve setting).` : '', sender_name: s.name });
		const res = await sendEmail(r.to_email, s.email, 'Open Ronin', s.reply_to, r.subject ?? 'Waiting for your OK', body, null);
		await db.from('fw_reminders').update(res.ok ? { status: 'sent', sent_at: new Date().toISOString(), provider_ref: res.ref } : { status: 'failed', error: res.error }).eq('id', r.id);
		if (res.ok) out.sent++;
		else out.failed++;
	}
	return out;
}

/** Fridays: draft the recap for every open program (window = the last 7 days). */
export async function weeklyRecaps(db: Db): Promise<{ drafted: number; errors: string[] }> {
	const now = new Date();
	const to = now.toISOString().slice(0, 10);
	const from = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
	const out = { drafted: 0, errors: [] as string[] };
	const { data: programs } = await db.from('fw_programs').select('id, client_id').in('status', ['onboarding', 'active']);
	for (const p of (programs ?? []) as { id: string; client_id: string }[]) {
		const { count } = await db.from('fw_reports').select('id', { count: 'exact', head: true }).eq('client_id', p.client_id).eq('kind', 'weekly_recap').gte('period_to', from).neq('status', 'cancelled');
		if ((count ?? 0) > 0) continue;
		const r = await draftReport(db, { client_id: p.client_id, program_id: p.id, template_key: 'friday_recap', from, to, created_by: null });
		if (r.ok) out.drafted++;
		else out.errors.push(`${p.id.slice(0, 8)}: ${r.error}`);
	}
	return out;
}

/** Day 3 of the month: draft the previous month's one-page report for every active Flywheel program. */
export async function monthlyReports(db: Db): Promise<{ drafted: number; errors: string[] }> {
	const now = new Date();
	const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const prevFirst = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
	const prevLast = new Date(first.getTime() - 86_400_000);
	const from = prevFirst.toISOString().slice(0, 10);
	const to = prevLast.toISOString().slice(0, 10);
	const out = { drafted: 0, errors: [] as string[] };
	const { data: programs } = await db.from('fw_programs').select('id, client_id').eq('status', 'active').eq('package_key', 'flywheel');
	for (const p of (programs ?? []) as { id: string; client_id: string }[]) {
		const { count } = await db.from('fw_reports').select('id', { count: 'exact', head: true }).eq('client_id', p.client_id).eq('kind', 'monthly_report').eq('period_from', from).neq('status', 'cancelled');
		if ((count ?? 0) > 0) continue;
		const r = await draftReport(db, { client_id: p.client_id, program_id: p.id, template_key: 'monthly_report', from, to, created_by: null });
		if (r.ok) out.drafted++;
		else out.errors.push(`${p.id.slice(0, 8)}: ${r.error}`);
	}
	return out;
}
