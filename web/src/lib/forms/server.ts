// Public forms, server side (0158). The one place a signed-out fill is
// accepted: loadPublicForm() gates, submitPublicForm() validates, rate
// limits, stores and notifies. Both the hosted page (/f/<slug>) and the
// JSON door (/api/f/<slug>) call these, so an MQL move later is a gate
// change, not a rewrite.

import { createServiceRoleClient } from '@/lib/supabase/server';
import { finalizeSubmission, parseFields, type FormField, type FormValues } from './logic';
import { sendNotification } from './notify';
import { HONEYPOT_KEY, utmFromUrl, type PublicFormDef, type SubmitResult, type UploadedFile } from './shared';

export const SLUG_RE = /^[a-z0-9-]{2,64}$/;

// In-memory burst guard per instance; the durable limit is the IP count in
// form_submissions over the last 10 minutes (index form_submissions_ip_idx).
const WINDOW_MS = 10 * 60_000;
const BURST_LIMIT = 20;
const DB_LIMIT = 10;
const hits = new Map<string, number[]>();

function burstLimited(ip: string): boolean {
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	list.push(now);
	hits.set(ip, list);
	if (hits.size > 5000) hits.clear();
	return list.length > BURST_LIMIT;
}

interface FormRow {
	id: string;
	slug: string;
	title: string;
	description_md: string | null;
	status: string;
	fields: unknown;
	is_public: boolean;
	request_type: string | null;
	notify_emails: string[] | null;
	success_message: string | null;
	redirect_url: string | null;
	submit_label: string | null;
	brand_label: string | null;
	confidential: boolean;
	success_cta_label: string | null;
	success_cta_url: string | null;
}

const FORM_COLS = 'id, slug, title, description_md, status, fields, is_public, request_type, notify_emails, success_message, redirect_url, submit_label, brand_label, confidential, success_cta_label, success_cta_url';

export interface LoadedForm {
	row: FormRow;
	fields: FormField[];
	def: PublicFormDef;
	/** The form also feeds the Revenue Engine (rev_form_links public+enabled). */
	revLinked: boolean;
}

/** The form if it may be filled signed-out: open AND (is_public OR a public rev_form_links row). */
export async function loadPublicForm(slug: string): Promise<LoadedForm | null> {
	if (!SLUG_RE.test(slug)) return null;
	const db = createServiceRoleClient();
	const { data } = await db.from('forms').select(FORM_COLS).eq('slug', slug).maybeSingle();
	const row = data as FormRow | null;
	if (!row || row.status !== 'open') return null;
	let revLinked = false;
	if (!row.is_public) {
		const { data: link } = await db.from('rev_form_links').select('public, enabled').eq('form_id', row.id).maybeSingle();
		revLinked = !!(link?.public && link.enabled);
		if (!revLinked) return null;
	} else {
		const { data: link } = await db.from('rev_form_links').select('enabled').eq('form_id', row.id).maybeSingle();
		revLinked = !!link?.enabled;
	}
	let fields: FormField[];
	try {
		fields = parseFields(row.fields);
	} catch {
		return null;
	}
	const pages = (Array.isArray(row.fields) ? (row.fields as { key: string; page?: number }[]) : []).reduce<Record<string, number>>((acc, f) => {
		acc[f.key] = typeof f.page === 'number' && f.page > 0 ? f.page : 1;
		return acc;
	}, {});
	return {
		row,
		fields,
		revLinked,
		def: {
			slug: row.slug,
			title: row.title,
			description: row.description_md,
			fields,
			pages,
			submit_label: row.submit_label || 'Submit',
			brand_label: row.brand_label || 'Open Ronin',
			success_message: row.success_message,
			redirect_url: row.redirect_url,
			success_cta_label: row.success_cta_label,
			success_cta_url: row.success_cta_url,
			turnstile_site_key: process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : null,
		},
	};
}

export interface SubmitMeta {
	ip: string;
	user_agent: string | null;
	/** The page the form sat on (embed parent or the hosted page). */
	source_url: string | null;
	referrer: string | null;
	turnstile_token?: string | null;
}

export type SubmitOutcome = SubmitResult | { ok: false; status: number; error: string };

async function turnstileOk(token: string | null | undefined, ip: string): Promise<boolean> {
	const secret = process.env.TURNSTILE_SECRET_KEY;
	if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true; // not configured: honeypot + rate limit only
	if (!token) return false;
	try {
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ secret, response: token, remoteip: ip }),
		});
		const j = (await res.json()) as { success?: boolean };
		return !!j.success;
	} catch {
		return false;
	}
}

