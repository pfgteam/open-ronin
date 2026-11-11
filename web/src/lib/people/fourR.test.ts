import { describe, expect, it } from 'vitest';
import {
	isInLeadershipChain,
	normaliseListMarkdown,
	pickFourRTemplate,
	sectionDelta,
	type FourRTemplate,
} from './fourR';

const T = (slug: string, keywords: string[], sort = 100): FourRTemplate => ({
	slug,
	position_label: slug,
	department: null,
	reports_to: null,
	role_md: '',
	responsibilities_md: '',
	results_md: '',
	requirements_md: '',
	match_keywords: keywords,
	source_url: null,
	sort,
});

// The keyword sets here are the ones seeded by 0093 for the positions that
// exist on live profiles (job_role / pap_position measured 2026-09-18).
const TEMPLATES: FourRTemplate[] = [
	T('media-specialist', ['media specialist', 'media', 'media coordinator'], 10),
	T('publicist', ['publicist', 'junior publicist', 'senior publicist', 'pr manager'], 20),
	T('content-writer', ['writer', 'copywriter', 'content writer', 'writing', 'lead content', 'content'], 40),
	T('graphic-designer', ['designer', 'graphic designer', 'design', 'ux'], 50),
	T('social-media-account-manager', ['social media account manager', 'sm am', 'social media manager', 'social media'], 70),
	T('lead-generation-specialist', ['lead gen', 'lead generation', 'lead gen specialist', 'revenue coordinator', 'leadgen'], 80),
	T('marketing-manager', ['marketing manager', 'marketing'], 90),
	T('marketing-technology-specialist', ['marketing technology', 'martech', 'automation', 'ai program manager'], 95),
	T('customer-success', ['customer success', 'client success', 'account manager'], 100),
	T('operations-assistant', ['operations assistant', 'operations', 'ops', 'people operations', 'operations manager', 'ops manager'], 130),
	T('executive-assistant', ['executive assistant', 'assistant to the president', 'chief of staff'], 120),
	T('numbers-analyst', ['numbers analyst', 'data analyst', 'reporting'], 160),
	T('software-developer', ['developer', 'frontend dev', 'frontend developer', 'engineer', 'devops', 'tech lead', 'software'], 170),
	T('generic-assistant', ['assistant'], 900),
	T('generic-analyst', ['analyst'], 910),
	T('generic-specialist', ['specialist'], 920),
	T('generic-coordinator', ['coordinator', 'lead'], 930),
	T('generic-manager', ['manager', 'director', 'head of', 'founder', 'president'], 940),
];

const pick = (input: Parameters<typeof pickFourRTemplate>[0]) => pickFourRTemplate(input, TEMPLATES)?.slug ?? null;

