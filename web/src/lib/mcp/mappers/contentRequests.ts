// Allowlist mapper for content_requests over MCP (0110). The raw row carries
// requester/assignee/closed_by profile ids and the proposed_action_id; the
// agent gets names, the client, the brief and the clocks, never ids of
// people or spine internals.

import { slaClock } from '@/lib/content-requests/shared';
import type { AssetType, Priority, RequestStatus } from '@/lib/content-requests/shared';

export const REQUEST_COLUMNS =
	'id, client_id, asset_type, title, brief, due_on, priority, status, decision_note, studio_job_id, identity_slug, sla_accept_by, accepted_at, delivered_at, created_at, ' +
	'requester:profiles!content_requests_requester_id_fkey(first_name, last_name, email), ' +
	'assignee:profiles!content_requests_assignee_id_fkey(first_name, last_name, email), ' +
	'client:clients_v2!content_requests_client_id_fkey(display_name), ' +
	'job:content_jobs!content_requests_studio_job_id_fkey(status)';

interface Person {
	first_name: string | null;
	last_name: string | null;
	email: string;
}

export type ContentRequestRow = {
	id: string;
	client_id: string | null;
	asset_type: AssetType;
	title: string;
	brief: string | null;
	due_on: string | null;
	priority: Priority;
	status: RequestStatus;
	decision_note: string | null;
	studio_job_id: string | null;
	identity_slug: string | null;
	sla_accept_by: string;
	accepted_at: string | null;
	delivered_at: string | null;
	created_at: string;
	requester: Person | null;
	assignee: Person | null;
	client: { display_name: string } | null;
	job: { status: string } | null;
};

export type ContentRequestOut = {
	id: string;
	client_id: string | null;
	client_name: string | null;
	asset_type: string;
	title: string;
	brief: string | null;
	due_on: string | null;
	priority: string;
	status: string;
	decision_note: string | null;
	requester_name: string | null;
	assignee_name: string | null;
	proposed_by_identity: string | null;
	studio_job_status: string | null;
	accept_by: string;
	accepted_at: string | null;
	delivered_at: string | null;
	created_at: string;
	sla: { state: string; label: string; clock: string };
	url: string;
};

function personName(p: Person | null): string | null {
	if (!p) return null;
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

export function mapContentRequest(r: ContentRequestRow, now: Date = new Date()): ContentRequestOut {
	return {
		id: r.id,
		client_id: r.client_id,
		client_name: r.client?.display_name ?? null,
		asset_type: r.asset_type,
		title: r.title,
		brief: r.brief,
		due_on: r.due_on,
		priority: r.priority,
		status: r.status,
		decision_note: r.decision_note,
		requester_name: personName(r.requester),
		assignee_name: personName(r.assignee),
		proposed_by_identity: r.identity_slug,
		studio_job_status: r.job?.status ?? null,
		accept_by: r.sla_accept_by,
		accepted_at: r.accepted_at,
		delivered_at: r.delivered_at,
		created_at: r.created_at,
		sla: slaClock(r, now),
		url: '/social/studio/requests',
	};
}