/** Validate, store and notify one signed-out fill. */
export async function submitPublicForm(slug: string, raw: unknown, meta: SubmitMeta): Promise<SubmitOutcome> {
	if (!raw || typeof raw !== 'object') return { ok: false, status: 400, error: 'Nothing to submit.' };
	const values = raw as Record<string, unknown>;
	if (burstLimited(meta.ip)) return { ok: false, status: 429, error: 'Too many submissions. Try again in a few minutes.' };

	const loaded = await loadPublicForm(slug);
	if (!loaded) return { ok: false, status: 404, error: 'This form is not available.' };
	const { row, fields } = loaded;

	// Honeypot: say thanks, store nothing.
	if (typeof values[HONEYPOT_KEY] === 'string' && values[HONEYPOT_KEY]) {
		return { ok: true, submission_id: '00000000-0000-0000-0000-000000000000', success_message: row.success_message, redirect_url: row.redirect_url, success_cta_label: row.success_cta_label, success_cta_url: row.success_cta_url };
	}
	if (!(await turnstileOk(meta.turnstile_token, meta.ip))) return { ok: false, status: 400, error: 'Please complete the verification and try again.' };

	const db = createServiceRoleClient();
	if (meta.ip && meta.ip !== 'unknown') {
		const since = new Date(Date.now() - WINDOW_MS).toISOString();
		const { count } = await db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('ip', meta.ip).gte('created_at', since);
		if ((count ?? 0) >= DB_LIMIT) return { ok: false, status: 429, error: 'Too many submissions. Try again in a few minutes.' };
	}

	const { data, errors } = finalizeSubmission(fields, values as FormValues);
	if (errors.length) return { ok: false, status: 400, error: errors.join(' ') };

	// File fields: the value is the path the upload door returned; it must sit
	// under this form's prefix and exist in the bucket.
	const files: UploadedFile[] = [];
	for (const f of fields.filter((x) => x.type === 'file')) {
		const p = data[f.key];
		if (typeof p !== 'string' || !p) continue;
		if (!p.startsWith(`${row.id}/`) || p.includes('..')) return { ok: false, status: 400, error: `${f.label}: invalid upload.` };
		const dir = p.slice(0, p.lastIndexOf('/'));
		const name = p.slice(p.lastIndexOf('/') + 1);
		const { data: objs } = await db.storage.from('form-uploads').list(dir, { search: name, limit: 5 });
		const obj = (objs ?? []).find((o) => o.name === name);
		if (!obj) return { ok: false, status: 400, error: `${f.label}: upload not found, please attach it again.` };
		const m = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
		files.push({ key: f.key, path: p, name: name.replace(/^[0-9a-f-]{36}-/, ''), size: Number(m.size ?? 0), type: String(m.mimetype ?? '') });
	}

	const source_url = meta.source_url?.slice(0, 2000) ?? null;
	const utm = utmFromUrl(source_url);
	const { data: sub, error } = await db
		.from('form_submissions')
		.insert({
			form_id: row.id,
			submitted_by: null,
			data,
			files,
			source_url,
			referrer: meta.referrer?.slice(0, 2000) ?? null,
			utm,
			ip: meta.ip === 'unknown' ? null : meta.ip.slice(0, 64),
			user_agent: meta.user_agent?.slice(0, 500) ?? null,
		})
		.select('id, created_at')
		.single();
	if (error || !sub) return { ok: false, status: 500, error: 'Could not save. Please try again.' };

	// Notify (per-form list). Failures land on the row, never on the filler.
	const to = (row.notify_emails ?? []).filter(Boolean);
	if (to.length) {
		const res = await sendNotification({
			to,
			form: { slug: row.slug, title: row.title, brand_label: row.brand_label, confidential: row.confidential },
			fields,
			data,
			files,
			submission_id: sub.id as string,
			source_url,
			utm,
			created_at: String(sub.created_at),
		});
		await db
			.from('form_submissions')
			.update(res.ok ? { notified_at: new Date().toISOString(), notify_error: null } : { notify_error: res.error.slice(0, 500) })
			.eq('id', sub.id);
	}

	// Revenue Engine routing when the form is linked (0122 trigger ran in the insert).
	let routing: string | null | undefined;
	if (loaded.revLinked) {
		const { data: ev } = await db.from('rev_intake_events').select('deal_id').eq('external_id', `form:${sub.id}`).maybeSingle();
		if (ev?.deal_id) {
			const { data: deal } = await db.from('rev_deals').select('routing').eq('id', ev.deal_id).maybeSingle();
			routing = (deal as { routing: string | null } | null)?.routing ?? null;
		}
	}

	return { ok: true, submission_id: sub.id as string, success_message: row.success_message, redirect_url: row.redirect_url, success_cta_label: row.success_cta_label, success_cta_url: row.success_cta_url, ...(routing !== undefined ? { routing } : {}) };
}

/** Client IP from the request, Vercel-style. */
export function clientIp(request: Request): string {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}
