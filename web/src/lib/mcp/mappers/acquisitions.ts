// Pure allowlist mapper + vocabulary for the acquisitions MCP family
// (migration 0107). No server imports: the page and the tools both use it.
//
// acquisition_targets rows carry a firm owner's direct email/phone
// (third-party PII from the scraper). The MCP shape keeps them because the
// five acquisitions identities exist to work these deals, and RLS already
// scopes the table to the acquisitions capability; what never leaves is the
// scraped_record_id (internal join key) and created_by (a profile id).

export const TARGET_STATUSES = [
	'identified', 'screened', 'contacted', 'conversation', 'nda', 'loi',
	'diligence', 'acquired', 'integrating', 'passed', 'dead',
] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

/** Terminal for pipeline purposes: excluded from "open" lists by default. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['acquired', 'passed', 'dead']);

export const NOTE_KINDS = ['research', 'risk', 'decision', 'negotiation', 'touch', 'integration', 'general'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const FINANCIAL_CONFIDENCE = ['confirmed', 'estimate', 'unknown'] as const;
export const GROWTH_TREND = ['growing', 'flat', 'declining'] as const;
export const MANAGEMENT_DEPTH = ['founder_only', 'has_seconds', 'deep_bench'] as const;
export const OWNER_READINESS = ['none', 'life_event', 'exploring', 'in_dialogue'] as const;
export const SOURCING_CHANNEL = ['proprietary', 'broker', 'referral', 'inbound'] as const;
export const RELATIONSHIP_WARMTH = ['cold', 'warm_intro', 'active_dialogue', 'under_nda'] as const;
export const HARD_GATE = ['pass', 'fail'] as const;
export const RECOMMENDATION = ['escalate', 'nurture', 'deprioritize'] as const;
export const RISK_SEVERITY = ['low', 'medium', 'high', 'critical'] as const;
export const RISK_STATUS = ['open', 'mitigating', 'closed'] as const;

/** Mirror of public.acquisition_patchable_columns() (0107). */
export const PATCHABLE_COLUMNS = [
	'company_name', 'website', 'owner_name', 'owner_title', 'email', 'phone', 'linkedin_url',
	'agency_services', 'employee_count', 'founded_year', 'est_revenue', 'city', 'state', 'country', 'owner_signal',
	'status', 'fit_score', 'notes',
	'vertical', 'notable_clients', 'est_ebitda', 'financial_confidence', 'retainer_mix_pct', 'top3_concentration_pct',
	'growth_trend', 'management_depth', 'owner_readiness', 'sourcing_channel', 'relationship_warmth',
	'last_touch_on', 'next_action', 'next_action_on', 'hard_gate', 'scorecard_total', 'score_drivers', 'recommendation',
	'batna', 'deal_structure', 'deal_stage_notes',
] as const;
export type PatchableColumn = (typeof PATCHABLE_COLUMNS)[number];

export type TargetRow = {
	id: string;
	target_ref: string | null;
	company_name: string;
	website: string | null;
	linkedin_url: string | null;
	owner_name: string | null;
	owner_title: string | null;
	email: string | null;
	phone: string | null;
	agency_services: string | null;
	employee_count: string | null;
	founded_year: string | null;
	est_revenue: string | null;
	est_ebitda: string | null;
	financial_confidence: string | null;
	city: string | null;
	state: string | null;
	country: string | null;
	owner_signal: string | null;
	vertical: string | null;
	notable_clients: string | null;
	retainer_mix_pct: number | null;
	top3_concentration_pct: number | null;
	growth_trend: string | null;
	management_depth: string | null;
	owner_readiness: string | null;
	sourcing_channel: string | null;
	relationship_warmth: string | null;
	last_touch_on: string | null;
	next_action: string | null;
	next_action_on: string | null;
	hard_gate: string | null;
	scorecard_total: number | null;
	score_drivers: string | null;
	recommendation: string | null;
	fit_score: number | null;
	status: string;
	notes: string | null;
	batna: string | null;
	deal_structure: string | null;
	deal_stage_notes: string | null;
	owner_profile_id: string | null;
	created_at: string;
	updated_at: string;
};

/** The select list for TargetRow. Never scraped_record_id / created_by. */
export const TARGET_COLUMNS =
	'id, target_ref, company_name, website, linkedin_url, owner_name, owner_title, email, phone, agency_services, employee_count, founded_year, est_revenue, est_ebitda, financial_confidence, city, state, country, owner_signal, vertical, notable_clients, retainer_mix_pct, top3_concentration_pct, growth_trend, management_depth, owner_readiness, sourcing_channel, relationship_warmth, last_touch_on, next_action, next_action_on, hard_gate, scorecard_total, score_drivers, recommendation, fit_score, status, notes, batna, deal_structure, deal_stage_notes, owner_profile_id, created_at, updated_at';

