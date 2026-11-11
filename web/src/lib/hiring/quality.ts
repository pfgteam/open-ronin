// Quality-of-hire vocabulary + aggregation (0135, H8). No server imports:
// the page groups the per-hire rows from hire_quality_hires() by role /
// source / recruiter / interviewer here, so the grouping is tested.

export interface QualityHireRow {
	profile_id: string;
	full_name: string;
	email: string;
	job_role: string | null;
	department_tag_id: string | null;
	manager_id: string | null;
	date_started: string;
	is_active: boolean;
	employment_status: string | null;
	exited_on: string | null;
	days_employed: number;
	retained_30: boolean | null;
	retained_60: boolean | null;
	retained_90: boolean | null;
	retained_180: boolean | null;
	advancements: number;
	level_now: number | null;
	calibration_latest: number | null;
	calibration_avg: number | null;
	calibration_outcome: string | null;
	calibration_cycles: number;
	contributions: number;
	contributions_open: number;
	offer_id: string | null;
	application_id: string | null;
	position_id: string | null;
	position_title: string | null;
	source: string | null;
	link_code: string | null;
	board_key: string | null;
	referrer_user_id: string | null;
	recruiter_id: string | null;
	hiring_manager_id: string | null;
	submitted_at: string | null;
	hired_at: string | null;
	time_to_hire_days: number | null;
	interviewer_ids: string[] | null;
	scorecard_avg: number | null;
	overall_score: number | null;
	onboarding_status: string | null;
	onboarding_done: number | null;
	onboarding_total: number | null;
}

export interface QualityFunnelRow {
	position_id: string;
	title: string;
	status: string;
	brand: string;
	department_label: string | null;
	hiring_manager_id: string | null;
	recruiter_id: string | null;
	opened_at: string | null;
	closed_at: string | null;
	headcount: number;
	applications: number;
	by_status: Record<string, number>;
	stage_entries: Record<string, number>;
	interviews: number;
	no_shows: number;
	offers: number;
	offers_declined: number;
	hired: number;
	median_time_to_hire_days: number | null;
	avg_time_to_hire_days: number | null;
	posting_cost_cents: number;
	cost_per_hire_cents: number | null;
	avg_overall_score: number | null;
	avg_overall_hired: number | null;
}

export interface QualitySourceRow {
	position_id: string;
	source: string;
	board_key: string | null;
	applications: number;
	past_screening: number;
	interviewed: number;
	offered: number;
	hired: number;
	retained_90: number;
	avg_overall: number | null;
	avg_integrity: number | null;
	flagged: number;
	posting_cost_cents: number;
	cost_per_hire_cents: number | null;
	link_hits: number;
}

export interface QualityInterviewerRow {
	scorer_id: string;
	cards: number;
	interviews: number;
	avg_score: number | null;
	strong_hire: number;
	advance: number;
	conditional: number;
	no_hire: number;
	decided: number;
	agreed: number;
	accuracy_pct: number | null;
	hired_after_yes: number;
	hired_after_no: number;
	rejected_after_yes: number;
	avg_score_hired: number | null;
	avg_score_rejected: number | null;
	retained_90_after_yes: number;
}

export type GroupBy = 'role' | 'source' | 'recruiter' | 'interviewer' | 'manager' | 'department';
export const GROUP_LABELS: Record<GroupBy, string> = { role: 'Role', source: 'Source', recruiter: 'Recruiter', interviewer: 'Interviewer', manager: 'Manager', department: 'Department' };

export interface QualityGroup {
	key: string;
	label: string;
	hires: number;
	active: number;
	/** retention rate = retained / known (people past the milestone or exited) */
	retained_30: { n: number; of: number };
	retained_60: { n: number; of: number };
	retained_90: { n: number; of: number };
	retained_180: { n: number; of: number };
	advancements: number;
	calibration_avg: number | null;
	calibration_n: number;
	contributions: number;
	time_to_hire_avg: number | null;
	time_to_hire_n: number;
	scorecard_avg: number | null;
	/** composite 0-100: 40 retention-180 (fallback to the furthest known milestone) + 20 advancements (capped 2) + 25 calibration (/100) + 15 contributions (capped 10) */
	success_score: number | null;
	rows: QualityHireRow[];
}

function rate(rows: QualityHireRow[], k: 'retained_30' | 'retained_60' | 'retained_90' | 'retained_180'): { n: number; of: number } {
	const known = rows.filter((r) => r[k] !== null);
	return { n: known.filter((r) => r[k] === true).length, of: known.length };
}

function avg(xs: (number | null | undefined)[]): { v: number | null; n: number } {
	const ys = xs.filter((x): x is number => x != null && Number.isFinite(Number(x))).map(Number);
	return { v: ys.length ? Math.round((ys.reduce((a, b) => a + b, 0) / ys.length) * 10) / 10 : null, n: ys.length };
}