describe('pickFourRTemplate', () => {
	it('matches the live job_role vocabulary to the right position', () => {
		expect(pick({ job_role: 'Media Specialist', pap_position: 'Media' })).toBe('media-specialist');
		expect(pick({ job_role: 'Publicist', pap_position: 'Publicist' })).toBe('publicist');
		expect(pick({ job_role: 'Junior Publicist', pap_position: 'Publicist' })).toBe('publicist');
		expect(pick({ job_role: 'Copywriter', pap_position: 'Writing' })).toBe('content-writer');
		expect(pick({ job_role: 'Writer', pap_position: 'Writing' })).toBe('content-writer');
		expect(pick({ job_role: 'Designer', pap_position: 'Design' })).toBe('graphic-designer');
		expect(pick({ job_role: 'Lead Gen Specialist', pap_position: 'Lead Gen' })).toBe('lead-generation-specialist');
		expect(pick({ job_role: 'Lead Generation Assistant', pap_position: 'Lead Gen' })).toBe('lead-generation-specialist');
		expect(pick({ job_role: 'Customer Success' })).toBe('customer-success');
		expect(pick({ job_role: 'Executive Assistant' })).toBe('executive-assistant');
		expect(pick({ job_role: 'Numbers Analyst', pap_position: 'Analyst' })).toBe('numbers-analyst');
		expect(pick({ job_role: 'Frontend Developer', pap_position: 'Dev' })).toBe('software-developer');
		expect(pick({ job_role: 'DevOps Engineer', pap_position: 'Tech Lead' })).toBe('software-developer');
	});

	it('prefers the longer, more specific keyword over a short generic one', () => {
		// "manager" (generic) is inside "social media account manager"; the
		// specific template must win.
		expect(pick({ job_role: 'Social Media Account Manager', pap_position: 'SM AM' })).toBe('social-media-account-manager');
		expect(pick({ job_role: 'Social Media Account manager' })).toBe('social-media-account-manager');
		// "AI Program Manager" is martech, not a generic manager.
		expect(pick({ job_role: 'AI Program Manager', pap_position: 'Ops', position_track: 'Coordinator' })).toBe('marketing-technology-specialist');
		expect(pick({ job_role: 'Operations Manager', pap_position: 'Ops Manager' })).toBe('operations-assistant');
	});

	it('falls back to the specialty when job_role is empty', () => {
		expect(pick({ job_role: null, pap_position: 'Publicist' })).toBe('publicist');
		expect(pick({ job_role: null, pap_position: 'Media' })).toBe('media-specialist');
		expect(pick({ job_role: null, pap_position: 'Marketing' })).toBe('marketing-manager');
		expect(pick({ job_role: null, pap_position: 'DevOps' })).toBe('software-developer');
	});

	it('falls back to the PAP track when nothing else matches', () => {
		expect(pick({ job_role: null, pap_position: null, position_track: 'Coordinator' })).toBe('generic-coordinator');
		expect(pick({ job_role: 'Something New', position_track: 'Specialist' })).toBe('generic-specialist');
	});

	it('returns null when there is nothing to go on', () => {
		expect(pick({})).toBeNull();
		expect(pick({ job_role: null, pap_position: null, position_track: null, title: null })).toBeNull();
	});
});

describe('isInLeadershipChain', () => {
	// alex ← jamie ← lauren ← georgina ← publicist
	const managerOf = new Map<string, string | null>([
		['publicist', 'georgina'],
		['georgina', 'lauren'],
		['lauren', 'jamie'],
		['jamie', 'alex'],
		['alex', null],
	]);

	it('finds the direct manager and everyone above', () => {
		expect(isInLeadershipChain('georgina', 'publicist', managerOf)).toBe(true);
		expect(isInLeadershipChain('lauren', 'publicist', managerOf)).toBe(true);
		expect(isInLeadershipChain('alex', 'publicist', managerOf)).toBe(true);
	});

	it('rejects peers, reports, self and strangers', () => {
		expect(isInLeadershipChain('publicist', 'georgina', managerOf)).toBe(false);
		expect(isInLeadershipChain('publicist', 'publicist', managerOf)).toBe(false);
		expect(isInLeadershipChain('nobody', 'publicist', managerOf)).toBe(false);
		expect(isInLeadershipChain(null, 'publicist', managerOf)).toBe(false);
	});

	it('survives a cycle in manager_id', () => {
		const loop = new Map<string, string | null>([['a', 'b'], ['b', 'a']]);
		expect(isInLeadershipChain('zed', 'a', loop)).toBe(false);
	});
});

describe('normaliseListMarkdown', () => {
	it('bullets bare lines and keeps existing bullets, numbers and group headings', () => {
		expect(normaliseListMarkdown('one\n- two\n• three\n3. four\n**Group**\nfive\n\n\nsix\n\n'))
			.toBe('- one\n- two\n- three\n3. four\n**Group**\n- five\n\n- six');
	});
	it('handles Windows line endings', () => {
		expect(normaliseListMarkdown('a\r\nb')).toBe('- a\n- b');
	});
});

describe('sectionDelta', () => {
	it('reports added and removed lines, ignoring whitespace', () => {
		const d = sectionDelta('- a\n- b\n', '- b \n- c');
		expect(d.added).toEqual(['- c']);
		expect(d.removed).toEqual(['- a']);
	});
});
