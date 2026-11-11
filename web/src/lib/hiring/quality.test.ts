import { describe, expect, it } from 'vitest';
import { funnelCounts, groupHires, pct, successScore, type QualityFunnelRow, type QualityHireRow } from './quality';

const base: QualityHireRow = {
	profile_id: 'p1', full_name: 'A', email: 'a@x', job_role: 'Publicist', department_tag_id: 'd1', manager_id: 'm1', date_started: '2026-01-10', is_active: true, employment_status: 'Active', exited_on: null, days_employed: 200,
	retained_30: true, retained_60: true, retained_90: true, retained_180: true, advancements: 1, level_now: 2, calibration_latest: 80, calibration_avg: 78, calibration_outcome: null, calibration_cycles: 2, contributions: 4, contributions_open: 1,
	offer_id: 'o1', application_id: 'a1', position_id: 'pos1', position_title: 'Publicist', source: 'board', link_code: 'x', board_key: 'indeed', referrer_user_id: null, recruiter_id: 'r1', hiring_manager_id: 'm1', submitted_at: '2025-12-01', hired_at: '2025-12-20', time_to_hire_days: 19, interviewer_ids: ['i1', 'i2'], scorecard_avg: 3.4, overall_score: 82, onboarding_status: 'complete', onboarding_done: 16, onboarding_total: 16,
};

describe('successScore', () => {
	it('weights retention 40, advancements 20, calibration 25, contributions 15', () => {
		// 100*.4 + 50*.2 + 80*.25 + 40*.15 = 40 + 10 + 20 + 6 = 76
		expect(successScore(base)).toBe(76);
	});
	it('re-weights when retention / calibration are unknown', () => {
		const r = { ...base, retained_30: null, retained_60: null, retained_90: null, retained_180: null, calibration_latest: null };
		// advancements 50 (w20) + contributions 40 (w15) over 35 = (1000+600)/35 = 45.7 → 46
		expect(successScore(r)).toBe(46);
	});
	it('an exit before day 30 scores retention 0', () => {
		expect(successScore({ ...base, retained_30: false, retained_60: false, retained_90: false, retained_180: false, advancements: 0, calibration_latest: null, contributions: 0 })).toBe(0);
	});
});

describe('groupHires', () => {
	const rows: QualityHireRow[] = [
		base,
		{ ...base, profile_id: 'p2', board_key: 'linkedin', retained_180: null, retained_90: true, is_active: true, interviewer_ids: ['i1'], time_to_hire_days: 31, calibration_latest: null },
		{ ...base, profile_id: 'p3', board_key: null, source: null, offer_id: null, position_title: null, job_role: 'Designer', retained_180: false, retained_90: false, retained_60: true, is_active: false, interviewer_ids: null, time_to_hire_days: null, recruiter_id: null },
	];
	const names = new Map([['i1', 'Ivy'], ['i2', 'Ian'], ['r1', 'Rae']]);
	it('groups by source with legacy for no-offer rows and computes retention over known only', () => {
		const g = groupHires(rows, 'source', names);
		expect(g.map((x) => x.key)).toEqual(['indeed', 'legacy', 'linkedin']);
		const li = g.find((x) => x.key === 'linkedin')!;
		expect(li.retained_180).toEqual({ n: 0, of: 0 });
		expect(li.retained_90).toEqual({ n: 1, of: 1 });
		const legacy = g.find((x) => x.key === 'legacy')!;
		expect(legacy.retained_180).toEqual({ n: 0, of: 1 });
		expect(legacy.active).toBe(0);
	});
	it('interviewer grouping fans a hire out to every interviewer', () => {
		const g = groupHires(rows, 'interviewer', names);
		expect(g.find((x) => x.key === 'i1')!.hires).toBe(2);
		expect(g.find((x) => x.key === 'i1')!.label).toBe('Ivy');
		expect(g.find((x) => x.key === 'i2')!.hires).toBe(1);
		expect(g.find((x) => x.key === '—')!.hires).toBe(1);
	});
	it('recruiter uses names and averages time to hire over known values', () => {
		const g = groupHires(rows, 'recruiter', names);
		const rae = g.find((x) => x.key === 'r1')!;
		expect(rae.label).toBe('Rae');
		expect(rae.time_to_hire_avg).toBe(25);
		expect(rae.time_to_hire_n).toBe(2);
		expect(rae.calibration_n).toBe(1);
	});
});

describe('funnel', () => {
	it('derives entered-per-stage and conversion from status + stage entries', () => {
		const f: QualityFunnelRow = { position_id: 'x', title: 't', status: 'open', brand: 'main', department_label: null, hiring_manager_id: null, recruiter_id: null, opened_at: null, closed_at: null, headcount: 1, applications: 20, by_status: { rejected: 12, culture_fit: 3, job_fit: 2, hired: 1, new: 2 }, stage_entries: { screening: 10, culture_fit: 6, job_fit: 3, final: 2, offer: 1, hired: 1 }, interviews: 8, no_shows: 1, offers: 1, offers_declined: 0, hired: 1, median_time_to_hire_days: 21, avg_time_to_hire_days: 21, posting_cost_cents: 25000, cost_per_hire_cents: 25000, avg_overall_score: 60, avg_overall_hired: 82 };
		const c = funnelCounts(f);
		expect(c.map((x) => x.entered)).toEqual([20, 10, 6, 3, 2, 1, 1]);
		expect(c[1].conv).toBe('50%');
		expect(c[6].conv).toBe('100%');
		expect(pct(0, 0)).toBe('—');
	});
});
