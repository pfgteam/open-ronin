// Calibration server readers (0118). One place that knows the 0085 -> 0118
// shape difference so each page does not. Server-only: imports the server
// Supabase client indirectly through the SupabaseClient the caller passes.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
	SCORE_COLUMNS,
	SCORE_COLUMNS_LEGACY,
	type AnswerRow,
	type CycleQuestion,
	type Round,
	type ScoreRow,
} from './shared';

export interface Cycle {
	id: string;
	quarter_id: string;
	status: 'open' | 'closed';
	opened_at: string;
	closed_at: string | null;
}

export interface Quarter {
	id: string;
	name: string;
	year: number | null;
	quarter: number | null;
	starts_on: string | null;
}

export function isMissingColumn(e: { code?: string; message?: string } | null): boolean {
	return !!e && (e.code === '42703' || e.code === '42P01' || /column .* does not exist|relation .* does not exist|schema cache/i.test(e.message ?? ''));
}

/**
 * All cycles newest first + the quarter rows they point at. A cycle's quarter
 * is the one it ASSESSES (the quarter that just ended when it opened), so
 * callers label and order cycles by their quarter row, never by today's date.
 * `quarters.is_current` is deliberately not read (stale plain column in prod).
 */
export async function loadCycles(supabase: SupabaseClient): Promise<{ cycles: Cycle[]; quarters: Quarter[]; error: string | null }> {
	const [{ data: cycleRows, error }, { data: quarterRows }] = await Promise.all([
		supabase.from('calibration_cycles').select('id, quarter_id, status, opened_at, closed_at').order('opened_at', { ascending: false }),
		supabase.from('quarters').select('id, name, year, quarter, starts_on').order('starts_on', { ascending: false }),
	]);
	return {
		cycles: (cycleRows ?? []) as Cycle[],
		quarters: (quarterRows ?? []) as Quarter[],
		error: error ? error.message : null,
	};
}

/**
 * Score rows for a cycle (optionally one subject). Falls back to the 0085
 * column set when 0118 is not applied yet, filling the new fields with
 * nulls and `model = 'ninebox'`, so every page still renders.
 */
export async function loadScores(
	supabase: SupabaseClient,
	filter: { cycleId?: string; cycleIds?: string[]; subjectId?: string; round?: Round },
): Promise<{ scores: ScoreRow[]; scorecardAvailable: boolean; error: string | null }> {
	const run = (cols: string) => {
		let q = supabase.from('calibration_scores').select(cols);
		if (filter.cycleId) q = q.eq('cycle_id', filter.cycleId);
		if (filter.cycleIds) q = q.in('cycle_id', filter.cycleIds);
		if (filter.subjectId) q = q.eq('subject_id', filter.subjectId);
		if (filter.round) q = q.eq('round', filter.round);
		return q;
	};
	const first = await run(SCORE_COLUMNS);
	if (!first.error) return { scores: (first.data ?? []) as unknown as ScoreRow[], scorecardAvailable: true, error: null };
	if (!isMissingColumn(first.error)) return { scores: [], scorecardAvailable: true, error: first.error.message };
	const second = await run(SCORE_COLUMNS_LEGACY);
	if (second.error) return { scores: [], scorecardAvailable: false, error: second.error.message };
	const legacy = (second.data ?? []) as unknown as Omit<ScoreRow, 'model' | 'total' | 'core_total' | 'performance_total' | 'professional_total' | 'priorities_md' | 'outcome' | 'import_payload'>[];
	return {
		scores: legacy.map((s) => ({
			...s,
			model: 'ninebox' as const,
			total: null,
			core_total: null,
			performance_total: null,
			professional_total: null,
			priorities_md: null,
			outcome: null,
			import_payload: null,
		})),
		scorecardAvailable: false,
		error: null,
	};
}

/** The cycle's question snapshot, in form order. `weight` only when `withWeights` (admin / service role). */
export async function loadCycleQuestions(
	supabase: SupabaseClient,
	cycleId: string,
	opts: { withWeights?: boolean } = {},
): Promise<{ questions: CycleQuestion[]; error: string | null }> {
	const base = 'id, cycle_id, key, group_key, label, prompt, position, rubric';
	const { data, error } = await supabase
		.from('calibration_cycle_questions')
		.select(opts.withWeights ? `${base}, weight` : base)
		.eq('cycle_id', cycleId)
		.order('position');
	if (error) return { questions: [], error: isMissingColumn(error) ? null : error.message };
	return {
		questions: ((data ?? []) as unknown as (Omit<CycleQuestion, 'rubric' | 'weight'> & { rubric: unknown; weight?: number | string | null })[]).map((q) => ({
			...q,
			rubric: Array.isArray(q.rubric) ? (q.rubric as unknown[]).map(String) : [],
			weight: q.weight == null ? undefined : Number(q.weight),
		})),
		error: null,
	};
}

/** Answers for a set of score rows. */
export async function loadAnswers(supabase: SupabaseClient, scoreIds: string[]): Promise<AnswerRow[]> {
	if (scoreIds.length === 0) return [];
	const { data, error } = await supabase
		.from('calibration_answers')
		.select('id, score_id, cycle_question_id, rating, notes')
		.in('score_id', scoreIds);
	if (error) return [];
	return (data ?? []) as AnswerRow[];
}

/** The exec reconcilers (Alex + Toni today), editable at /admin/calibration. */
export async function loadExecIds(supabase: SupabaseClient): Promise<Set<string>> {
	const { data } = await supabase
		.from('reviewer_groups')
		.select('id, reviewer_group_members(user_id)')
		.eq('key', 'exec_reconcilers')
		.maybeSingle();
	return new Set(((data?.reviewer_group_members as { user_id: string }[] | null) ?? []).map((m) => m.user_id));
}

/** Group scores by subject. */
export function groupBySubject(scores: ScoreRow[]): Map<string, ScoreRow[]> {
	const m = new Map<string, ScoreRow[]>();
	for (const s of scores) {
		const l = m.get(s.subject_id) ?? [];
		l.push(s);
		m.set(s.subject_id, l);
	}
	return m;
}

// ----- planning notes (calibration_notes, 0119) ----------------------------------

export interface CalibrationNote {
	id: string;
	key: string;
	body_md: string;
	updated_by: string | null;
	updated_at: string;
	updated_by_name: string | null;
}

/**
 * The admin scratchpad shown on Admin -> Calibration. `available: false` when
 * 0119 is not applied yet, so the page can say so instead of erroring.
 */
export async function loadCalibrationNote(supabase: SupabaseClient, key = 'next_quarter'): Promise<{ note: CalibrationNote | null; available: boolean }> {
	const { data, error } = await supabase
		.from('calibration_notes')
		.select('id, key, body_md, updated_by, updated_at, editor:profiles!calibration_notes_updated_by_fkey(first_name, last_name)')
		.eq('key', key)
		.maybeSingle();
	if (error) return { note: null, available: !isMissingColumn(error) };
	if (!data) return { note: null, available: true };
	const e = data.editor as unknown as { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
	const editor = Array.isArray(e) ? e[0] : e;
	const name = editor ? [editor.first_name, editor.last_name].filter(Boolean).join(' ') : '';
	return {
		note: { id: data.id, key: data.key, body_md: data.body_md, updated_by: data.updated_by, updated_at: data.updated_at, updated_by_name: name || null },
		available: true,
	};
}
