// Work Engine vocabulary — WORK_ENGINE_PLAN.md. No server imports here so a
// 'use client' component can read the constants without pulling next/headers
// (the *Shared.ts split every other lib/* module uses).

export const WORK_DOMAINS = ['scrape', 'content', 'import', 'staff_request', 'automation', 'cron', 'ticket'] as const;
export type WorkDomain = (typeof WORK_DOMAINS)[number];

export const WORK_STATUSES = [
	'queued',
	'running',
	'waiting_approval',
	'approved',
	'rejected',
	'done',
	'failed',
	'cancelled',
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** A run that still needs something: a machine (queued/running/approved) or a person (waiting_approval). */
export const OPEN_STATUSES: readonly WorkStatus[] = ['queued', 'running', 'waiting_approval', 'approved'];
export const TERMINAL_STATUSES: readonly WorkStatus[] = ['done', 'failed', 'cancelled', 'rejected'];

export const DOMAIN_LABELS: Record<WorkDomain, string> = {
	scrape: 'Scraper',
	content: 'Content',
	import: 'Import',
	staff_request: 'Request',
	automation: 'Automation',
	cron: 'Cron',
	ticket: 'Ticket',
};

export const STATUS_LABELS: Record<WorkStatus, string> = {
	queued: 'Queued',
	running: 'Running',
	waiting_approval: 'Waiting on someone',
	approved: 'Approved',
	rejected: 'Rejected',
	done: 'Done',
	failed: 'Failed',
	cancelled: 'Cancelled',
};

/** Dot colour per status; slate for idle/terminal, amber for the human step. */
export const STATUS_DOT: Record<WorkStatus, string> = {
	queued: 'bg-slate-400',
	running: 'bg-primary-500',
	waiting_approval: 'bg-amber-500',
	approved: 'bg-green-400',
	rejected: 'bg-red-400',
	done: 'bg-green-500',
	failed: 'bg-red-500',
	cancelled: 'bg-slate-300',
};

/**
 * Where a mirrored row's OWN actions live. The work-engine page never
 * duplicates a domain's approval logic; it links through and, where the
 * domain exposes a server action, calls that (see actions.ts).
 */
export const SOURCE_HREFS: Record<string, (id: string) => string> = {
	scrape_jobs: (id) => `/media/lead-scraper?job=${id}`,
	staff_requests: (id) => `/the-work/innovation-desk?request=${id}`,
	content_requests: () => '/social/studio/requests',
	content_jobs: () => '/admin/providers',
	import_batches: (id) => `/data/imports/${id}`,
	automation_runs: (id) => `/data/pipeline?run=${id}`,
};

export interface WorkRunRow {
	id: string;
	domain: WorkDomain;
	kind: string;
	title: string | null;
	status: WorkStatus;
	payload: Record<string, unknown>;
	result: Record<string, unknown> | null;
	error: string | null;
	requested_by: string | null;
	requested_via: string;
	approver_group: string | null;
	approved_by: string | null;
	approved_at: string | null;
	client_id: string | null;
	work_item_id: string | null;
	parent_run_id: string | null;
	cost_usd: number | null;
	source_table: string | null;
	source_id: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	updated_at: string;
}

export interface WorkEngineSummaryRow {
	domain: WorkDomain;
	status: WorkStatus;
	runs: number;
	oldest_at: string | null;
	cost_usd: number;
}

export function isWorkDomain(value: unknown): value is WorkDomain {
	return typeof value === 'string' && (WORK_DOMAINS as readonly string[]).includes(value);
}

export function isWorkStatus(value: unknown): value is WorkStatus {
	return typeof value === 'string' && (WORK_STATUSES as readonly string[]).includes(value);
}

/** Age in whole minutes, for the "oldest first" queue. */
export function ageMinutes(iso: string, now: Date = new Date()): number {
	return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}

export function formatAge(iso: string, now: Date = new Date()): string {
	const m = ageMinutes(iso, now);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h}h`;
	return `${Math.floor(h / 24)}d`;
}

/**
 * What the unified page may do to a row. Native rows (source_table null) go
 * through the work_runs RPCs; mirrored rows go through their own domain, and
 * only where that domain already has a safe generic action.
 */
export type WorkAction = 'approve' | 'reject' | 'cancel' | 'retry' | 'open';

export function availableActions(run: Pick<WorkRunRow, 'status' | 'source_table'>): WorkAction[] {
	const out: WorkAction[] = [];
	const src = run.source_table;
	if (src === null) {
		if (run.status === 'waiting_approval') out.push('approve', 'reject');
		if ((OPEN_STATUSES as readonly string[]).includes(run.status)) out.push('cancel');
		if (run.status === 'failed') out.push('retry');
		return out;
	}
	if (src === 'staff_requests' && run.status === 'waiting_approval') out.push('approve', 'reject');
	if (src === 'scrape_jobs' && (run.status === 'queued' || run.status === 'running')) out.push('cancel');
	if (src === 'content_jobs' && (run.status === 'queued' || run.status === 'running')) out.push('cancel');
	if (src === 'automation_runs') {
		if (run.status === 'waiting_approval') out.push('approve', 'reject');
		if ((OPEN_STATUSES as readonly string[]).includes(run.status)) out.push('cancel');
		if (run.status === 'failed') out.push('retry');
	}
	out.push('open');
	return out;
}
