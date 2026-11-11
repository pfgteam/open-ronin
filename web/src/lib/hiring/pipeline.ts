// Pipeline + interviews vocabulary (0132, H5). No server imports.

export const INTERVIEW_KINDS = ['culture_fit', 'job_fit', 'final', 'presentation', 'other'] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];
export const INTERVIEW_KIND_LABELS: Record<InterviewKind, string> = { culture_fit: 'Culture Fit (L1)', job_fit: 'Job Fit (L2)', final: 'Final Panel (L3)', presentation: 'Pillar presentation', other: 'Other' };

export const INTERVIEW_STATUSES = ['proposed', 'scheduled', 'completed', 'no_show', 'cancelled', 'rescheduled'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];
export const INTERVIEW_STATUS_COLORS: Record<InterviewStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = { proposed: 'default', scheduled: 'primary', completed: 'success', no_show: 'danger', cancelled: 'default', rescheduled: 'warning' };

export const LOCATION_KINDS = ['zoom', 'ghl', 'calendly', 'google_meet', 'phone', 'in_person', 'other'] as const;
export type InterviewLocationKind = (typeof LOCATION_KINDS)[number];
export const LOCATION_KIND_LABELS: Record<InterviewLocationKind, string> = { zoom: 'Zoom', ghl: 'GHL calendar', calendly: 'Calendly', google_meet: 'Google Meet', phone: 'Phone', in_person: 'In person', other: 'Other' };

export const SCALE: Record<1 | 2 | 3 | 4, string> = { 1: 'No Hire', 2: 'Conditional Pass', 3: 'Proceed with Caution', 4: 'Good Candidate' };

export const APP_STATUSES = ['new', 'screening', 'culture_fit', 'job_fit', 'final', 'offer', 'hired', 'rejected', 'withdrawn', 'pool'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export interface StageDef {
	key: string;
	label: string;
	status_key: AppStatus;
	interview_kind: InterviewKind | null;
	default_minutes: number | null;
	owner_id: string | null;
	interviewer_ids: string[];
	description?: string | null;
	booking_url?: string | null;
	location_kind?: InterviewLocationKind | null;
}

export interface InterviewConfig {
	version: number;
	stages: StageDef[];
}

export interface StageTemplateRow {
	key: string;
	label: string;
	sort: number;
	status_key: string;
	interview_kind: string | null;
	default_minutes: number | null;
	description: string | null;
	is_terminal: boolean;
	is_active: boolean;
}

/** A role with no stages yet gets the template ladder (no owners: decision 5). */
export function stagesFromTemplates(rows: StageTemplateRow[]): InterviewConfig {
	return {
		version: 1,
		stages: rows
			.filter((r) => r.is_active)
			.sort((a, b) => a.sort - b.sort)
			.map((r) => ({ key: r.key, label: r.label, status_key: r.status_key as AppStatus, interview_kind: (r.interview_kind as InterviewKind | null) ?? null, default_minutes: r.default_minutes, owner_id: null, interviewer_ids: [], description: r.description })),
	};
}

export function isEmptyStages(cfg: unknown): boolean {
	const c = cfg as InterviewConfig | null;
	return !c || !Array.isArray(c.stages) || c.stages.length === 0;
}

export function validateStages(cfg: unknown): string | null {
	const c = cfg as InterviewConfig;
	if (!c || !Array.isArray(c.stages)) return 'stages must be an array';
	const seen = new Set<string>();
	for (const s of c.stages) {
		if (!/^[a-z][a-z0-9_]{1,40}$/.test(s.key ?? '')) return `stage key invalid: ${s.key}`;
		if (seen.has(s.key)) return `duplicate stage key: ${s.key}`;
		seen.add(s.key);
		if (!APP_STATUSES.includes(s.status_key)) return `stage ${s.key}: status invalid`;
		if (s.interview_kind && !INTERVIEW_KINDS.includes(s.interview_kind)) return `stage ${s.key}: interview kind invalid`;
		if (!s.label?.trim()) return `stage ${s.key}: label required`;
	}
	return null;
}

// ---------------------------------------------------------------- scorecards

export interface ScorecardQuestion {
	key: string;
	interview_kind: InterviewKind;
	position: number;
	label: string;
	prompt: string;
	pillars: string[];
	anchors: Record<string, string>;
	weight: number;
	is_template: boolean;
	is_active: boolean;
}

export type ScorecardAnswers = Record<string, { score?: number | null; note?: string | null }>;

export interface ScorecardRules {
	culture_fit?: { advance_min_avg?: number; no_ones?: boolean; twos_are_watchouts?: boolean };
	job_fit?: { advance_min_avg?: number; no_ones_in?: string[]; twos_flag_for_panel?: boolean };
	final?: { strong_hire_min_avg?: number; strong_hire_needs_four_in?: string[]; no_hire_if_one_in?: string[]; no_ones?: boolean };
	presentation?: { red_flag_one_in?: string[]; strong_signal_fours_in?: string[] };
}

export function scorecardStats(a: ScorecardAnswers): { n: number; avg: number | null; min: number | null; ones: string[]; twos: string[]; fours: string[] } {
	const entries = Object.entries(a).filter(([, v]) => v?.score != null && v.score >= 1 && v.score <= 4);
	const scores = entries.map(([, v]) => v.score as number);
	return {
		n: scores.length,
		avg: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 100) / 100 : null,
		min: scores.length ? Math.min(...scores) : null,
		ones: entries.filter(([, v]) => v.score === 1).map(([k]) => k),
		twos: entries.filter(([, v]) => v.score === 2).map(([k]) => k),
		fours: entries.filter(([, v]) => v.score === 4).map(([k]) => k),
	};
}

