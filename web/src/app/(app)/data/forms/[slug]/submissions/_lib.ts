// Inbox helpers (0158): the form + its submissions read with the USER's
// session so RLS (can_view_form_submissions) decides what a builder sees;
// a confidential form's rows are simply absent for non-execs.

import { notFound, redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { parseFields, type FormField, type FormValues } from '@/lib/forms/logic';
import type { SubmissionStatus, UploadedFile } from '@/lib/forms/shared';

export const SLUG_RE = /^[a-z0-9-]{2,64}$/;

export interface InboxForm {
	id: string;
	slug: string;
	title: string;
	status: string;
	fields: FormField[];
	confidential: boolean;
	is_public: boolean;
	request_type: string | null;
}

export interface SubmissionRow {
	id: string;
	form_id: string;
	submitted_by: string | null;
	data: FormValues;
	files: UploadedFile[];
	tags: Record<string, string>;
	status: SubmissionStatus;
	source_url: string | null;
	referrer: string | null;
	utm: Record<string, string>;
	ip: string | null;
	user_agent: string | null;
	notified_at: string | null;
	notify_error: string | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	notes: string | null;
	created_at: string;
}

export const SUBMISSION_COLS = 'id, form_id, submitted_by, data, files, tags, status, source_url, referrer, utm, ip, user_agent, notified_at, notify_error, reviewed_by, reviewed_at, notes, created_at';

/** Builder gate + the form; redirects / 404s the way the pages expect. */
export async function requireInboxForm(slug: string): Promise<{ form: InboxForm; isExec: boolean; userId: string }> {
	if (!SLUG_RE.test(slug)) notFound();
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const ctx = await loadSensitiveAccessContext();
	const canBuild = canManagePeople(ctx) || profile.role === 'exec';
	if (!canBuild) redirect(`/data/forms/${slug}`);
	const supabase = await createClient();
	const { data } = await supabase.from('forms').select('id, slug, title, status, fields, confidential, is_public, request_type').eq('slug', slug).maybeSingle();
	if (!data) notFound();
	let fields: FormField[] = [];
	try {
		fields = parseFields(data.fields);
	} catch {
		fields = [];
	}
	const isExec = profile.role === 'exec' || profile.role === 'admin';
	return { form: { id: data.id, slug: data.slug, title: data.title, status: data.status, fields, confidential: !!data.confidential, is_public: !!data.is_public, request_type: data.request_type ?? null }, isExec, userId: profile.id };
}

export function normalizeSubmission(r: Record<string, unknown>): SubmissionRow {
	return {
		id: String(r.id),
		form_id: String(r.form_id),
		submitted_by: (r.submitted_by as string | null) ?? null,
		data: ((r.data ?? {}) as FormValues),
		files: Array.isArray(r.files) ? (r.files as UploadedFile[]) : [],
		tags: ((r.tags ?? {}) as Record<string, string>),
		status: ((r.status as SubmissionStatus) ?? 'new'),
		source_url: (r.source_url as string | null) ?? null,
		referrer: (r.referrer as string | null) ?? null,
		utm: ((r.utm ?? {}) as Record<string, string>),
		ip: (r.ip as string | null) ?? null,
		user_agent: (r.user_agent as string | null) ?? null,
		notified_at: (r.notified_at as string | null) ?? null,
		notify_error: (r.notify_error as string | null) ?? null,
		reviewed_by: (r.reviewed_by as string | null) ?? null,
		reviewed_at: (r.reviewed_at as string | null) ?? null,
		notes: (r.notes as string | null) ?? null,
		created_at: String(r.created_at),
	};
}

/** A short "who" for a row: the name field, else the email, else Anonymous. */
export function submitterLabel(s: SubmissionRow): string {
	const d = s.data;
	const name = typeof d.name === 'string' ? d.name : '';
	const email = typeof d.email === 'string' ? d.email : '';
	return name || email || (s.submitted_by ? 'Staff' : 'Anonymous');
}
