'use server';

// Forms server actions (0086). Builders (admin/exec/people-managers, via
// can_build_forms + RLS) create and edit; anyone signed in submits to an
// open form. Conditional logic is applied server-side at submit so hidden
// fields are never stored.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { finalizeSubmission, parseFields, validateFields, type FormValues } from '@/lib/forms/logic';
import { SUBMISSION_STATUSES } from '@/lib/forms/shared';
import { explainAndLog } from '@/lib/errors';

const TOOL = '/data/forms';

type Result = { ok: true; id?: string } | { ok: false; error: string };

const FormInput = z.object({
	id: z.string().uuid().optional(),
	slug: z.string().regex(/^[a-z0-9-]{2,64}$/, 'Slug: lowercase letters, digits, dashes.'),
	title: z.string().trim().min(2).max(160),
	description_md: z.string().trim().max(4000).nullable(),
	status: z.enum(['draft', 'open', 'closed']),
	allow_multiple: z.boolean(),
	anonymous_ok: z.boolean(),
	fields: z.unknown(),
	// 0158: public hosting + notifications + inbox
	is_public: z.boolean().default(false),
	confidential: z.boolean().default(false),
	request_type: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/, 'Request type: lowercase letters, digits, dashes.').nullable().default(null),
	notify_emails: z.array(z.string().trim().email('Notify: one valid email per line.')).max(20).default([]),
	success_message: z.string().trim().max(2000).nullable().default(null),
	redirect_url: z.string().trim().url('Redirect: a full https:// URL.').max(2000).nullable().default(null),
	submit_label: z.string().trim().max(60).nullable().default(null),
	brand_label: z.string().trim().max(80).nullable().default(null),
	success_cta_label: z.string().trim().max(120).nullable().default(null),
	success_cta_url: z.string().trim().url('Thank-you button: a full https:// URL.').max(2000).nullable().default(null),
	submission_tags: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/, 'Tag keys: lowercase letters, digits, underscore.'), z.string().trim().max(120)).default({}),
});

// Reserved under /f/<slug>: a static segment wins over [slug] in the router.
const RESERVED_SLUGS = new Set(['embed', 'embed.js', 'new', 'api']);

export async function saveForm(input: unknown): Promise<Result> {
	const parsed = FormInput.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid form.' };
	const v = parsed.data;
	if (RESERVED_SLUGS.has(v.slug)) return { ok: false, error: 'That slug is reserved.' };
	let fields;
	try {
		fields = parseFields(v.fields);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Invalid fields.' };
	}
	const errors = validateFields(fields);
	if (errors.length) return { ok: false, error: errors[0] };

	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const supabase = await createClient();
	const row = {
		slug: v.slug,
		title: v.title,
		description_md: v.description_md,
		status: v.status,
		allow_multiple: v.allow_multiple,
		anonymous_ok: v.anonymous_ok,
		fields,
		is_public: v.is_public,
		confidential: v.confidential,
		request_type: v.request_type || null,
		notify_emails: v.notify_emails,
		success_message: v.success_message || null,
		redirect_url: v.redirect_url || null,
		submit_label: v.submit_label || null,
		brand_label: v.brand_label || null,
		success_cta_label: v.success_cta_label || null,
		success_cta_url: v.success_cta_url || null,
		submission_tags: v.submission_tags,
	};
	const { data, error } = v.id
		? await supabase.from('forms').update(row).eq('id', v.id).select('id').single()
		: await supabase.from('forms').insert({ ...row, created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: explainAndLog(error, 'forms.actions').includes('duplicate') ? 'That slug is taken.' : error.message };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `forms/${data.id}`, action: v.id ? 'form.update' : 'form.create', diff: { slug: v.slug, status: v.status, fields: fields.length } });
	revalidatePath(TOOL);
	revalidatePath(`${TOOL}/${v.slug}`);
	return { ok: true, id: data.id as string };
}

export async function submitForm(slug: string, values: unknown): Promise<Result> {
	if (!/^[a-z0-9-]{2,64}$/.test(slug)) return { ok: false, error: 'Unknown form.' };
	if (!values || typeof values !== 'object') return { ok: false, error: 'Nothing to submit.' };
	const supabase = await createClient();
	const { data: form } = await supabase.from('forms').select('id, status, fields, anonymous_ok').eq('slug', slug).maybeSingle();
	if (!form) return { ok: false, error: 'Unknown form.' };
	if (form.status !== 'open') return { ok: false, error: `This form is ${form.status}.` };
	let fields;
	try {
		fields = parseFields(form.fields);
	} catch {
		return { ok: false, error: 'This form is misconfigured; tell whoever built it.' };
	}
	const { data, errors } = finalizeSubmission(fields, values as FormValues);
	if (errors.length) return { ok: false, error: errors.join(' ') };
	const { data: auth } = await supabase.auth.getUser();
	const { error } = await supabase.from('form_submissions').insert({ form_id: form.id, submitted_by: auth?.user?.id ?? null, data });
	if (error) return { ok: false, error: explainAndLog(error, 'forms.actions') };
	if (auth?.user) await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `forms/${form.id}`, action: 'form.submit' });
	revalidatePath(`${TOOL}/${slug}`);
	return { ok: true };
}

export async function setFormStatus(formData: FormData): Promise<void> {
	const id = formData.get('id');
	const status = formData.get('status');
	if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) redirect(`${TOOL}?error=${encodeURIComponent('Invalid form.')}`);
	if (!['draft', 'open', 'closed'].includes(String(status))) redirect(`${TOOL}?error=${encodeURIComponent('Invalid status.')}`);
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const { error } = await supabase.from('forms').update({ status }).eq('id', id);
	if (error) redirect(`${TOOL}?error=${encodeURIComponent(error.message)}`);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `forms/${id}`, action: `form.status.${status}` });
	revalidatePath(TOOL);
	redirect(TOOL);
}

// ---- Inbox (0158) ---------------------------------------------------------
// RLS (form_submissions_update via can_view_form_submissions) is the real
// guard: a confidential form's rows are invisible to non-execs, so the
// update matches zero rows and we report it.

const SubmissionPatch = z.object({
	id: z.string().uuid(),
	slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
	status: z.enum(SUBMISSION_STATUSES).optional(),
	notes: z.string().trim().max(4000).nullable().optional(),
});

export async function updateSubmission(input: unknown): Promise<Result> {
	const parsed = SubmissionPatch.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
	const v = parsed.data;
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'You are signed out — sign in again and retry.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = {};
	if (v.status) {
		patch.status = v.status;
		patch.reviewed_by = profile.id;
		patch.reviewed_at = new Date().toISOString();
	}
	if (v.notes !== undefined) patch.notes = v.notes || null;
	if (!Object.keys(patch).length) return { ok: true };
	const { data, error } = await supabase.from('form_submissions').update(patch).eq('id', v.id).select('id');
	if (error) return { ok: false, error: explainAndLog(error, 'forms.actions') };
	if (!data?.length) return { ok: false, error: 'You cannot change this submission (confidential forms are execs only).' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `form_submissions/${v.id}`, action: v.status ? `form.submission.${v.status}` : 'form.submission.notes' });
	revalidatePath(`${TOOL}/${v.slug}/submissions`);
	revalidatePath(`${TOOL}/${v.slug}/submissions/${v.id}`);
	return { ok: true };
}
