// Calibration / Vantage Point vocabulary. No server imports.
//
// 0085 shipped a nine-box pair (performance / potential, 1-3). 0118 replaces
// it with the Quarterly Team Assessment: 15 categories in 3 groups, rated 0-5
// against a rubric, weighted to 100 points. Old rows keep `model = 'ninebox'`
// and stay readable; everything new is `model = 'scorecard'`.

export const ROUNDS = ['self', 'leader', 'exec'] as const;
export type Round = (typeof ROUNDS)[number];

export const ROUND_LABELS: Record<Round, string> = {
	self: 'Round 1 · Self',
	leader: 'Round 2 · Leader',
	exec: 'Round 3 · Exec',
};

export const ROUND_SHORT: Record<Round, string> = { self: 'Self', leader: 'Leader', exec: 'Exec' };

// ----- the scorecard ----------------------------------------------------------

export const GROUPS = ['core', 'performance', 'professional'] as const;
export type GroupKey = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<GroupKey, string> = {
	core: 'Core Pillars',
	performance: 'Performance',
	professional: 'Professional',
};

export const RATINGS = [0, 1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

/** A question as the form sees it: the cycle snapshot row, weight optional (admin only). */
export interface CycleQuestion {
	id: string;
	cycle_id: string;
	key: string;
	group_key: GroupKey;
	label: string;
	prompt: string;
	position: number;
	/** Six strings, index = rating 0..5. */
	rubric: string[];
	/** Present only when read by an admin surface. */
	weight?: number | null;
}

export interface AnswerRow {
	id?: string;
	score_id: string;
	cycle_question_id: string;
	rating: number | null;
	notes: string | null;
}

export type ScoreModel = 'ninebox' | 'scorecard' | 'import';

export interface ScoreRow {
	id: string;
	cycle_id: string;
	subject_id: string;
	round: Round;
	scorer_id: string;
	model: ScoreModel;
	/** 0085 pair; null on scorecard rows. */
	performance: number | null;
	potential: number | null;
	/** 0118 totals, set by the DB at submit. */
	total: number | null;
	core_total: number | null;
	performance_total: number | null;
	professional_total: number | null;
	notes_md: string | null;
	priorities_md: string | null;
	outcome: Outcome | null;
	/** model = 'import': the original form's responses, verbatim. */
	import_payload: ImportPayload | null;
	submitted_at: string | null;
}

/** Leadership 13 Week (Google Form) response, as imported (0118). */
export interface ImportPayload {
	source?: string;
	scale?: string[];
	timestamp?: string;
	reviewer_email?: string;
	quarter_raw?: string | null;
	team_member_name?: string;
	/** Poor .. Epic labels (or a bare number on the earliest responses). */
	pillars?: Record<string, string | null>;
	overall?: string | null;
	answers?: Record<string, string>;
	responses?: ImportPayload[];
}

export const IMPORT_PILLARS = ['transparency', 'obsessed', 'leadership', 'execution', 'growth', 'intentionality', 'teamwork'] as const;
export const IMPORT_PILLAR_LABELS: Record<(typeof IMPORT_PILLARS)[number], string> = {
	transparency: 'Transparency', obsessed: 'Obsession', leadership: 'Leadership', execution: 'Execution', growth: 'Growth', intentionality: 'Intentionality', teamwork: 'Teamwork',
};

export const SCORE_COLUMNS =
	'id, cycle_id, subject_id, round, scorer_id, model, performance, potential, total, core_total, performance_total, professional_total, notes_md, priorities_md, outcome, import_payload, submitted_at';

/** Columns that exist before 0118 is applied (the page falls back to these). */
export const SCORE_COLUMNS_LEGACY = 'id, cycle_id, subject_id, round, scorer_id, performance, potential, notes_md, submitted_at';

/** Which round is next for a subject, given their submitted rounds. */
export function nextRound(scores: Pick<ScoreRow, 'round' | 'submitted_at'>[]): Round | 'done' {
	const done = new Set(scores.filter((s) => s.submitted_at).map((s) => s.round));
	if (!done.has('self')) return 'self';
	if (!done.has('leader')) return 'leader';
	if (!done.has('exec')) return 'exec';
	return 'done';
}

/** True when `round` may be edited now (previous rounds submitted, this one not). */
export function roundOpen(round: Round, scores: Pick<ScoreRow, 'round' | 'submitted_at'>[]): boolean {
	return nextRound(scores) === round;
}

/** Plain-wording status for the admin board. */
export const STATUS_LABELS: Record<Round | 'done', string> = {
	self: 'Not started',
	leader: 'Waiting on leader',
	exec: 'Waiting on exec',
	done: 'Complete',
};

// ----- totals (mirrors public.calibration_compute_totals) -------------------------

export interface Totals {
	total: number;
	core: number;
	performance: number;
	professional: number;
	answered: number;
	expected: number;
}

/**
 * Weighted totals from answers x questions. The DB computes the official
 * number at submit; this is for admin previews and tests. rating/5 x weight,
 * rounded to 2 places per group and overall (same as the SQL).
 */
export function computeTotals(
	questions: Pick<CycleQuestion, 'id' | 'group_key' | 'weight'>[],
	answers: Pick<AnswerRow, 'cycle_question_id' | 'rating'>[],
): Totals {
	const byQ = new Map(answers.map((a) => [a.cycle_question_id, a.rating]));
	const sums: Record<GroupKey, number> = { core: 0, performance: 0, professional: 0 };
	let answered = 0;
	for (const q of questions) {
		const r = byQ.get(q.id);
		if (r == null) continue;
		answered += 1;
		sums[q.group_key] += (r / 5) * Number(q.weight ?? 0);
	}
	const r2 = (n: number) => Math.round(n * 100) / 100;
	return {
		total: r2(sums.core + sums.performance + sums.professional),
		core: r2(sums.core),
		performance: r2(sums.performance),
		professional: r2(sums.professional),
		answered,
		expected: questions.length,
	};
}

/** Group weight ceilings for a cycle (admin only knows weights; the form shows totals out of these). */
export const GROUP_MAX: Record<GroupKey, number> = { core: 35, performance: 45, professional: 20 };

// ----- outcomes (Vantage Point grid) --------------------------------------------

export const OUTCOMES = ['recognize', 'coach', 'develop', 'reassign', 'performance_decision', 'repair_system'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_META: Record<Outcome, { label: string; action: string; computable: boolean }> = {
	recognize: { label: 'Strong results + strong behaviors', action: 'Recognize and consider greater responsibility', computable: true },
	coach: { label: 'Strong results + damaging behaviors', action: 'Coach directly and protect the culture', computable: true },
	develop: { label: 'Weak results with clear improvement', action: 'Continue focused development', computable: true },
	reassign: { label: 'Weak results caused by role mismatch', action: 'Reassign when a better fit exists', computable: false },
	performance_decision: { label: 'Weak results despite clarity and support', action: 'Begin a formal performance decision', computable: false },
	repair_system: { label: 'Inconsistent results with unclear standards', action: 'Repair the management system first', computable: false },
};

/**
 * Thresholds as a share of the group maximum. "Strong" results = Performance
 * group at or above 70% of its weight (31.5 of 45); "strong" behaviors = Core
 * Pillars at or above 70% (24.5 of 35). "Damaging" behaviors = below 50%.
 * Improvement = total up by at least 5 points on the previous quarter.
 */
export const GRID_THRESHOLDS = { strong: 0.7, damaging: 0.5, improvementPts: 5 } as const;

export interface GridInput {
	performance_total: number;
	core_total: number;
	total: number;
	/** Previous quarter's exec total, when there is one. */
	previous_total?: number | null;
	/** Group ceilings for the cycle (defaults to the seed weights). */
	max?: { performance: number; core: number };
}

/**
 * Suggested outcome from the numbers alone. The three outcomes that need
 * judgment (reassign / performance_decision / repair_system) are never
 * suggested; exec picks them on the person during the exec round.
 */
export function suggestOutcome(input: GridInput): Outcome {
	const max = input.max ?? { performance: GROUP_MAX.performance, core: GROUP_MAX.core };
	const results = max.performance > 0 ? input.performance_total / max.performance : 0;
	const behaviors = max.core > 0 ? input.core_total / max.core : 0;
	if (results >= GRID_THRESHOLDS.strong) {
		return behaviors < GRID_THRESHOLDS.damaging ? 'coach' : 'recognize';
	}
	const prev = input.previous_total;
	if (prev != null && input.total - prev >= GRID_THRESHOLDS.improvementPts) return 'develop';
	// Weak results, no improvement signal: the honest default is "keep
	// developing" until exec says otherwise; the grid shows it as needing a call.
	return 'develop';
}

/** Which axis cell a person lands in (for drawing the 2x2 grid). */
export function gridCell(input: GridInput): { results: 'strong' | 'weak'; behaviors: 'strong' | 'damaging' | 'mixed' } {
	const max = input.max ?? { performance: GROUP_MAX.performance, core: GROUP_MAX.core };
	const results = max.performance > 0 ? input.performance_total / max.performance : 0;
	const behaviors = max.core > 0 ? input.core_total / max.core : 0;
	return {
		results: results >= GRID_THRESHOLDS.strong ? 'strong' : 'weak',
		behaviors: behaviors >= GRID_THRESHOLDS.strong ? 'strong' : behaviors < GRID_THRESHOLDS.damaging ? 'damaging' : 'mixed',
	};
}

// ----- distribution by leader (admin) --------------------------------------------

export interface Distribution {
	n: number;
	mean: number;
	sd: number;
	/** Ten buckets of 10 points: index 0 = 0-9, 9 = 90-100. */
	histogram: number[];
	flags: ('skewed_low' | 'skewed_high' | 'narrow')[];
}

/**
 * Score distribution for one scorer. Flags when the leader's mean sits more
 * than `skewPts` away from the company mean in EITHER direction, or when the
 * spread is under `minSd` with at least 3 scores (everyone got the same
 * number). A healthy team is roughly bell-shaped around the average.
 */
export function distribution(totals: number[], companyMean: number, opts = { skewPts: 10, minSd: 5 }): Distribution {
	const n = totals.length;
	const histogram = new Array<number>(10).fill(0);
	for (const t of totals) histogram[Math.min(9, Math.max(0, Math.floor(t / 10)))] += 1;
	if (n === 0) return { n, mean: 0, sd: 0, histogram, flags: [] };
	const mean = totals.reduce((a, b) => a + b, 0) / n;
	const sd = Math.sqrt(totals.reduce((a, t) => a + (t - mean) ** 2, 0) / n);
	const flags: Distribution['flags'] = [];
	if (n >= 2 && mean - companyMean > opts.skewPts) flags.push('skewed_high');
	if (n >= 2 && companyMean - mean > opts.skewPts) flags.push('skewed_low');
	if (n >= 3 && sd < opts.minSd) flags.push('narrow');
	return { n, mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10, histogram, flags };
}

// ----- legacy nine-box (0085 rows) ------------------------------------------------

export const PERFORMANCE_LABELS: Record<number, string> = { 1: 'Below', 2: 'Meets', 3: 'Exceeds' };
export const POTENTIAL_LABELS: Record<number, string> = { 1: 'Limited', 2: 'Growing', 3: 'High' };

export const BOX_LABELS: Record<number, string> = {
	1: 'Underperformer',
	2: 'Effective',
	3: 'Trusted professional',
	4: 'Inconsistent',
	5: 'Core player',
	6: 'High performer',
	7: 'Enigma',
	8: 'Growth employee',
	9: 'Star',
};

export function boxOf(performance: number, potential: number): number {
	return (potential - 1) * 3 + performance;
}

// ----- which quarter a cycle is about ------------------------------------------------

/**
 * The quarter a cycle opened today should assess: the one that just ENDED,
 * not the calendar quarter. Calibration looks back (26-1 was scored in April,
 * 26-2 in June/July, 26-3 in October). Derived from `starts_on` only, never
 * from `quarters.is_current` (a plain column in production, stuck on 26-2).
 * Returns the latest quarter whose `starts_on` is before the current one's,
 * or the latest one before today when no quarter covers today, or null.
 */
export function assessedQuarterFor<Q extends { id: string; starts_on: string | null }>(quarters: Q[], today = new Date()): Q | null {
	const todayStr = today.toISOString().slice(0, 10);
	const dated = quarters.filter((q): q is Q & { starts_on: string } => !!q.starts_on).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
	const started = dated.filter((q) => q.starts_on <= todayStr);
	if (started.length === 0) return null;
	// The last one to have started is the calendar quarter; the one before it just ended.
	return started.length >= 2 ? started[started.length - 2] : started[0];
}

/** Format a total for display: whole numbers stay whole, otherwise one decimal. */
export function fmtTotal(n: number | null | undefined): string {
	if (n == null) return '—';
	const v = Number(n);
	return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
