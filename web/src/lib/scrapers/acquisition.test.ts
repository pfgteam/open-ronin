import { describe, expect, it } from 'vitest';
import {
	AGENCY_INDUSTRIES,
	SERVICES,
	TITLE_SET,
	buildAcquisitionInput,
	extractOwnerSignal,
	foundedYearOf,
	hasAcquisitionTargeting,
	normalizeAcquisition,
	normalizeAcquisitionPage,
	normalizeServices,
	sizeBucketsFor,
	tooYoung,
} from './acquisitionPreset';
import { COMPANY_SIZE, INDUSTRY } from './leadPreset';

describe('sizeBucketsFor', () => {
	it('maps the default 5-50 window onto the three buckets that overlap it', () => {
		expect(sizeBucketsFor(5, 50)).toEqual(['1-10', '11-20', '21-50']);
	});

	it('includes a bucket the window only partially covers', () => {
		expect(sizeBucketsFor(15, 60)).toEqual(['11-20', '21-50', '51-100']);
	});

	it('tolerates a reversed window', () => {
		expect(sizeBucketsFor(50, 5)).toEqual(sizeBucketsFor(5, 50));
	});

	it('only ever emits strings the actor accepts', () => {
		for (const b of sizeBucketsFor(1, 100000)) {
			expect(COMPANY_SIZE as readonly string[]).toContain(b);
		}
	});
});

describe('buildAcquisitionInput', () => {
	it('always pins fetch_count to the job ceiling', () => {
		expect(buildAcquisitionInput({}, 300).fetch_count).toBe(300);
	});

	it('always targets the agency industries, even with no services picked', () => {
		const input = buildAcquisitionInput({}, 10);
		for (const i of AGENCY_INDUSTRIES) expect(input.company_industry).toContain(i);
	});

	it('only sends industries the actor enumerates', () => {
		const input = buildAcquisitionInput({ services: [...SERVICES] }, 10);
		for (const i of input.company_industry as string[]) {
			// The curated INDUSTRY slice in leadPreset is a subset of the actor's
			// enum; the agency additions were read from the actor on 2026-09-10.
			expect(
				(INDUSTRY as readonly string[]).includes(i) ||
					['events services', 'design', 'graphic design', 'online media', 'media production'].includes(i),
				`${i} is not a known actor industry`,
			).toBe(true);
		}
	});

	it('defaults the title filter to the full owner title set', () => {
		expect(buildAcquisitionInput({}, 10).contact_job_title).toEqual([...TITLE_SET]);
	});

	it('sends keywords for the picked services and none otherwise', () => {
		expect(buildAcquisitionInput({}, 10).company_keywords).toBeUndefined();
		const kw = buildAcquisitionInput({ services: ['SEO'] }, 10).company_keywords as string[];
		expect(kw).toContain('seo');
	});

	it('translates the employee window into size buckets', () => {
		expect(buildAcquisitionInput({ employeeMin: 10, employeeMax: 100 }, 10).size).toEqual([
			'1-10', '11-20', '21-50', '51-100',
		]);
	});

	it('defaults to validated emails — an unverified address is a bounce we pay for', () => {
		expect(buildAcquisitionInput({}, 10).email_status).toEqual(['validated']);
	});
});

describe('hasAcquisitionTargeting', () => {
	it('requires a geography', () => {
		expect(hasAcquisitionTargeting({ services: ['PR'] })).toBe(false);
		expect(hasAcquisitionTargeting({ location: ['united states'] })).toBe(true);
		expect(hasAcquisitionTargeting({ city: ['HQ'] })).toBe(true);
	});
});

describe('normalizeServices', () => {
	it('emits the fixed vocabulary in vocabulary order, comma separated', () => {
		expect(
			normalizeServices('search engine optimization, content marketing, public relations'),
		).toBe('PR, SEO, content');
	});

	it('reads the industry as well as the keywords', () => {
		expect(normalizeServices(null, 'Public Relations & Communications', null)).toBe('PR');
	});

	it('returns null rather than a guess when nothing matches', () => {
		expect(normalizeServices('coffee roasting, retail')).toBeNull();
		expect(normalizeServices(null, null)).toBeNull();
	});

	it('does not read "pr" out of the middle of a word', () => {
		expect(normalizeServices('premium products, springs')).toBeNull();
	});
});

