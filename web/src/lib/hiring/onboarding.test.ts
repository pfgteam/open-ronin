import { describe, expect, it } from 'vitest';
import { accruedDays, itemLight, onboardingDay, scoreDisc, styleToScores, type DiscAnswer } from './onboarding';

describe('DISC scoring (mirrors hire_disc_score)', () => {
	it('sums to 100 and names the style from most/least answers', () => {
		const answers: DiscAnswer[] = Array.from({ length: 24 }, (_, i) => ({ q: i + 1, most: i % 2 === 0 ? 'D' : 'S', least: 'C' }));
		const r = scoreDisc(answers);
		expect(r.n).toBe(24);
		expect(Math.round(r.scores.D + r.scores.I + r.scores.S + r.scores.C)).toBe(100);
		expect(r.scores.C).toBe(0);
		expect(r.scores.D).toBe(37.5);
		expect(r.scores.I).toBe(25);
		// D and S tie within 5 → both uppercase; I sits at exactly 25 → lowercase third
		expect(r.style.slice(0, 2)).toMatch(/^(DS|SD)$/);
		expect(r.style).toBe('DSi');
	});
	it('a single dominant trait gives a one-letter style', () => {
		const answers: DiscAnswer[] = Array.from({ length: 24 }, (_, i) => ({ q: i + 1, most: 'C', least: i % 3 === 0 ? 'D' : i % 3 === 1 ? 'I' : 'S' }));
		const r = scoreDisc(answers);
		expect(r.scores.C).toBe(50);
		expect(r.style).toBe('C');
	});
	it('empty answers are neutral', () => {
		expect(scoreDisc([])).toEqual({ scores: { D: 25, I: 25, S: 25, C: 25 }, style: '', n: 0 });
	});
	it('reads a hand-entered style into display percentages', () => {
		const s = styleToScores('Si');
		expect(s).not.toBeNull();
		expect(s!.S).toBeGreaterThan(s!.I);
		expect(s!.I).toBeGreaterThan(s!.D);
		expect(styleToScores('Networker')).toBeNull();
	});
});

describe('onboarding helpers', () => {
	it('counts day 1 as the start date', () => {
		expect(onboardingDay('2026-10-01', new Date('2026-10-01T15:00:00'))).toBe(1);
		expect(onboardingDay('2026-10-01', new Date('2026-11-30T09:00:00'))).toBe(61);
	});
	it('lights items green / yellow / red / grey', () => {
		expect(itemLight({ status: 'done', due_on: '2026-01-01', window_from: null }, '2026-06-01')).toBe('green');
		expect(itemLight({ status: 'todo', due_on: '2026-01-01', window_from: null }, '2026-06-01')).toBe('red');
		expect(itemLight({ status: 'todo', due_on: '2026-07-01', window_from: '2026-05-01' }, '2026-06-01')).toBe('yellow');
		expect(itemLight({ status: 'todo', due_on: '2026-07-01', window_from: null }, '2026-06-01')).toBe('grey');
		expect(itemLight({ status: 'blocked', due_on: '2026-07-01', window_from: null }, '2026-06-01')).toBe('red');
	});
});

describe('PTO accrual (mirrors attendance_summary)', () => {
	it('accrues 21 days over a full year and pro-rata from the start date', () => {
		expect(accruedDays(21, '2024-03-01', 2026, '2026-12-31')).toBe(21);
		// Aug 14 → Dec 31 = 140 days of 365
		expect(accruedDays(21, '2026-08-14', 2026, '2026-12-31')).toBe(Math.round((21 * 140 * 100) / 365) / 100);
		expect(accruedDays(21, '2026-08-14', 2026, '2026-08-01')).toBe(0);
	});
});
