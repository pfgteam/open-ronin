// Onboarding + DISC + attendance vocabulary (0134, H7). No server imports:
// client components (the DISC questionnaire, the onboarding checklist) and
// the server readers both import from here.

export const ONBOARDING_PHASES: Record<1 | 2 | 3, { label: string; days: string; focus: string }> = {
	1: { label: 'Phase 1 · Integration & context', days: 'Days 1-30', focus: 'Psychological safety, immersion, understanding the system. No formal PPF / PAP yet.' },
	2: { label: 'Phase 2 · Role clarity & operating alignment', days: 'Days 30-60', focus: 'Role definition → PAP v1 → DISC (days 45-60). The 60-Day Plan closes here.' },
	3: { label: 'Phase 3 · Strategic alignment & calibration', days: 'Days 60-90', focus: 'PPF → Time Study (days 75-90) → day-90 review. Onboarding complete.' },
};

export const ONBOARDING_ITEM_STATUSES = ['todo', 'in_progress', 'done', 'skipped', 'blocked'] as const;
export type OnboardingItemStatus = (typeof ONBOARDING_ITEM_STATUSES)[number];
export const ONBOARDING_ITEM_STATUS_COLORS: Record<OnboardingItemStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = { todo: 'default', in_progress: 'primary', done: 'success', skipped: 'default', blocked: 'danger' };
export const ONBOARDING_PLAN_STATUSES = ['active', 'paused', 'complete', 'exited'] as const;
export type OnboardingPlanStatus = (typeof ONBOARDING_PLAN_STATUSES)[number];
export const ONBOARDING_OWNER_LABELS: Record<string, string> = { manager: 'Manager', hire: 'New hire', hr: 'HR', alex: 'Alex' };
export const ONBOARDING_KIND_LABELS: Record<string, string> = { task: 'Task', module: 'Module', milestone: 'Milestone', meeting: 'Meeting' };