/** Per-person success score (decision 9), 0-100, null until something is known. */
export function successScore(r: QualityHireRow): number | null {
	const ret = r.retained_180 ?? r.retained_90 ?? r.retained_60 ?? r.retained_30;
	const parts: number[] = [];
	const weights: number[] = [];
	if (ret !== null && ret !== undefined) {
		parts.push(ret ? 100 : 0);
		weights.push(40);
	}
	parts.push(Math.min(2, r.advancements) * 50);
	weights.push(20);
	if (r.calibration_latest != null) {
		parts.push(Math.max(0, Math.min(100, Number(r.calibration_latest))));
		weights.push(25);
	}
	parts.push(Math.min(10, r.contributions) * 10);
	weights.push(15);
	if (!weights.length) return null;
	const w = weights.reduce((a, b) => a + b, 0);
	return Math.round(parts.reduce((acc, p, i) => acc + (p * weights[i]) / w, 0));
}

export function groupHires(rows: QualityHireRow[], by: GroupBy, names: Map<string, string>): QualityGroup[] {
	const buckets = new Map<string, { label: string; rows: QualityHireRow[] }>();
	const put = (key: string, label: string, r: QualityHireRow) => {
		const b = buckets.get(key) ?? { label, rows: [] };
		b.rows.push(r);
		buckets.set(key, b);
	};
	for (const r of rows) {
		if (by === 'role') put(r.position_title ?? r.job_role ?? '—', r.position_title ?? r.job_role ?? 'No role recorded', r);
		else if (by === 'source') put(r.board_key ?? r.source ?? 'legacy', r.board_key ?? r.source ?? 'legacy', r);
		else if (by === 'recruiter') put(r.recruiter_id ?? '—', r.recruiter_id ? names.get(r.recruiter_id) ?? r.recruiter_id : 'No recruiter', r);
		else if (by === 'manager') put(r.manager_id ?? '—', r.manager_id ? names.get(r.manager_id) ?? r.manager_id : 'No manager', r);
		else if (by === 'department') put(r.department_tag_id ?? '—', r.department_tag_id ? names.get(`dept:${r.department_tag_id}`) ?? r.department_tag_id : 'No department', r);
		else if (by === 'interviewer') {
			const ids = r.interviewer_ids ?? [];
			if (!ids.length) put('—', 'No interviewers recorded', r);
			for (const id of ids) put(id, names.get(id) ?? id, r);
		}
	}
	const out: QualityGroup[] = [];
	for (const [key, b] of buckets) {
		const cal = avg(b.rows.map((r) => r.calibration_latest));
		const tth = avg(b.rows.map((r) => r.time_to_hire_days));
		const sc = avg(b.rows.map((r) => r.scorecard_avg));
		const scores = b.rows.map(successScore).filter((x): x is number => x != null);
		out.push({
			key,
			label: b.label,
			hires: b.rows.length,
			active: b.rows.filter((r) => r.is_active).length,
			retained_30: rate(b.rows, 'retained_30'),
			retained_60: rate(b.rows, 'retained_60'),
			retained_90: rate(b.rows, 'retained_90'),
			retained_180: rate(b.rows, 'retained_180'),
			advancements: b.rows.reduce((a, r) => a + r.advancements, 0),
			calibration_avg: cal.v,
			calibration_n: cal.n,
			contributions: b.rows.reduce((a, r) => a + r.contributions, 0),
			time_to_hire_avg: tth.v,
			time_to_hire_n: tth.n,
			scorecard_avg: sc.v,
			success_score: scores.length ? Math.round(scores.reduce((a, b2) => a + b2, 0) / scores.length) : null,
			rows: b.rows,
		});
	}
	return out.sort((a, b) => b.hires - a.hires || a.label.localeCompare(b.label));
}

export function pct(n: number, of: number): string {
	return of ? `${Math.round((100 * n) / of)}%` : '—';
}

/** Funnel conversion: of those who entered each stage, what share reached the next. */
export const FUNNEL_STAGES = ['new', 'screening', 'culture_fit', 'job_fit', 'final', 'offer', 'hired'] as const;
export function funnelCounts(f: QualityFunnelRow): { stage: string; entered: number; conv: string }[] {
	const entered = (s: string) => (s === 'new' ? f.applications : Math.max(f.stage_entries[s] ?? 0, f.by_status[s] ?? 0, s === 'hired' ? f.hired : 0));
	// a person who is further along entered every earlier stage too
	const cum: number[] = FUNNEL_STAGES.map((_, i) => {
		let n = 0;
		for (let j = i; j < FUNNEL_STAGES.length; j++) n = Math.max(n, entered(FUNNEL_STAGES[j]));
		return n;
	});
	return FUNNEL_STAGES.map((s, i) => ({ stage: s, entered: cum[i], conv: i === 0 ? '—' : pct(cum[i], cum[i - 1]) }));
}
