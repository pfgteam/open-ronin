'use server';

// Server actions for the content request queue (0110). Thin on purpose: the
// transition matrix, who may move a request, the SLA stamp and the bell
// notifications live in the database. These validate shape, pass through the
// session client (RLS + triggers rule), and surface the DB's verdict as
// { ok, error } for a client component to show in a Callout.
//
// Accept is the one action with app logic: it creates the Content Studio job
// (a text draft from the brief through the provider registry) and links it,
// so "accepted" and "in studio" happen in one click when a text provider is
// configured. Deliver / decline cancel a still-running linked job so the
// request and the job close together.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { enqueueContentJob } from '@/lib/providers/enqueue';
import { runJobNow } from '@/lib/providers/advance';
import { ASSET_TYPES, ASSET_TYPE_LABELS, PRIORITIES, type ActionResult } from '@/lib/content-requests/shared';

const REQUESTS = '/the-work/content-requests';
const QUEUE = '/social/studio/requests';
const STUDIO = '/social/studio';

const uuid = z.string().uuid();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireUser(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { ok: false, error: 'You are signed out. Sign in again and retry.' };
	return { ok: true, userId: user.id };
}

function refresh() {
	for (const p of [REQUESTS, QUEUE, STUDIO, `${STUDIO}/jobs`, '/admin/work-engine']) revalidatePath(p);
}

/** The database raises with a stable prefix; strip it for the person. */
function dbMessage(message: string): string {
	if (/row-level security/.test(message)) return 'You cannot change this request.';
	return message.replace(/^CONTENT_REQUEST: /, '');
}

// ---------------------------------------------------------------- filing

const FileInput = z.object({
	asset_type: z.enum(ASSET_TYPES),
	title: z.string().trim().min(3).max(200),
	brief: z.string().trim().max(5000).optional(),
	client_id: z.union([uuid, z.literal('')]).optional(),
	due_on: z.union([z.string().regex(DATE_RE), z.literal('')]).optional(),
	priority: z.enum(PRIORITIES).default('normal'),
});

export async function fileContentRequest(formData: FormData): Promise<ActionResult<{ id: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = FileInput.safeParse({
		asset_type: formData.get('asset_type'),
		title: formData.get('title'),
		brief: formData.get('brief') || undefined,
		client_id: formData.get('client_id') || '',
		due_on: formData.get('due_on') || '',
		priority: formData.get('priority') || 'normal',
	});
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the request.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('content_requests')
		.insert({
			requester_id: me.userId,
			asset_type: d.asset_type,
			title: d.title,
			brief: d.brief ?? null,
			client_id: d.client_id || null,
			due_on: d.due_on || null,
			priority: d.priority,
		})
		.select('id')
		.single<{ id: string }>();
	if (error) {
		if (/content_requests|schema cache/.test(error.message) && /does not exist|not find/.test(error.message)) {
			return { ok: false, error: 'The content request queue (migration 0110) is not applied yet.' };
		}
		return { ok: false, error: dbMessage(error.message) };
	}
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_requests/${data.id}`, action: 'content_request.file', diff: { asset_type: d.asset_type, due_on: d.due_on || null, priority: d.priority } });
	refresh();
	return { ok: true, id: data.id };
}

/** Requester withdraws (declines their own requested row) or the queue declines. */
export async function declineContentRequest(formData: FormData): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = z.object({ id: uuid, note: z.string().trim().max(2000).optional() }).safeParse({ id: formData.get('id'), note: formData.get('note') || undefined });
	if (!parsed.success) return { ok: false, error: 'Invalid request.' };
	const supabase = await createClient();
	const { data: before } = await supabase.from('content_requests').select('studio_job_id').eq('id', parsed.data.id).maybeSingle<{ studio_job_id: string | null }>();
	const { error } = await supabase
		.from('content_requests')
		.update({ status: 'declined', decision_note: parsed.data.note ?? null })
		.eq('id', parsed.data.id);
	if (error) return { ok: false, error: dbMessage(error.message) };
	await cancelLinkedJob(before?.studio_job_id ?? null);
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_requests/${parsed.data.id}`, action: 'content_request.declined' });
	refresh();
	return { ok: true };
}

// ---------------------------------------------------------------- the queue

const AcceptInput = z.object({
	id: uuid,
	/** Text provider for the draft job; '' or 'none' = accept without a job. */
	provider: z.string().trim().max(40).optional(),
	assignee_id: z.union([uuid, z.literal('')]).optional(),
});

interface RequestRow {
	id: string;
	title: string;
	brief: string | null;
	asset_type: string;
	client_id: string | null;
	requester_id: string;
	due_on: string | null;
}

async function draftPrompt(r: RequestRow): Promise<{ prompt: string; system: string }> {
	const supabase = await createClient();
	let clientLine = 'No client context was supplied; do not invent client facts, names or numbers.';
	if (r.client_id) {
		const [{ data: client }, { data: meta }] = await Promise.all([
			supabase.from('clients_v2').select('display_name').eq('id', r.client_id).maybeSingle<{ display_name: string }>(),
			supabase.from('client_meta').select('context_md, story_md, pr_goals_md').eq('id', r.client_id).maybeSingle<{ context_md: string | null; story_md: string | null; pr_goals_md: string | null }>(),
		]);
		if (client) {
			const house = [meta?.context_md, meta?.story_md, meta?.pr_goals_md]
				.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
				.join('\n\n')
				.slice(0, 2400);
			clientLine = `Client: ${client.display_name}.` + (house ? `\nMessage house and approved claims (use only claims found here; never invent facts or numbers):\n${house}` : '');
		}
	}
	const label = (ASSET_TYPE_LABELS as Record<string, string>)[r.asset_type] ?? r.asset_type;
	const system = ['You are a senior PR content writer at Open Ronin. You turn a content request into a first draft the team refines.', clientLine].join('\n\n').slice(0, 4000);
	const prompt = [
		`Content request: ${r.title}`,
		`Asset type: ${label}.${r.due_on ? ` Due ${r.due_on}.` : ''}`,
		r.brief ? `Brief:\n${r.brief}` : 'No brief was given; draft from the title and say what you assumed.',
		'Produce the first draft for this asset (copy, script, or concept as the type demands). Short lines. Mark on-screen text in [brackets]. No preamble.',
	].join('\n\n');
	return { prompt, system };
}

