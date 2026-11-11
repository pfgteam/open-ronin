import { describe, expect, it } from 'vitest';
import {
	INDUSTRY,
	SENIORITY,
	FUNCTION_AREA,
	COMPANY_HEADCOUNT,
	YEARS_EXPERIENCE,
	LINKEDIN_MAX_PER_QUERY,
	PROFILES_PER_SEARCH_PAGE,
	buildLinkedinInput,
	estimateCostUsd,
	hasTargeting,
} from './linkedinPreset';
import { linkedinDedupKey, normalizeLinkedinProfile, normalizeLinkedinPage } from './normalizeLinkedin';

// Trimmed from the actor's own README example (build 0.0.265, 2026-09-09) —
// the nested shapes are the point, so they are kept verbatim.
const PROFILE = {
	id: 'ACoAACLevxsBfWQoDUYkHyCP2jzl81cDAvckQEI',
	publicIdentifier: 'taylor-reed',
	linkedinUrl: 'https://www.linkedin.com/in/taylor-reed',
	firstName: 'Taylor',
	lastName: 'Reed, PharmD',
	headline: 'Pharmacology | Medical Science Liason',
	location: {
		linkedinText: 'Los Angeles, California, United States',
		parsed: { text: 'Los Angeles, CA, United States', country: 'United States', state: 'California', city: 'Los Angeles' },
	},
	currentPosition: [{ companyName: 'CVS Health', companyLinkedinUrl: 'https://www.linkedin.com/company/4680/' }],
	experience: [{ position: 'Staff Pharmacist', companyName: 'CVS Health' }],
};

describe('linkedinDedupKey', () => {
	it('prefers the stable public slug', () => {
		expect(
			linkedinDedupKey({ publicIdentifier: 'Taylor-Reed', linkedinUrl: null, memberId: 'x' }),
		).toBe('li:taylor-reed');
	});
	it('derives the slug from a URL, ignoring /in/, query and trailing slash', () => {
		const a = linkedinDedupKey({
			publicIdentifier: null,
			linkedinUrl: 'https://www.linkedin.com/in/jane-doe/',
			memberId: null,
		});
		const b = linkedinDedupKey({
			publicIdentifier: null,
			linkedinUrl: 'https://linkedin.com/in/jane-doe?utm_source=x',
			memberId: null,
		});
		expect(a).toBe('li:jane-doe');
		// The same profile reached two ways must collapse to one row.
		expect(b).toBe(a);
	});
	it('falls back to the opaque member id', () => {
		expect(linkedinDedupKey({ publicIdentifier: null, linkedinUrl: null, memberId: 'ACoAAB' })).toBe(
			'li-id:ACoAAB',
		);
	});
	it('returns null when there is no identity at all', () => {
		expect(linkedinDedupKey({ publicIdentifier: null, linkedinUrl: null, memberId: null })).toBeNull();
	});
	it('keeps a profile that has NO email and NO company — the case the shared key drops', () => {
		const lead = normalizeLinkedinProfile({
			publicIdentifier: 'solo-founder',
			firstName: 'Sam',
		});
		expect(lead).not.toBeNull();
		expect(lead?.dedupKey).toBe('li:solo-founder');
		expect(lead?.email).toBeNull();
		expect(lead?.companyName).toBeNull();
	});
});

describe('normalizeLinkedinProfile', () => {
	it('reads the nested location, position and name shapes', () => {
		const lead = normalizeLinkedinProfile(PROFILE)!;
		expect(lead.fullName).toBe('Taylor Reed, PharmD');
		expect(lead.companyName).toBe('CVS Health');
		expect(lead.jobTitle).toBe('Staff Pharmacist');
		expect(lead.headline).toBe('Pharmacology | Medical Science Liason');
		expect(lead.location).toBe('Los Angeles, CA, United States');
		expect(lead.companyCity).toBe('Los Angeles');
		expect(lead.companyState).toBe('California');
		expect(lead.companyCountry).toBe('United States');
		expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/taylor-reed');
	});

	it('leaves email null outside email-search mode, and reads it when present', () => {
		expect(normalizeLinkedinProfile(PROFILE)!.email).toBeNull();
		const withEmail = normalizeLinkedinProfile({ ...PROFILE, email: 'T.Reed@Example.com ' })!;
		expect(withEmail.email).toBe('t.reed@example.com');
	});

	it('builds the profile URL from the slug when the actor omits it', () => {
		const lead = normalizeLinkedinProfile({ publicIdentifier: 'jane-doe', firstName: 'Jane' })!;
		expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/jane-doe');
	});

	it('does not invent seniority or function — LinkedIn never returns them', () => {
		const lead = normalizeLinkedinProfile(PROFILE)!;
		expect(lead.seniority).toBeNull();
		expect(lead.functionArea).toBeNull();
	});
});