/** Day number of onboarding for a start date (day 1 = the start date). */
export function onboardingDay(startOn: string, asOf: Date = new Date()): number {
	const start = new Date(`${startOn}T00:00:00`);
	const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
	return Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Traffic light for a plan item (the framework's Green / Yellow / Red). */
export function itemLight(item: { status: OnboardingItemStatus; due_on: string; window_from: string | null }, today = new Date().toISOString().slice(0, 10)): 'green' | 'yellow' | 'red' | 'grey' {
	if (item.status === 'done' || item.status === 'skipped') return 'green';
	if (item.status === 'blocked' || item.due_on < today) return 'red';
	if (item.status === 'in_progress' || (item.window_from && item.window_from <= today)) return 'yellow';
	return 'grey';
}

// ---------------------------------------------------------------- DISC

export const DISC_TRAITS = ['D', 'I', 'S', 'C'] as const;
export type DiscTrait = (typeof DISC_TRAITS)[number];
export const DISC_TRAIT_LABELS: Record<DiscTrait, { name: string; blurb: string }> = {
	D: { name: 'Dominance', blurb: 'Direct, results-driven, decisive. Wants the bottom line and the authority to act.' },
	I: { name: 'Influence', blurb: 'Enthusiastic, persuasive, people-first. Wants recognition, variety and a say.' },
	S: { name: 'Steadiness', blurb: 'Patient, loyal, consistent. Wants stability, clear expectations and sincere appreciation.' },
	C: { name: 'Conscientiousness', blurb: 'Analytical, precise, systematic. Wants data, time to think and quality over speed.' },
};

export interface DiscQuestion {
	id: number;
	d_word: string;
	i_word: string;
	s_word: string;
	c_word: string;
}
export interface DiscAnswer {
	q: number;
	most: DiscTrait;
	least: DiscTrait;
}
export interface DiscScores extends Record<string, number> {
	D: number;
	I: number;
	S: number;
	C: number;
}

/**
 * Mirrors `public.hire_disc_score()` (0134): pct = (most - least + n) / 4n per
 * trait (sums to 100); style = primary trait, plus the second when >= 25
 * (uppercase within 5 points, lowercase otherwise), plus a lowercase third
 * when >= 25. A DISC-style indicator we own — not a licensed instrument.
 */
export function scoreDisc(answers: DiscAnswer[]): { scores: DiscScores; style: string; n: number } {
	const n = answers.length;
	if (n === 0) return { scores: { D: 25, I: 25, S: 25, C: 25 }, style: '', n: 0 };
	const raw: Record<DiscTrait, number> = { D: 0, I: 0, S: 0, C: 0 };
	for (const a of answers) {
		if (a.most in raw) raw[a.most] += 1;
		if (a.least in raw) raw[a.least] -= 1;
	}
	const total = 4 * n;
	const pct = (v: number) => Math.round(((v + n) * 1000) / total) / 10;
	const scores: DiscScores = { D: pct(raw.D), I: pct(raw.I), S: pct(raw.S), C: pct(raw.C) };
	const ordered = (Object.keys(scores) as DiscTrait[]).sort((a, b) => scores[b] - scores[a] || a.localeCompare(b));
	let style: string = ordered[0];
	if (scores[ordered[1]] >= 25) style += scores[ordered[0]] - scores[ordered[1]] <= 5 ? ordered[1] : ordered[1].toLowerCase();
	if (scores[ordered[2]] >= 25) style += ordered[2].toLowerCase();
	return { scores, style, n };
}

/** Parse a hand-entered style ("Si", "CD", "Ds/CD") into trait percentages for display; null when it is not DISC letters. */
export function styleToScores(style: string): DiscScores | null {
	const letters = style.replace(/[^DISCdisc]/g, '');
	if (!letters) return null;
	const out: DiscScores = { D: 10, I: 10, S: 10, C: 10 };
	let weight = 40;
	for (const ch of letters) {
		const t = ch.toUpperCase() as DiscTrait;
		out[t] += ch === t ? weight : weight / 2;
		weight = Math.max(10, weight - 10);
	}
	const sum = out.D + out.I + out.S + out.C;
	return { D: Math.round((out.D / sum) * 100), I: Math.round((out.I / sum) * 100), S: Math.round((out.S / sum) * 100), C: Math.round((out.C / sum) * 100) };
}

/** "How I work best" prompts for the summary a person writes after the result. */
export const HOW_I_WORK_PROMPTS = [
	'How I like to receive information (detail vs headline, written vs call)',
	'How I make decisions and how fast',
	'What energises me / what drains me',
	'How I prefer feedback',
	'What my manager and teammates can do to get the best from me',
] as const;

// ---------------------------------------------------------------- attendance

export const ATTENDANCE_EVENT_KINDS = ['sick', 'unpaid', 'late', 'absent', 'wfh', 'holiday_worked', 'half_day', 'other'] as const;
export type AttendanceEventKind = (typeof ATTENDANCE_EVENT_KINDS)[number];
export const ATTENDANCE_EVENT_LABELS: Record<AttendanceEventKind, string> = { sick: 'Sick', unpaid: 'Unpaid leave', late: 'Late', absent: 'Absent (unplanned)', wfh: 'WFH (in-person roles)', holiday_worked: 'Worked a holiday', half_day: 'Half day', other: 'Other' };
export const ACCRUAL_METHODS = ['daily', 'monthly', 'upfront', 'none'] as const;
export const POLICY_REGIONS = ['us', 'os', 'any'] as const;

export interface AttendanceSummaryRow {
	profile_id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	department_tag_id: string | null;
	manager_id: string | null;
	date_started: string | null;
	is_active: boolean;
	policy_id: string | null;
	policy_key: string | null;
	policy_label: string | null;
	accrual_days_per_year: number | null;
	waiting_period_days: number | null;
	eligible_from: string | null;
	accrued_days: number;
	opening_days: number;
	adjustment_days: number;
	used_pto_days: number;
	pending_pto_days: number;
	sick_days: number;
	unpaid_days: number;
	late_count: number;
	balance_days: number;
	can_see_balance: boolean;
}

/** Days accrued at `asOf` under a daily-accrual policy (mirrors the SQL). */
export function accruedDays(perYear: number, dateStarted: string | null, year: number, asOf: string): number {
	const yStart = new Date(`${year}-01-01T00:00:00`);
	const yEnd = new Date(`${year}-12-31T00:00:00`);
	const start = dateStarted ? new Date(`${dateStarted}T00:00:00`) : yStart;
	const from = start > yStart ? start : yStart;
	const to = new Date(`${asOf}T00:00:00`) < yEnd ? new Date(`${asOf}T00:00:00`) : yEnd;
	const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
	const yearDays = Math.round((yEnd.getTime() - yStart.getTime()) / 86_400_000) + 1;
	return Math.round((perYear * days * 100) / yearDays) / 100;
}

export function fmtDays(n: number | null | undefined): string {
	if (n == null) return '—';
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
