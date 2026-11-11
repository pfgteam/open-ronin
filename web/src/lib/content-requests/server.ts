// Server-side reads for the content request queue (0110). Every read goes
// through the session client so RLS decides (requester sees own rows,
// content_reviewers + admins see all). The manager flag comes from the same
// SQL function the policies use, so the page and the database agree.

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { listProviders } from '@/lib/providers/registry';
import type { ContentRequestRow } from './shared';

export * from './shared';

const COLUMNS =
	'id, requester_id, client_id, asset_type, title, brief, due_on, priority, status, decision_note, assignee_id, studio_job_id, identity_slug, sla_accept_by, accepted_at, delivered_at, created_at, ' +
	'requester:profiles!content_requests_requester_id_fkey(first_name, last_name, email), ' +
	'assignee:profiles!content_requests_assignee_id_fkey(first_name, last_name, email), ' +
	'client:clients_v2!content_requests_client_id_fkey(display_name), ' +
	'job:content_jobs!content_requests_studio_job_id_fkey(status)';

interface Person {
	first_name: string | null;
	last_name: string | null;
	email: string;
}

interface RawRow extends Omit<ContentRequestRow, 'requester_name' | 'assignee_name' | 'client_name' | 'studio_job_status'> {
	requester: Person | null;
	assignee: Person | null;
	client: { display_name: string } | null;
	job: { status: string } | null;
}

function personName(p: Person | null): string | null {
	if (!p) return null;
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

function toRow(r: RawRow): ContentRequestRow {
	const { requester, assignee, client, job, ...rest } = r;
	return {
		...rest,
		requester_name: personName(requester),
		assignee_name: personName(assignee),
		client_name: client?.display_name ?? null,
		studio_job_status: job?.status ?? null,
	};
}

export interface RequestsRead {
	rows: ContentRequestRow[];
	/** True when 0110 has not been applied (table missing). */
	notApplied: boolean;
	error: string | null;
}

/** Every request the viewer may see (RLS), newest first. */
export const listContentRequests = cache(async (): Promise<RequestsRead> => {
	const supabase = await createClient();
	const { data, error } = await supabase.from('content_requests').select(COLUMNS).order('created_at', { ascending: false }).limit(500);
	if (error) {
		const notApplied = /content_requests|does not exist|schema cache/.test(error.message);
		if (!notApplied) console.error('[content-requests] list failed:', error.message);
		return { rows: [], notApplied, error: notApplied ? null : error.message };
	}
	return { rows: ((data ?? []) as unknown as RawRow[]).map(toRow), notApplied: false, error: null };
});

/** One request by id (RLS scoped) or null. */
export async function getContentRequest(id: string): Promise<ContentRequestRow | null> {
	const supabase = await createClient();
	const { data } = await supabase.from('content_requests').select(COLUMNS).eq('id', id).maybeSingle();
	return data ? toRow(data as unknown as RawRow) : null;
}

/** Whether the viewer works the queue (admin floor or content_reviewers). */
export const canManageContentRequests = cache(async (): Promise<boolean> => {
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('can_manage_content_requests');
	if (error) return false;
	return data === true;
});

export interface RequestProposal {
	id: string;
	identity_slug: string;
	display_name: string | null;
	reasoning: string | null;
	payload: { asset_type?: string; title?: string; brief?: string; due_on?: string; priority?: string; client_id?: string };
	created_at: string;
	client_name: string | null;
}

/** Pending agent proposals (content_request.create). Empty for non-managers. */
export async function listRequestProposals(): Promise<RequestProposal[]> {
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('content_request_pending_actions');
	if (error) return [];
	return (data ?? []) as RequestProposal[];
}

/** Configured text providers for the accept form (presence only, never a key). */
export function textProviderOptions(): { id: string; label: string }[] {
	return listProviders()
		.filter((p) => p.configured && p.spec.capabilities.includes('generate_text'))
		.map((p) => ({ id: p.spec.id, label: p.spec.label }));
}

/** Team members the queue may assign (active profiles). */
export const listAssigneeOptions = cache(async (): Promise<{ id: string; name: string }[]> => {
	const supabase = await createClient();
	const { data } = await supabase.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name').limit(300);
	return ((data ?? []) as (Person & { id: string })[]).map((p) => ({ id: p.id, name: personName(p) ?? p.id }));
});
