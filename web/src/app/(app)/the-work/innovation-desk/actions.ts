'use server';

// Server actions for the Innovation Desk (/the-work/innovation-desk) — the
// staff-request engine's surface (0043, +software_change 0079, +innovation
// 0081). Thin on purpose: every rule that matters lives in the database. RLS
// scopes who sees what; the transition trigger decides who may move a request
// and stamps decided_by/decided_at; the approval side effect (time_off row)
// and the in-app notifications happen in SQL. These actions validate shape,
// pass through, and surface the DB's verdict.
//
// `returnTo` lets the admin pipeline (/admin/innovation-desk) reuse the same
// decide/review/complete actions and land back on itself.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
	EMPLOYMENT_TYPES,
	INNOVATION_DESK_PATH,
	INNOVATION_PIPELINE_PATH,
	INNOVATION_TYPES,
	KIND_REVIEWER_GROUP,
	DESK_FORM_KINDS,
	type RequestKind,
} from '@/lib/requests/kinds';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// /hiring/requests (0128) decides position requests on the same engine.
const HIRING_REQUESTS_PATH = '/hiring/requests';
const RETURN_PATHS = new Set([INNOVATION_DESK_PATH, INNOVATION_PIPELINE_PATH, HIRING_REQUESTS_PATH]);

function returnPath(formData: FormData): string {
	const v = formData.get('return_to');
	return typeof v === 'string' && RETURN_PATHS.has(v) ? v : INNOVATION_DESK_PATH;
}

function fail(path: string, message: string): never {
	redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function done(path: string): never {
	revalidatePath(INNOVATION_DESK_PATH);
	revalidatePath(INNOVATION_PIPELINE_PATH);
	revalidatePath(HIRING_REQUESTS_PATH);
	redirect(path);
}

const CreateInput = z
	.object({
		kind: z.enum(DESK_FORM_KINDS as [RequestKind, ...RequestKind[]]),
		title: z.string().trim().min(3).max(200),
		body_md: z.string().trim().max(5000).optional(),
		starts_on: z.string().regex(DATE_RE).optional().or(z.literal('')),
		ends_on: z.string().regex(DATE_RE).optional().or(z.literal('')),
		time_off_kind: z.enum(['vacation', 'sick', 'personal', 'holiday']).optional(),
		request_type: z.enum(['new_tool', 'access_change', 'feature_request']).optional(),
		urgency: z.enum(['low', 'normal', 'high', 'blocking']).optional(),
		innovation_type: z.enum(INNOVATION_TYPES).optional(),
		// headcount_request (0111)
		role_title: z.string().trim().min(2).max(120).optional(),
		employment_type: z.enum(EMPLOYMENT_TYPES).optional(),
		headcount: z.coerce.number().int().min(1).max(50).optional(),
		department: z.string().trim().max(80).optional(),
		target_start_on: z.string().regex(DATE_RE).optional().or(z.literal('')),
		budget_annual_usd: z.coerce.number().min(0).max(10_000_000).optional(),
	})
	.refine((v) => v.kind !== 'time_off' || (v.starts_on && v.ends_on), {
		message: 'Time-off requests need a start and end date.',
	})
	.refine((v) => v.kind !== 'software_change' || !!v.request_type, {
		message: 'Software/tool change requests need a request type.',
	})
	.refine((v) => v.kind !== 'innovation' || !!v.innovation_type, {
		message: 'Pick what kind of submission this is.',
	})
	.refine((v) => v.kind !== 'headcount_request' || !!v.role_title, {
		message: 'Headcount requests need a role title.',
	});

export async function createStaffRequest(formData: FormData): Promise<void> {
	const path = returnPath(formData);
	const parsed = CreateInput.safeParse({
		kind: formData.get('kind'),
		title: formData.get('title'),
		body_md: formData.get('body_md') || undefined,
		starts_on: formData.get('starts_on') || '',
		ends_on: formData.get('ends_on') || '',
		time_off_kind: formData.get('time_off_kind') || undefined,
		request_type: formData.get('request_type') || undefined,
		urgency: formData.get('urgency') || undefined,
		innovation_type: formData.get('innovation_type') || undefined,
		role_title: formData.get('role_title') || undefined,
		employment_type: formData.get('employment_type') || undefined,
		headcount: formData.get('headcount') || undefined,
		department: formData.get('department') || undefined,
		target_start_on: formData.get('target_start_on') || '',
		budget_annual_usd: formData.get('budget_annual_usd') || undefined,
	});
	if (!parsed.success) fail(path, String(parsed.error.issues[0]?.message ?? 'Invalid input.'));
	const input = parsed.data;

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail(path, 'Not signed in.');

	const groupKey = KIND_REVIEWER_GROUP[input.kind] ?? 'strategy_reviewers';
	const { data: group } = await supabase.from('reviewer_groups').select('id').eq('key', groupKey).single();
	if (!group) {
		fail(
			path,
			groupKey === 'innovation_reviewers'
				? 'The Innovation Desk reviewer group is not configured yet (migration 0081 has not been applied).'
				: groupKey === 'people_reviewers'
					? 'Headcount requests need migration 0111 applied (people_reviewers group).'
					: 'Reviewer group is not configured.',
		);
	}

	let payload: Record<string, unknown> = {};
	if (input.kind === 'time_off') {
		payload = {
			starts_on: input.starts_on,
			ends_on: input.ends_on,
			time_off_kind: input.time_off_kind ?? 'vacation',
		};
	} else if (input.kind === 'software_change') {
		payload = { request_type: input.request_type, urgency: input.urgency ?? 'normal' };
	} else if (input.kind === 'innovation') {
		payload = { innovation_type: input.innovation_type };
	} else if (input.kind === 'headcount_request') {
		payload = {
			role_title: input.role_title,
			employment_type: input.employment_type ?? 'full_time',
			headcount: input.headcount ?? 1,
			department: input.department || null,
			target_start_on: input.target_start_on || null,
			budget_annual_usd: input.budget_annual_usd ?? null,
		};
	}

	const { data: row, error } = await supabase
		.from('staff_requests')
		.insert({
			kind: input.kind,
			title: input.title,
			body_md: input.body_md ?? null,
			payload,
			requester_id: auth.user.id,
			reviewer_group_id: group.id,
		})
		.select('id')
		.single();
	if (error) fail(path, error.message);

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `staff_requests/${row.id}`,
		action: 'staff_request.create',
		diff: { kind: input.kind, title: input.title, innovation_type: input.innovation_type ?? null },
	});
	done(path);
}

