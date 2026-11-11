// Content request queue vocabulary (0110, BOT_ROSTER_SYNTHESIS Tier A #5).
// No server imports: the /the-work form and the studio queue rows are client
// components. The server reader (lib/content-requests/server.ts) re-exports.

export const CONTENT_REQUESTS_PATH = '/the-work/content-requests';
export const CONTENT_QUEUE_PATH = '/social/studio/requests';

export const ASSET_TYPES = ['post', 'video', 'clip', 'thumbnail', 'podcast_episode', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
	post: 'Post',
	video: 'Video',
	clip: 'Clip',
	thumbnail: 'Thumbnail',
	podcast_episode: 'Podcast episode',
	other: 'Other',
};

/** Where the studio starts on a request of this type. */
export const ASSET_TYPE_STUDIO_TOOL: Record<AssetType, string> = {
	post: '/social/studio/headlines',
	video: '/social/studio/video',
	clip: '/social/studio/clips',
	thumbnail: '/social/studio/thumbnails',
	podcast_episode: '/social/studio/scripts',
	other: '/social/studio',
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REQUEST_STATUSES = ['requested', 'accepted', 'in_studio', 'delivered', 'declined'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
	requested: 'Requested',
	accepted: 'Accepted',
	in_studio: 'In studio',
	delivered: 'Delivered',
	declined: 'Declined',
};

export const OPEN_STATUSES: readonly RequestStatus[] = ['requested', 'accepted', 'in_studio'];

export function isOpen(status: string): boolean {
	return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** One content_requests row as the pages render it. */
export interface ContentRequestRow {
	id: string;
	requester_id: string;
	requester_name: string | null;
	client_id: string | null;
	client_name: string | null;
	asset_type: AssetType;
	title: string;
	brief: string | null;
	due_on: string | null;
	priority: Priority;
	status: RequestStatus;
	decision_note: string | null;
	assignee_id: string | null;
	assignee_name: string | null;
	studio_job_id: string | null;
	studio_job_status: string | null;
	identity_slug: string | null;
	sla_accept_by: string;
	accepted_at: string | null;
	delivered_at: string | null;
	created_at: string;
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------- SLA clock
// Decision 14 style: measured, rendered, not enforced. Two clocks per row:
// accept-by (24h after filing, only while requested) and due date (while open).

export type SlaState = 'ok' | 'soon' | 'late' | 'none';

export interface SlaClock {
	state: SlaState;
	/** Short human label: "accept in 3h", "accept 2h late", "due in 4d", "3d overdue", "" */
	label: string;
	/** Which clock the label is about. */
	clock: 'accept' | 'due' | 'none';
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function humanHours(ms: number): string {
	const h = Math.round(Math.abs(ms) / HOUR);
	if (h < 1) return `${Math.max(1, Math.round(Math.abs(ms) / 60_000))}m`;
	if (h < 48) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}

/**
 * The clock the queue should show for a row. Requested rows show the
 * accept-by clock (a request waiting for a person is the founding complaint);
 * accepted / in_studio rows show the due date; closed rows show nothing.
 */
export function slaClock(row: Pick<ContentRequestRow, 'status' | 'sla_accept_by' | 'due_on'>, now: Date = new Date()): SlaClock {
	if (row.status === 'requested') {
		const left = new Date(row.sla_accept_by).getTime() - now.getTime();
		if (left < 0) return { state: 'late', clock: 'accept', label: `accept ${humanHours(left)} late` };
		if (left < 4 * HOUR) return { state: 'soon', clock: 'accept', label: `accept in ${humanHours(left)}` };
		return { state: 'ok', clock: 'accept', label: `accept in ${humanHours(left)}` };
	}
	if (row.status === 'accepted' || row.status === 'in_studio') {
		if (!row.due_on) return { state: 'none', clock: 'none', label: '' };
		// due_on is a date; treat end of that business day (Central) as the deadline.
		const due = new Date(`${row.due_on}T23:59:59-05:00`).getTime();
		const left = due - now.getTime();
		if (left < 0) return { state: 'late', clock: 'due', label: `${humanHours(left)} overdue` };
		if (left < DAY) return { state: 'soon', clock: 'due', label: 'due today' };
		return { state: 'ok', clock: 'due', label: `due in ${humanHours(left)}` };
	}
	return { state: 'none', clock: 'none', label: '' };
}

/** Queue order: open first, due date ascending (undated last), then priority, then oldest. */
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function sortQueue<T extends Pick<ContentRequestRow, 'status' | 'due_on' | 'priority' | 'created_at'>>(rows: T[]): T[] {
	return rows.slice().sort((a, b) => {
		const ao = isOpen(a.status) ? 0 : 1;
		const bo = isOpen(b.status) ? 0 : 1;
		if (ao !== bo) return ao - bo;
		if (a.due_on !== b.due_on) {
			if (!a.due_on) return 1;
			if (!b.due_on) return -1;
			return a.due_on.localeCompare(b.due_on);
		}
		const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
		if (pr !== 0) return pr;
		return a.created_at.localeCompare(b.created_at);
	});
}
