import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION, fourRComplete, parseFourRText, payTarget, positionRequestSummary, renderPosting, slugify, templateSlugFromDocName, type PayLevelRow } from './shared';

const LEVELS: PayLevelRow[] = [
	{ slug: 'assistant', label: 'Assistant', sort: 10, steps: 3, base_pct: 85, review_weeks: 13, position_track: null, is_active: true, notes: null },
	{ slug: 'analyst', label: 'Analyst', sort: 20, steps: 3, base_pct: 85, review_weeks: 13, position_track: null, is_active: true, notes: null },
	{ slug: 'specialist', label: 'Specialist', sort: 30, steps: 3, base_pct: 85, review_weeks: 13, position_track: null, is_active: true, notes: null },
];

describe('payTarget (V2 Pay System ladder)', () => {
	it('reproduces the multiplier-7 column of tab 1', () => {
		const got = [
			payTarget(7, 'assistant', 1, LEVELS),
			payTarget(7, 'assistant', 2, LEVELS),
			payTarget(7, 'assistant', 3, LEVELS),
			payTarget(7, 'analyst', 1, LEVELS),
			payTarget(7, 'analyst', 2, LEVELS),
			payTarget(7, 'analyst', 3, LEVELS),
			payTarget(7, 'specialist', 1, LEVELS),
		].map((f) => f!.monthly_target_cents / 100);
		expect(got).toEqual([735, 764, 795, 827, 860, 894, 930]);
	});
	it('reproduces the 600-start international scale', () => {
		expect(payTarget(6, 'assistant', 1, LEVELS)!.monthly_target_cents).toBe(63000);
		expect(payTarget(6, 'assistant', 2, LEVELS)!.monthly_target_cents).toBe(65500);
		expect(payTarget(6, 'analyst', 1, LEVELS)!.monthly_target_cents).toBe(70900);
	});
	it('splits base/performance and sums back', () => {
		const f = payTarget(7, 'assistant', 1, LEVELS)!;
		expect(f.monthly_base_cents + f.monthly_performance_cents).toBe(f.monthly_target_cents);
		expect(f.monthly_base_cents).toBe(62500);
		expect(f.annual_target_cents).toBe(f.monthly_target_cents * 12);
	});
	it('rejects unknown levels and out-of-range steps', () => {
		expect(payTarget(7, 'nope', 1, LEVELS)).toBeNull();
		expect(payTarget(7, 'assistant', 4, LEVELS)).toBeNull();
		expect(payTarget(0, 'assistant', 1, LEVELS, DEFAULT_PROGRESSION)).toBeNull();
	});
});

describe('parseFourRText', () => {
	const DOC = `Job Description\r\nRole, Responsibilities, Results, Requirements\r\n________________________________________\r\n\r\nPosition:         Account Executive\r\nReports to:         Dana Okafor\r\nAbout Us\r\nOpen Ronin (Open Ronin) is a HQ-based public relations company.\r\nRole\r\nThe Account Executive is responsible for managing the success of client PR campaigns.\r\nResponsibilities\r\n* Review all subscriber surveys\r\n* Serve as the primary point of contact\r\nResults\r\n* Meet or exceed the expected number of monthly interviews\r\nRequirements\r\n* 40 hours plus per week\r\n• Excellent written and verbal communication skills\r\nRemuneration & Rewards\r\n* Compensation based on region\r\n`;
	it('splits the Open Ronin layout into the four sections and drops About Us + Remuneration', () => {
		const t = parseFourRText(DOC);
		expect(t.position_label).toBe('Account Executive');
		expect(t.reports_to).toBe('Dana Okafor');
		expect(t.role_md).toBe('The Account Executive is responsible for managing the success of client PR campaigns.');
		expect(t.responsibilities_md).toBe('- Review all subscriber surveys\n- Serve as the primary point of contact');
		expect(t.results_md).toBe('- Meet or exceed the expected number of monthly interviews');
		expect(t.requirements_md).toBe('- 40 hours plus per week\n- Excellent written and verbal communication skills');
		expect(t.requirements_md).not.toContain('Compensation');
		expect(fourRComplete(t)).toBe(true);
	});
	it('accepts markdown headings and numbered section titles', () => {
		const t = parseFourRText('## Role\nR\n## 2. Responsibilities\n- a\n### Results:\n- b\n# Requirements\n1. c');
		expect(t.role_md).toBe('R');
		expect(t.responsibilities_md).toBe('- a');
		expect(t.results_md).toBe('- b');
		expect(t.requirements_md).toBe('- c');
	});
	it('reports an incomplete doc', () => {
		expect(fourRComplete(parseFourRText('Role\nonly a role'))).toBe(false);
	});
});

describe('slugs', () => {
	it('slugifies titles', () => {
		expect(slugify('Senior Publicist (US)')).toBe('senior-publicist-us');
		expect(slugify('  --Weird-- ')).toBe('weird');
		expect(slugify('***')).toBe('role-');
	});
	it('derives template slugs from Drive doc names', () => {
		expect(templateSlugFromDocName('4R - Media Specialist.docx')).toBe('media-specialist');
		expect(templateSlugFromDocName('4R - Tech Lead (For Review and Approval)')).toBe('tech-lead');
		expect(templateSlugFromDocName('4r QA')).toBe('qa');
	});
});

describe('renderPosting', () => {
	it('follows the LinkedIn order: compensation, about us, role, responsibilities, results, requirements, remuneration', () => {
		const md = renderPosting(
			{ title: 'Publicist', compensation_statement: 'Small base, majority commission.', about_us_override_md: null, role_md: 'R', responsibilities_md: '- a', results_md: '- b', requirements_md: '- c' },
			{ brand: 'main', label: 'Main', about_us_md: 'About.', remuneration_md: '- perks', careers_intro_md: '', website: null },
		);
		const order = ['# Publicist', '**Compensation:**', '## About Us', '## Role', '## Responsibilities', '## Results', '## Requirements', '## Remuneration'];
		const idx = order.map((h) => md.indexOf(h));
		expect(idx.every((i) => i >= 0)).toBe(true);
		expect([...idx].sort((a, b) => a - b)).toEqual(idx);
	});
	it('prefers the position override over the brand About Us', () => {
		const md = renderPosting({ title: 'X', compensation_statement: null, about_us_override_md: 'Override.', role_md: 'R', responsibilities_md: '', results_md: '', requirements_md: '' }, { brand: 'main', label: 'Main', about_us_md: 'Brand.', remuneration_md: '', careers_intro_md: '', website: null });
		expect(md).toContain('Override.');
		expect(md).not.toContain('Brand.');
		expect(md).not.toContain('**Compensation:**');
	});
});

describe('positionRequestSummary', () => {
	it('shows the pay figure when level + multiplier are set', () => {
		const s = positionRequestSummary({ role_title: 'Publicist', brand: 'main', employment_type: 'full_time', headcount: 2, pay_level: 'specialist', pay_multiplier: '7', posting_budget_usd: '250' }, LEVELS);
		expect(s).toContain('2× Publicist');
		expect(s).toContain('$930/mo');
		expect(s).toContain('$11,160/yr');
		expect(s).toContain('posting $250');
	});
});