export type TargetOut = Omit<TargetRow, 'owner_profile_id'> & {
	owner_name_internal: string | null;
	owner_email_internal: string | null;
	location: string | null;
	is_terminal: boolean;
	next_action_overdue: boolean;
	url: string;
};

export function mapTarget(
	raw: TargetRow,
	internal: { name: string | null; email: string | null },
	today: string,
): TargetOut {
	const location = [raw.city, raw.state].filter(Boolean).join(', ') || raw.country || null;
	// Explicit allowlist, not a spread: a wider select upstream must never
	// widen what leaves the server.
	return {
		id: raw.id,
		target_ref: raw.target_ref,
		company_name: raw.company_name,
		website: raw.website,
		linkedin_url: raw.linkedin_url,
		owner_name: raw.owner_name,
		owner_title: raw.owner_title,
		email: raw.email,
		phone: raw.phone,
		agency_services: raw.agency_services,
		employee_count: raw.employee_count,
		founded_year: raw.founded_year,
		est_revenue: raw.est_revenue,
		est_ebitda: raw.est_ebitda,
		financial_confidence: raw.financial_confidence,
		city: raw.city,
		state: raw.state,
		country: raw.country,
		owner_signal: raw.owner_signal,
		vertical: raw.vertical,
		notable_clients: raw.notable_clients,
		retainer_mix_pct: raw.retainer_mix_pct,
		top3_concentration_pct: raw.top3_concentration_pct,
		growth_trend: raw.growth_trend,
		management_depth: raw.management_depth,
		owner_readiness: raw.owner_readiness,
		sourcing_channel: raw.sourcing_channel,
		relationship_warmth: raw.relationship_warmth,
		last_touch_on: raw.last_touch_on,
		next_action: raw.next_action,
		next_action_on: raw.next_action_on,
		hard_gate: raw.hard_gate,
		scorecard_total: raw.scorecard_total,
		score_drivers: raw.score_drivers,
		recommendation: raw.recommendation,
		fit_score: raw.fit_score,
		status: raw.status,
		notes: raw.notes,
		batna: raw.batna,
		deal_structure: raw.deal_structure,
		deal_stage_notes: raw.deal_stage_notes,
		created_at: raw.created_at,
		updated_at: raw.updated_at,
		owner_name_internal: internal.name,
		owner_email_internal: internal.email,
		location,
		is_terminal: TERMINAL_STATUSES.has(raw.status),
		next_action_overdue: !!raw.next_action_on && raw.next_action_on < today && !TERMINAL_STATUSES.has(raw.status),
		url: `/the-work/acquisitions/${raw.id}`,
	};
}

export type NoteRow = {
	id: string;
	target_id: string;
	kind: string;
	title: string | null;
	body_md: string;
	severity: string | null;
	risk_status: string | null;
	author_id: string | null;
	identity_slug: string | null;
	proposed_action_id: string | null;
	occurred_on: string;
	created_at: string;
};

export const NOTE_COLUMNS =
	'id, target_id, kind, title, body_md, severity, risk_status, author_id, identity_slug, proposed_action_id, occurred_on, created_at';

export type NoteOut = Omit<NoteRow, 'author_id' | 'proposed_action_id'> & {
	author_name: string | null;
	via_proposal: boolean;
};

export function mapNote(raw: NoteRow, authorName: string | null): NoteOut {
	return {
		id: raw.id,
		target_id: raw.target_id,
		kind: raw.kind,
		title: raw.title,
		body_md: raw.body_md,
		severity: raw.severity,
		risk_status: raw.risk_status,
		identity_slug: raw.identity_slug,
		occurred_on: raw.occurred_on,
		created_at: raw.created_at,
		author_name: authorName,
		via_proposal: !!raw.proposed_action_id,
	};
}

/** Mary's read path: gate passed, then scorecard descending, nulls last. */
export function sortForReadPath<T extends { hard_gate: string | null; scorecard_total: number | null; next_action_on: string | null }>(rows: T[]): T[] {
	return [...rows].sort((a, b) => {
		const ga = a.hard_gate === 'pass' ? 0 : a.hard_gate === null ? 1 : 2;
		const gb = b.hard_gate === 'pass' ? 0 : b.hard_gate === null ? 1 : 2;
		if (ga !== gb) return ga - gb;
		const sa = a.scorecard_total ?? -1;
		const sb = b.scorecard_total ?? -1;
		if (sa !== sb) return sb - sa;
		const na = a.next_action_on ?? '9999';
		const nb = b.next_action_on ?? '9999';
		return na < nb ? -1 : na > nb ? 1 : 0;
	});
}
