import { describe, expect, it } from 'vitest';
import { evaluateScorecard, renderTemplate, scorecardStats, stagesFromTemplates, toSmsText, validateStages, type ScorecardRules } from './pipeline';

const RULES: ScorecardRules = {
	culture_fit: { advance_min_avg: 3.0, no_ones: true, twos_are_watchouts: true },
	job_fit: { advance_min_avg: 3.0, no_ones_in: ['jf_interest', 'jf_execution', 'jf_collaboration'], twos_flag_for_panel: true },
	final: { strong_hire_min_avg: 3.2, strong_hire_needs_four_in: ['fp_decision', 'fp_failed', 'fp_values'], no_hire_if_one_in: ['fp_decision', 'fp_failed'], no_ones: true },
	presentation: { red_flag_one_in: ['pr_pillars', 'pr_alignment'], strong_signal_fours_in: ['pr_authenticity', 'pr_examples', 'pr_alignment'] },
};

describe('scorecardStats', () => {
	it('averages, mins and buckets 1/2/4s; ignores empty', () => {
		const s = scorecardStats({ a: { score: 4 }, b: { score: 3 }, c: { score: 2 }, d: { score: null }, e: {} });
		expect(s).toEqual({ n: 3, avg: 3, min: 2, ones: [], twos: ['c'], fours: ['a'] });
	});
});

describe('evaluateScorecard (Hiring Process 2026 rules)', () => {
	it('culture fit: no 1s and avg >= 3 advances; 2s are watch-outs; a 1 is no hire', () => {
		expect(evaluateScorecard('culture_fit', { a: { score: 4 }, b: { score: 3 }, c: { score: 3 } }, RULES).verdict).toBe('advance');
		const w = evaluateScorecard('culture_fit', { a: { score: 4 }, b: { score: 3 }, c: { score: 2 } }, RULES);
		expect(w.verdict).toBe('conditional');
		expect(w.watchouts).toEqual(['c']);
		expect(evaluateScorecard('culture_fit', { a: { score: 1 }, b: { score: 4 }, c: { score: 4 } }, RULES).verdict).toBe('no_hire');
		expect(evaluateScorecard('culture_fit', { a: { score: 2 }, b: { score: 3 }, c: { score: 3 } }, RULES).verdict).toBe('no_hire'); // avg 2.67
	});
	it('job fit: a 1 on a critical question is no hire; a 1 elsewhere with a good average is conditional', () => {
		expect(evaluateScorecard('job_fit', { jf_execution: { score: 1 }, jf_beyond: { score: 4 }, jf_feedback: { score: 4 } }, RULES).verdict).toBe('no_hire');
		const r = evaluateScorecard('job_fit', { jf_execution: { score: 4 }, jf_beyond: { score: 4 }, jf_feedback: { score: 4 }, jf_mistake: { score: 1 } }, RULES);
		expect(r.verdict).toBe('advance'); // 1 on a non-critical question, avg 3.25 >= 3
	});
	it('final: strong hire needs avg >= 3.2, no 1s and a 4 on a core question; a 1 on Q1/Q2 is no hire', () => {
		expect(evaluateScorecard('final', { fp_decision: { score: 4 }, fp_failed: { score: 3 }, fp_values: { score: 3 }, fp_adapt: { score: 3 } }, RULES).verdict).toBe('strong_hire');
		expect(evaluateScorecard('final', { fp_decision: { score: 3 }, fp_failed: { score: 3 }, fp_values: { score: 3 }, fp_adapt: { score: 4 } }, RULES).verdict).toBe('advance'); // avg 3.25 but the 4 is not on a core question
		expect(evaluateScorecard('final', { fp_decision: { score: 1 }, fp_failed: { score: 4 }, fp_values: { score: 4 } }, RULES).verdict).toBe('no_hire');
	});
	it('presentation: a 1 on pillars/alignment is a red flag; two 4s on the signal categories is strong', () => {
		expect(evaluateScorecard('presentation', { pr_pillars: { score: 1 }, pr_authenticity: { score: 4 } }, RULES).verdict).toBe('no_hire');
		expect(evaluateScorecard('presentation', { pr_pillars: { score: 3 }, pr_authenticity: { score: 4 }, pr_examples: { score: 4 }, pr_communication: { score: 3 }, pr_alignment: { score: 3 } }, RULES).verdict).toBe('strong_hire');
	});
	it('incomplete when nothing is scored', () => {
		expect(evaluateScorecard('culture_fit', {}, RULES).verdict).toBe('incomplete');
	});
});

describe('stages', () => {
	it('builds the ladder from templates with no owners', () => {
		const cfg = stagesFromTemplates([
			{ key: 'bb', label: 'B', sort: 20, status_key: 'screening', interview_kind: null, default_minutes: null, description: null, is_terminal: false, is_active: true },
			{ key: 'aa', label: 'A', sort: 10, status_key: 'new', interview_kind: null, default_minutes: null, description: null, is_terminal: false, is_active: true },
			{ key: 'zz', label: 'Z', sort: 30, status_key: 'hired', interview_kind: null, default_minutes: null, description: null, is_terminal: true, is_active: false },
		]);
		expect(cfg.stages.map((s) => s.key)).toEqual(['aa', 'bb']);
		expect(cfg.stages[0].owner_id).toBeNull();
		expect(validateStages(cfg)).toBeNull();
	});
	it('rejects duplicate keys and unknown statuses', () => {
		expect(validateStages({ version: 1, stages: [{ key: 'aa', label: 'A', status_key: 'new', interview_kind: null, default_minutes: null, owner_id: null, interviewer_ids: [] }, { key: 'aa', label: 'A2', status_key: 'new', interview_kind: null, default_minutes: null, owner_id: null, interviewer_ids: [] }] })).toMatch(/duplicate/);
		expect(validateStages({ version: 1, stages: [{ key: 'aa', label: 'A', status_key: 'nope', interview_kind: null, default_minutes: null, owner_id: null, interviewer_ids: [] }] })).toMatch(/status invalid/);
	});
});

describe('templates', () => {
	it('renders placeholders and blanks unknown ones', () => {
		expect(renderTemplate('Hi {{first_name}}, {{position}} at {{brand}} {{nope}}!', { first_name: 'Ana', full_name: 'Ana B', position: 'Publicist', brand: 'Main', sender_name: 'JC', sender_title: 'Ops', signature: '—' })).toBe('Hi Ana, Publicist at Main !');
	});
	it('flattens markdown for SMS', () => {
		expect(toSmsText('**Hi** [book](https://x.y)\n\n\nSee you')).toBe('Hi book https://x.y\nSee you');
	});
});