/**
 * Accept: requested -> accepted, and when a text provider is configured,
 * enqueue the studio draft job and move on to in_studio with the link. The
 * first update is the session's (trigger stamps accepted_by/assignee); the
 * job is enqueued as the service role like every studio action.
 */
export async function acceptContentRequest(formData: FormData): Promise<ActionResult<{ jobId: string | null }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = AcceptInput.safeParse({ id: formData.get('id'), provider: formData.get('provider') || '', assignee_id: formData.get('assignee_id') || '' });
	if (!parsed.success) return { ok: false, error: 'Invalid request.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: r, error: rErr } = await supabase
		.from('content_requests')
		.select('id, title, brief, asset_type, client_id, requester_id, due_on')
		.eq('id', d.id)
		.maybeSingle<RequestRow>();
	if (rErr || !r) return { ok: false, error: 'Request not found.' };

	const { error } = await supabase
		.from('content_requests')
		.update({ status: 'accepted', assignee_id: d.assignee_id || undefined })
		.eq('id', d.id);
	if (error) return { ok: false, error: dbMessage(error.message) };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_requests/${d.id}`, action: 'content_request.accepted' });

	const provider = d.provider && d.provider !== 'none' ? d.provider : null;
	if (!provider) {
		refresh();
		return { ok: true, jobId: null };
	}
	const { prompt, system } = await draftPrompt(r);
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, {
		provider,
		input: { capability: 'generate_text', prompt, system, maxTokens: 1500 },
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: r.client_id,
	});
	if (!res.ok) {
		// accepted stands; the job did not. Say why and let the queue retry
		// with "Start in studio".
		refresh();
		return { ok: false, error: `Accepted, but the studio job was refused: ${res.message}` };
	}
	const { error: linkErr } = await supabase.from('content_requests').update({ status: 'in_studio', studio_job_id: res.jobId }).eq('id', d.id);
	if (linkErr) {
		refresh();
		return { ok: false, error: `Accepted and job ${res.jobId} queued, but the link failed: ${dbMessage(linkErr.message)}` };
	}
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'studio.request_draft', diff: { request_id: d.id, provider } });
	void runJobNow(db, res.jobId, 40_000).catch((e) => console.error('[content-requests] draft run failed:', e));
	refresh();
	return { ok: true, jobId: res.jobId };
}

/** accepted -> in_studio with a job that already exists (made in a studio tool). */
export async function linkStudioJob(formData: FormData): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = z.object({ id: uuid, job_id: uuid }).safeParse({ id: formData.get('id'), job_id: formData.get('job_id') });
	if (!parsed.success) return { ok: false, error: 'Pick a studio job.' };
	const supabase = await createClient();
	const { error } = await supabase.from('content_requests').update({ status: 'in_studio', studio_job_id: parsed.data.job_id }).eq('id', parsed.data.id);
	if (error) return { ok: false, error: dbMessage(error.message) };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_requests/${parsed.data.id}`, action: 'content_request.in_studio', diff: { job_id: parsed.data.job_id } });
	refresh();
	return { ok: true };
}

/** accepted | in_studio -> delivered. Closes a still-running linked job too. */
export async function deliverContentRequest(formData: FormData): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = z.object({ id: uuid, note: z.string().trim().max(2000).optional() }).safeParse({ id: formData.get('id'), note: formData.get('note') || undefined });
	if (!parsed.success) return { ok: false, error: 'Invalid request.' };
	const supabase = await createClient();
	const { data: before } = await supabase.from('content_requests').select('studio_job_id').eq('id', parsed.data.id).maybeSingle<{ studio_job_id: string | null }>();
	const { error } = await supabase
		.from('content_requests')
		.update({ status: 'delivered', decision_note: parsed.data.note ?? null })
		.eq('id', parsed.data.id);
	if (error) return { ok: false, error: dbMessage(error.message) };
	await cancelLinkedJob(before?.studio_job_id ?? null);
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_requests/${parsed.data.id}`, action: 'content_request.delivered' });
	refresh();
	return { ok: true };
}

async function cancelLinkedJob(jobId: string | null): Promise<void> {
	if (!jobId) return;
	const db = createServiceRoleClient();
	await db.from('content_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', jobId).in('status', ['queued', 'submitted', 'running']);
}

// ---------------------------------------------------------------- proposals

export async function decideRequestProposal(formData: FormData): Promise<ActionResult<{ requestId: string | null }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = z
		.object({ action_id: uuid, decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(2000).optional() })
		.safeParse({ action_id: formData.get('action_id'), decision: formData.get('decision'), note: formData.get('note') || undefined });
	if (!parsed.success) return { ok: false, error: 'Invalid decision.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('content_request_action_decide', {
		p_action_id: parsed.data.action_id,
		p_decision: parsed.data.decision,
		p_note: parsed.data.note ?? null,
	});
	if (error) return { ok: false, error: dbMessage(error.message) };
	const res = (data ?? {}) as { status?: string; request_id?: string };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `spine.proposed_actions/${parsed.data.action_id}`, action: 'update', diff: { decision: parsed.data.decision, status: res.status } });
	refresh();
	return { ok: true, requestId: res.request_id ?? null };
}
