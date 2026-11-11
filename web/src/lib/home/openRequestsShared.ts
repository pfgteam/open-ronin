// Work › Overview › "My open requests" (menu restructure sheet): everything
// the viewer asked for that is still open, across the two request engines —
// staff_requests (0043: time off, Innovation Desk, SOP, position requests…)
// and content_requests (0110). Pure: the server reader (openRequests.ts)
// passes raw rows in, the Overview renders what comes out.

import { KIND_LABELS, STATUS_LABELS, TWO_STEP_KINDS, type RequestKind } from '@/lib/requests/kinds';

// 'in_review' and 'completed' arrived with 0079 (staff_requests_status_check).
// For two-step kinds (software_change, innovation) approval is not the end:
// the request stays open until it is completed, so 'approved' counts as open
// only for those kinds. openRequests.ts mirrors this in its PostgREST filter.
export function isOpenStaffRequest(kind: string, status: string): boolean {
	if (status === 'pending' || status === 'in_review') return true;
	return status === 'approved' && TWO_STEP_KINDS.has(kind);
}
export const OPEN_CONTENT_STATUSES = ['requested', 'accepted', 'in_studio'] as const;

const CONTENT_STATUS_LABELS: Record<string, string> = {
	requested: 'Requested',
	accepted: 'Accepted',
	in_studio: 'In studio',
};

export interface StaffRequestRow {
	id: string;
	kind: string;
	title: string;
	status: string;
	created_at: string;
}

export interface ContentRequestRow {
	id: string;
	title: string;
	status: string;
	created_at: string;
}

export interface OpenRequest {
	id: string;
	/** Short type label (Time Off, Content, Position Request…). */
	type: string;
	title: string;
	status: string;
	created_at: string;
	/** Where the viewer follows it. */
	href: string;
}

/** Where a staff request of this kind is tracked. `me` = the viewer's profile id. */
export function staffRequestHref(kind: string, me: string): string {
	if (kind === 'time_off') return `/team/${me}?tab=timeoff`;
	if (kind === 'position_request' || kind === 'headcount_request') return '/hiring/requests';
	return '/the-work/innovation-desk';
}

export function buildOpenRequests(staff: StaffRequestRow[], content: ContentRequestRow[], me: string, limit = 8): OpenRequest[] {
	const out: OpenRequest[] = [];
	for (const r of staff) {
		if (!isOpenStaffRequest(r.kind, r.status)) continue;
		out.push({
			id: `staff:${r.id}`,
			type: KIND_LABELS[r.kind as RequestKind] ?? r.kind,
			title: r.title,
			status: STATUS_LABELS[r.status] ?? r.status,
			created_at: r.created_at,
			href: staffRequestHref(r.kind, me),
		});
	}
	for (const r of content) {
		if (!(OPEN_CONTENT_STATUSES as readonly string[]).includes(r.status)) continue;
		out.push({
			id: `content:${r.id}`,
			type: 'Content',
			title: r.title,
			status: CONTENT_STATUS_LABELS[r.status] ?? r.status,
			created_at: r.created_at,
			href: '/the-work/content-requests',
		});
	}
	out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
	return out.slice(0, limit);
}