describe('normalizeLinkedinPage', () => {
	it('collapses in-page duplicates and counts what it skipped', () => {
		const { leads, skipped } = normalizeLinkedinPage([
			PROFILE,
			{ ...PROFILE, linkedinUrl: 'https://www.linkedin.com/in/taylor-reed/' },
			{ firstName: 'Nobody' }, // no identity
		]);
		expect(leads).toHaveLength(1);
		expect(skipped).toBe(2);
	});
});

describe('buildLinkedinInput', () => {
	it('omits empty filters and always bounds the run', () => {
		const input = buildLinkedinInput({ searchQuery: ' Founder ', seniority: [] }, 50);
		expect(input.searchQuery).toBe('Founder');
		expect(input).not.toHaveProperty('seniorityLevelIds');
		expect(input.maxItems).toBe(50);
		// takePages is what stops the actor walking $0.10 pages on a narrow query.
		expect(input.takePages).toBe(2);
		expect(input.profileScraperMode).toBe('Full');
	});

	it('passes the chosen mode through', () => {
		expect(buildLinkedinInput({ mode: 'Full + email search' }, 25).profileScraperMode).toBe(
			'Full + email search',
		);
	});

	it("clamps to LinkedIn's own 2500-per-query ceiling", () => {
		const input = buildLinkedinInput({ searchQuery: 'Founder' }, 9000);
		expect(input.maxItems).toBe(LINKEDIN_MAX_PER_QUERY);
		expect(input.takePages).toBe(LINKEDIN_MAX_PER_QUERY / PROFILES_PER_SEARCH_PAGE);
	});

	it('maps every filter to the actor key it validates against', () => {
		const input = buildLinkedinInput(
			{
				seniority: ['320'],
				functionArea: ['15'],
				industry: ['34'],
				headcount: ['C'],
				yearsExperience: ['4'],
				locations: ['United Kingdom'],
				currentJobTitles: ['Founder'],
				currentCompanies: ['acme'],
				schools: ['stanford-university'],
			},
			25,
		);
		expect(input.seniorityLevelIds).toEqual(['320']);
		expect(input.functionIds).toEqual(['15']);
		expect(input.industryIds).toEqual(['34']);
		expect(input.companyHeadcount).toEqual(['C']);
		expect(input.yearsOfExperienceIds).toEqual(['4']);
		expect(input.locations).toEqual(['United Kingdom']);
		expect(input.currentJobTitles).toEqual(['Founder']);
		expect(input.currentCompanies).toEqual(['acme']);
		expect(input.schools).toEqual(['stanford-university']);
	});
});

describe('estimateCostUsd', () => {
	it('bills whole search pages plus per-profile', () => {
		// 25 profiles = 1 page ($0.10) + 25 × $0.004 = $0.20
		expect(estimateCostUsd(25, 'Full')).toBeCloseTo(0.2, 2);
		// Email search is 2.5× the per-profile rate: $0.10 + 25 × $0.01 = $0.35
		expect(estimateCostUsd(25, 'Full + email search')).toBeCloseTo(0.35, 2);
	});
	it('rounds a partial page UP, because Apify bills the whole page', () => {
		// 30 profiles spans two pages: 2 × $0.10 + 30 × $0.004 = $0.32
		expect(estimateCostUsd(30, 'Full')).toBeCloseTo(0.32, 2);
		// One profile still costs a full page.
		expect(estimateCostUsd(1, 'Full')).toBeCloseTo(0.104, 3);
	});
});

describe('hasTargeting', () => {
	it('refuses a run with no filter and no query', () => {
		expect(hasTargeting({})).toBe(false);
		expect(hasTargeting({ searchQuery: '   ' })).toBe(false);
		expect(hasTargeting({ seniority: [] })).toBe(false);
	});
	it('accepts a query alone, or a filter alone', () => {
		expect(hasTargeting({ searchQuery: 'Founder' })).toBe(true);
		expect(hasTargeting({ industry: ['34'] })).toBe(true);
	});
});

describe('the curated option lists', () => {
	it('carries LinkedIn ids as values and human labels for the form', () => {
		// The whole point of curating: an operator never types an id.
		for (const list of [INDUSTRY, SENIORITY, FUNCTION_AREA, COMPANY_HEADCOUNT, YEARS_EXPERIENCE]) {
			expect(list.length).toBeGreaterThan(0);
			for (const opt of list) {
				expect(opt.value).toMatch(/^[A-Z0-9]+$/i);
				expect(opt.label.length).toBeGreaterThan(1);
			}
		}
	});

	it('has no duplicate industry ids or labels', () => {
		expect(new Set(INDUSTRY.map((i) => i.value)).size).toBe(INDUSTRY.length);
		expect(new Set(INDUSTRY.map((i) => i.label)).size).toBe(INDUSTRY.length);
	});

	it('covers the agency\'s core verticals', () => {
		const labels = INDUSTRY.map((i) => i.label).join(' | ');
		for (const vertical of ['Food and Beverage', 'Wellness', 'Retail', 'Restaurants', 'Public Relations']) {
			expect(labels).toContain(vertical);
		}
	});
});