const DecideInput = z.object({
	id: z.string().uuid(),
	decision: z.enum(['approved', 'denied']),
	note: z.string().trim().max(2000).optional(),
});

export async function decideStaffRequest(formData: FormData): Promise<void> {
	const path = returnPath(formData);
	const parsed = DecideInput.safeParse({
		id: formData.get('id'),
		decision: formData.get('decision'),
		note: formData.get('note') || undefined,
	});
	if (!parsed.success) fail(path, 'Invalid decision.');

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail(path, 'Not signed in.');

	// The transition trigger enforces reviewer membership and stamps
	// decided_by/decided_at; a rejection surfaces here as the error message.
	const { error } = await supabase
		.from('staff_requests')
		.update({ status: parsed.data.decision, decision_note_md: parsed.data.note ?? null })
		.eq('id', parsed.data.id);
	if (error) fail(path, error.message);

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `staff_requests/${parsed.data.id}`,
		action: `staff_request.${parsed.data.decision}`,
	});
	done(path);
}

export async function withdrawStaffRequest(formData: FormData): Promise<void> {
	const path = returnPath(formData);
	const id = formData.get('id');
	if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) fail(path, 'Invalid request.');
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail(path, 'Not signed in.');

	const { error } = await supabase.from('staff_requests').update({ status: 'withdrawn' }).eq('id', id);
	if (error) fail(path, error.message);

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `staff_requests/${id}`,
		action: 'staff_request.withdraw',
	});
	done(path);
}

// Two-step kinds only (software_change, innovation): reviewer claims a
// pending request before deciding it. Optional — a reviewer may still go
// straight pending -> approved/denied; this makes "someone's on it" visible.
export async function startReviewStaffRequest(formData: FormData): Promise<void> {
	const path = returnPath(formData);
	const id = formData.get('id');
	if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) fail(path, 'Invalid request.');
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail(path, 'Not signed in.');

	const { error } = await supabase.from('staff_requests').update({ status: 'in_review' }).eq('id', id);
	if (error) fail(path, error.message);

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `staff_requests/${id}`,
		action: 'staff_request.in_review',
	});
	done(path);
}

// Two-step kinds only: reviewer marks an approved request as actually done.
// Distinct from 'approved' so "approved but not yet actioned" stays visible.
export async function completeStaffRequest(formData: FormData): Promise<void> {
	const path = returnPath(formData);
	const parsed = z
		.object({ id: z.string().uuid(), note: z.string().trim().max(2000).optional() })
		.safeParse({ id: formData.get('id'), note: formData.get('note') || undefined });
	if (!parsed.success) fail(path, 'Invalid request.');

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail(path, 'Not signed in.');

	const { error } = await supabase
		.from('staff_requests')
		.update({ status: 'completed', decision_note_md: parsed.data.note ?? null })
		.eq('id', parsed.data.id);
	if (error) fail(path, error.message);

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `staff_requests/${parsed.data.id}`,
		action: 'staff_request.completed',
	});
	done(path);
}