describe('extractOwnerSignal', () => {
	it('copies the sentence with the signal verbatim', () => {
		const desc =
			'We are a full-service PR firm in Alex. After 30 years, the founder is planning for retirement and succession. Our clients span CPG and health.';
		expect(extractOwnerSignal(desc)).toBe(
			'After 30 years, the founder is planning for retirement and succession.',
		);
	});

	it('never paraphrases — the output is a substring of the input, whitespace aside', () => {
		const desc = 'Boutique agency.\nWe are   looking for a buyer   who values our team.\nFounded 2009.';
		const out = extractOwnerSignal(desc)!;
		expect(out).toBe('We are looking for a buyer who values our team.');
		expect(desc.replace(/\s+/g, ' ')).toContain(out);
	});

	it('returns null when there is no succession or for-sale language', () => {
		expect(extractOwnerSignal('Award-winning creative agency serving CPG brands since 2004.')).toBeNull();
		expect(extractOwnerSignal(null, undefined, '')).toBeNull();
	});

	it('checks each text in order and takes the first hit', () => {
		expect(extractOwnerSignal('Nothing here.', 'Owner, retiring 2027')).toBe('Owner, retiring 2027');
	});

	it('does not match "retired" inside unrelated words', () => {
		expect(extractOwnerSignal('We sell tires and retread them.')).toBeNull();
	});
});

describe('years in business', () => {
	it('parses a year out of the shapes the actor sends', () => {
		expect(foundedYearOf('2011')).toBe(2011);
		expect(foundedYearOf('2011-03')).toBe(2011);
		expect(foundedYearOf('Founded 1998')).toBe(1998);
		expect(foundedYearOf('n/a')).toBeNull();
		expect(foundedYearOf(null)).toBeNull();
	});

	it('excludes a firm younger than the minimum and keeps unknowns', () => {
		const now = new Date('2026-09-10');
		expect(tooYoung('2024', 5, now)).toBe(true);
		expect(tooYoung('2019', 5, now)).toBe(false);
		expect(tooYoung(null, 5, now)).toBe(false);
		expect(tooYoung('2024', undefined, now)).toBe(false);
	});
});

const ITEM = {
	full_name: 'Jane Doe',
	email: 'jane@brightpr.com',
	job_title: 'Founder & CEO',
	headline: 'Founder at Bright PR',
	company_name: 'Bright PR',
	company_website: 'https://www.brightpr.com',
	company_domain: 'brightpr.com',
	industry: 'Public Relations & Communications',
	keywords: 'public relations, social media marketing, content strategy, b2b',
	company_description: 'Bright PR is a 12-person firm. The founder is stepping back in 2027.',
	company_size: 12,
	company_founded_year: '2008',
	company_annual_revenue_clean: '1.8M',
	company_city: 'HQ',
	company_state: 'Tennessee',
	company_country: 'United States',
};

describe('normalizeAcquisition', () => {
	it('keeps the lead mapping and adds the two 0060 columns', () => {
		const row = normalizeAcquisition(ITEM)!;
		expect(row.dedupKey).toBe('jane@brightpr.com');
		expect(row.companyName).toBe('Bright PR');
		expect(row.companyFoundedYear).toBe('2008');
		expect(row.agencyServices).toBe('PR, social, content');
		expect(row.ownerSignal).toBe('The founder is stepping back in 2027.');
	});

	it('drops items with no identity', () => {
		expect(normalizeAcquisition({ company_description: 'x' })).toBeNull();
	});
});

describe('normalizeAcquisitionPage', () => {
	it('dedups within the page and applies the years-in-business floor', () => {
		const now = new Date('2026-09-10');
		const young = { ...ITEM, email: 'new@newco.com', company_founded_year: '2025' };
		const unknownYear = { ...ITEM, email: 'x@unknown.com', company_founded_year: null };
		const { leads, skipped } = normalizeAcquisitionPage(
			[ITEM, ITEM, young, unknownYear],
			{ minYears: 5 },
			now,
		);
		expect(leads.map((l) => l.email)).toEqual(['jane@brightpr.com', 'x@unknown.com']);
		expect(skipped).toBe(2);
	});
});
