// Vocabulary for the staff-request engine (0043, 0079, 0081, 0111) as
// surfaced on the Innovation Desk. No server imports: the admin pipeline,
// the desk page and the actions all read from here so labels never drift.

export const REQUEST_KINDS = [
	'innovation',
	'time_off',
	'sop',
	'promotion',
	'design_project',
	'podcast_episode',
	'software_change',
	'headcount_request',
	// position_request (0128): filed from the Hiring module by people
	// managers (the desk form hides it — see DESK_FORM_KINDS), reviewed by
	// Alex on the same engine; approval creates / approves hire_positions.
	'position_request',
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Kinds the Innovation Desk's own "new submission" form offers. */
export const DESK_FORM_KINDS: readonly RequestKind[] = REQUEST_KINDS.filter((k) => k !== 'position_request');

export const KIND_LABELS: Record<RequestKind, string> = {
	innovation: 'Innovation Desk',
	time_off: 'Time Off',
	sop: 'SOP',
	promotion: 'Promotion',
	design_project: 'Design Project',
	podcast_episode: 'Podcast Episode',
	software_change: 'Software/Tool Change',
	headcount_request: 'Headcount Request',
	position_request: 'Position Request',
};

/** Which reviewer group a kind routes to. Innovation Desk: Alex (0081).
 *  Headcount: `people_reviewers` (0111), seeded with Alex, its own group so
 *  hiring authority never rides along with calibration (exec_reconcilers). */
export const KIND_REVIEWER_GROUP: Record<RequestKind, string> = {
	innovation: 'innovation_reviewers',
	time_off: 'strategy_reviewers',
	sop: 'strategy_reviewers',
	promotion: 'strategy_reviewers',
	design_project: 'strategy_reviewers',
	podcast_episode: 'strategy_reviewers',
	software_change: 'devops_reviewers',
	headcount_request: 'people_reviewers',
	position_request: 'people_reviewers',
};

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
	full_time: 'Full-time',
	part_time: 'Part-time',
	contractor: 'Contractor',
	intern: 'Intern',
};

/** Kinds that carry in_review and completed (approval is not "done"). */
export const TWO_STEP_KINDS: ReadonlySet<string> = new Set(['software_change', 'innovation']);

export const INNOVATION_TYPES = [
	'platform_change',
	'process_insight',
	'policy_request',
	'new_project',
	'other',
] as const;
export type InnovationType = (typeof INNOVATION_TYPES)[number];

export const INNOVATION_TYPE_LABELS: Record<InnovationType, string> = {
	platform_change: 'Open Ronin change',
	process_insight: 'Process insight',
	policy_request: 'Policy request',
	new_project: 'New project',
	other: 'Other',
};

export const STATUS_LABELS: Record<string, string> = {
	pending: 'Submitted',
	in_review: 'In Review',
	approved: 'Approved',
	denied: 'Denied',
	completed: 'Completed',
	withdrawn: 'Withdrawn',
};

export const STATUS_COLORS: Record<string, 'default' | 'success' | 'danger' | 'warning' | 'primary'> = {
	pending: 'warning',
	in_review: 'primary',
	approved: 'success',
	denied: 'danger',
	completed: 'default',
	withdrawn: 'default',
};

export const REQUEST_TYPE_LABELS: Record<string, string> = {
	new_tool: 'New Tool',
	access_change: 'Access Change',
	feature_request: 'Feature Request',
};

export const URGENCY_COLORS: Record<string, 'default' | 'warning' | 'danger'> = {
	low: 'default',
	normal: 'default',
	high: 'warning',
	blocking: 'danger',
};

/** Where the desk lives; the old /team/requests URL redirects here. */
export const INNOVATION_DESK_PATH = '/the-work/innovation-desk';
export const INNOVATION_PIPELINE_PATH = '/admin/innovation-desk';

export interface RequestPayload {
	starts_on?: string;
	ends_on?: string;
	time_off_kind?: string;
	request_type?: string;
	urgency?: string;
	innovation_type?: string;
	// headcount_request (0111)
	role_title?: string;
	employment_type?: string;
	headcount?: number;
	department?: string;
	target_start_on?: string;
	budget_annual_usd?: number;
	// position_request (0128)
	brand?: string;
	pay_level?: string | null;
	pay_multiplier?: string | null;
	posting_budget_usd?: string | null;
	position_id?: string | null;
	hiring_manager_id?: string | null;
}

/** One line of context under a request title, per kind. */
export function payloadSummary(kind: string, p: RequestPayload): string | null {
	if (kind === 'innovation' && p.innovation_type) {
		return INNOVATION_TYPE_LABELS[p.innovation_type as InnovationType] ?? p.innovation_type;
	}
	if (kind === 'software_change' && p.request_type) {
		return REQUEST_TYPE_LABELS[p.request_type] ?? p.request_type;
	}
	if (kind === 'time_off' && p.starts_on) {
		return `${p.starts_on} → ${p.ends_on ?? p.starts_on}`;
	}
	if (kind === 'headcount_request' && p.role_title) {
		const parts = [
			`${p.headcount ?? 1}× ${p.role_title}`,
			p.employment_type ? EMPLOYMENT_TYPE_LABELS[p.employment_type as EmploymentType] ?? p.employment_type : null,
			p.department ?? null,
			p.target_start_on ? `from ${p.target_start_on}` : null,
		];
		return parts.filter(Boolean).join(' · ');
	}
	if (kind === 'position_request' && p.role_title) {
		const parts = [
			`${p.headcount ?? 1}× ${p.role_title}`,
			p.brand ? ({ main: 'Main', premium: 'Premium', beacon: 'Beacon' } as Record<string, string>)[p.brand] ?? p.brand : null,
			p.employment_type ? EMPLOYMENT_TYPE_LABELS[p.employment_type as EmploymentType] ?? p.employment_type : null,
			p.department ?? null,
			p.pay_level && p.pay_multiplier ? `${p.pay_level} × ${p.pay_multiplier}` : null,
			p.posting_budget_usd ? `posting $${p.posting_budget_usd}` : null,
			p.target_start_on ? `from ${p.target_start_on}` : null,
		];
		return parts.filter(Boolean).join(' · ');
	}
	return null;
}