/** Applies the Hiring Process 2026 advance / hire rules to one card. */
export function evaluateScorecard(kind: InterviewKind, a: ScorecardAnswers, rules: ScorecardRules): { verdict: 'strong_hire' | 'advance' | 'conditional' | 'no_hire' | 'incomplete'; reasons: string[]; watchouts: string[] } {
	const s = scorecardStats(a);
	if (s.n === 0) return { verdict: 'incomplete', reasons: ['No scores yet.'], watchouts: [] };
	const reasons: string[] = [];
	const watchouts = s.twos;
	if (kind === 'culture_fit') {
		const r = rules.culture_fit ?? {};
		if ((r.no_ones ?? true) && s.ones.length) reasons.push(`Score of 1 on ${s.ones.join(', ')}`);
		if ((s.avg ?? 0) < (r.advance_min_avg ?? 3)) reasons.push(`Average ${s.avg} < ${r.advance_min_avg ?? 3}`);
		return { verdict: reasons.length ? 'no_hire' : s.twos.length ? 'conditional' : 'advance', reasons, watchouts };
	}
	if (kind === 'job_fit') {
		const r = rules.job_fit ?? {};
		const critical = s.ones.filter((k) => (r.no_ones_in ?? []).includes(k));
		if (critical.length) reasons.push(`Score of 1 on a critical question: ${critical.join(', ')}`);
		if ((s.avg ?? 0) < (r.advance_min_avg ?? 3)) reasons.push(`Average ${s.avg} < ${r.advance_min_avg ?? 3}`);
		return { verdict: reasons.length ? 'no_hire' : s.twos.length ? 'conditional' : 'advance', reasons, watchouts };
	}
	if (kind === 'final') {
		const r = rules.final ?? {};
		const fatal = s.ones.filter((k) => (r.no_hire_if_one_in ?? []).includes(k));
		if (fatal.length) return { verdict: 'no_hire', reasons: [`Score of 1 on ${fatal.join(', ')}`], watchouts };
		if ((r.no_ones ?? true) && s.ones.length) reasons.push(`Score of 1 on ${s.ones.join(', ')}`);
		const strong = (s.avg ?? 0) >= (r.strong_hire_min_avg ?? 3.2) && !s.ones.length && s.fours.some((k) => (r.strong_hire_needs_four_in ?? []).includes(k));
		if (strong) return { verdict: 'strong_hire', reasons: [`Average ${s.avg} ≥ ${r.strong_hire_min_avg ?? 3.2}, a 4 on a core question`], watchouts };
		return { verdict: reasons.length ? 'conditional' : (s.avg ?? 0) >= 3 ? 'advance' : 'conditional', reasons: reasons.length ? reasons : [`Average ${s.avg}`], watchouts };
	}
	if (kind === 'presentation') {
		const r = rules.presentation ?? {};
		const red = s.ones.filter((k) => (r.red_flag_one_in ?? []).includes(k));
		if (red.length) return { verdict: 'no_hire', reasons: [`Red flag: 1 on ${red.join(', ')}`], watchouts };
		const strong = s.fours.filter((k) => (r.strong_signal_fours_in ?? []).includes(k));
		return { verdict: strong.length >= 2 ? 'strong_hire' : (s.avg ?? 0) >= 3 ? 'advance' : 'conditional', reasons: strong.length ? [`Strong signal: 4s on ${strong.join(', ')}`] : [`Average ${s.avg}`], watchouts };
	}
	return { verdict: (s.avg ?? 0) >= 3 ? 'advance' : 'conditional', reasons: [`Average ${s.avg}`], watchouts };
}

// ---------------------------------------------------------------- messages

export const CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface MessageVars {
	first_name: string;
	full_name: string;
	position: string;
	brand: string;
	sender_name: string;
	sender_title: string;
	signature: string;
	booking_url?: string;
	interviewers?: string;
	interview_kind?: string;
	when?: string;
	timezone?: string;
	location?: string;
	next_step?: string;
	similar_roles?: string;
	alert_url?: string;
	portal_url?: string;
	[k: string]: string | undefined;
}

/** {{placeholder}} rendering; unknown keys render empty so a template never leaks braces. */
export function renderTemplate(text: string, vars: MessageVars): string {
	return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

export function firstName(full: string): string {
	return full.trim().split(/\s+/)[0] ?? full;
}

/** SMS bodies: strip markdown, collapse whitespace, cap at 1600 (GHL splits). */
export function toSmsText(md: string): string {
	return md
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/\[(.+?)\]\((.+?)\)/g, '$1 $2')
		.replace(/^#+\s*/gm, '')
		.replace(/\n{2,}/g, '\n')
		.trim()
		.slice(0, 1600);
}
