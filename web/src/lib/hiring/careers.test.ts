import { describe, expect, it } from 'vitest';
import { boardLinkCode, jobPostingJsonLd, jobsFeedXml, mdToHtmlLite, templatePostText, type BoardRow, type PublicPosition } from './careers';
import type { BrandProfile } from './shared';

const brand: BrandProfile = { brand: 'main', label: 'Open Ronin', about_us_md: 'Open Ronin is a HQ PR agency.\n\nSecond paragraph.', remuneration_md: '- perks', careers_intro_md: '', website: 'https://example.com' };
const pos: PublicPosition = {
	id: 'p1',
	slug: 'senior-publicist',
	title: 'Senior Publicist',
	brand: 'main',
	department_label: 'Delivery',
	employment_type: 'full_time',
	location_type: 'remote',
	location_text: null,
	timezone_note: 'CST hours',
	compensation_statement: 'Small base, majority commission.',
	show_pay_range: false,
	about_us_override_md: null,
	opened_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-02T00:00:00Z',
	position_label: 'Senior Publicist',
	department: 'Delivery',
	reports_to: 'PR Manager',
	role_md: 'Runs client accounts.',
	responsibilities_md: '- Pitch weekly\n- Report monthly\n- Run client calls',
	results_md: '- Press every week',
	requirements_md: '- 3 years PR\n- Writing <b>skills</b>',
};

describe('jobPostingJsonLd', () => {
	it('emits a schema.org JobPosting with TELECOMMUTE for remote and no salary by default', () => {
		const j = jobPostingJsonLd(pos, brand, 'https://app.example.com');
		expect(j['@type']).toBe('JobPosting');
		expect(j.employmentType).toBe('FULL_TIME');
		expect(j.jobLocationType).toBe('TELECOMMUTE');
		expect(j.datePosted).toBe('2026-10-01');
		expect(j.baseSalary).toBeUndefined();
		expect(j.url).toBe('https://app.example.com/careers/senior-publicist');
		expect(String(j.description)).toContain('<h3>Responsibilities</h3>');
		expect(String(j.description)).toContain('&lt;b&gt;');
	});
	it('adds baseSalary only when the role opts in with a range', () => {
		const j = jobPostingJsonLd({ ...pos, show_pay_range: true, pay_range_min_cents: 300000, pay_range_max_cents: 400000 }, brand, 'https://app.example.com');
		expect((j.baseSalary as { value: { minValue: number } }).value.minValue).toBe(3000);
		const k = jobPostingJsonLd({ ...pos, show_pay_range: false, pay_range_min_cents: 300000, pay_range_max_cents: 400000 }, brand, 'https://app.example.com');
		expect(k.baseSalary).toBeUndefined();
	});
	it('uses a Place for on-site roles', () => {
		const j = jobPostingJsonLd({ ...pos, location_type: 'onsite', location_text: 'HQ, TN' }, brand, 'https://app.example.com');
		expect(j.jobLocationType).toBeUndefined();
		expect((j.jobLocation as { '@type': string })['@type']).toBe('Place');
	});
});

describe('jobsFeedXml', () => {
	it('produces one <job> per role with CDATA-wrapped HTML and the tracked xml link', () => {
		const xml = jobsFeedXml([pos], [brand], 'https://app.example.com');
		expect(xml).toContain('<?xml version="1.0"');
		expect((xml.match(/<job>/g) ?? []).length).toBe(1);
		expect(xml).toContain('<![CDATA[Senior Publicist]]>');
		expect(xml).toContain('/careers/go/senior-publicist-xml');
		expect(xml).toContain('<ul><li>Pitch weekly</li>');
		expect(xml).toContain('<city><![CDATA[Remote]]></city>');
	});
});

describe('post kit text', () => {
	const board: BoardRow = { key: 'linkedin', label: 'LinkedIn', kind: 'manual', enabled: true, sort: 1, post_url: null, format_hint: null, max_chars: 3000, cost_note: null, default_days: 30, regions: [], config: {} };
	it('renders the LinkedIn order with the apply link last and respects max_chars', () => {
		const t = templatePostText(pos, brand, board, 'https://app.example.com/careers/go/senior-publicist-linkedin');
		expect(t.startsWith('Senior Publicist — Open Ronin (Remote)')).toBe(true);
		expect(t.indexOf('Compensation:')).toBeLessThan(t.indexOf('The role'));
		expect(t.indexOf('The role')).toBeLessThan(t.indexOf("What you'll do"));
		expect(t.trim().endsWith('Apply: https://app.example.com/careers/go/senior-publicist-linkedin')).toBe(true);
		expect(t).not.toContain('Second paragraph');
		const long = templatePostText({ ...pos, responsibilities_md: Array.from({ length: 200 }, (_, i) => `- Responsibility number ${i} with a fairly long sentence attached to it`).join('\n') }, brand, { ...board, max_chars: 800 }, 'https://x/go');
		expect(long.length).toBeLessThanOrEqual(800);
		expect(long.endsWith('Apply: https://x/go')).toBe(true);
	});
	it('derives a deterministic board code', () => {
		expect(boardLinkCode('senior-publicist', 'google_jobs')).toBe('senior-publicist-googlejobs');
	});
});

describe('mdToHtmlLite', () => {
	it('escapes html and renders bullets/headings', () => {
		expect(mdToHtmlLite('## A\n- x <y>\n\ntext **b**')).toBe('<h3>A</h3>\n<ul><li>x &lt;y&gt;</li></ul>\n<p>text <strong>b</strong></p>');
	});
});
