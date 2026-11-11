import { describe, expect, it } from 'vitest';
import {
	buildActorInput,
	estimateCostUsd,
	hasTargeting,
	USD_PER_LEAD,
	type LeadParams,
} from './leadPreset';
import {
	leadDedupKey,
	normalizeDomain,
	normalizeEmail,
	normalizeLead,
	normalizePage,
} from './normalizeLead';

describe('buildActorInput', () => {
	it('always pins fetch_count to the job ceiling', () => {
		// The actor defaults fetch_count to 100000. Leaving it unset on a paid
		// tier would bill for everything matching the query.
		const input = buildActorInput({}, 250);
		expect(input.fetch_count).toBe(250);
	});

	it('omits empty filters instead of sending empty arrays', () => {
		const input = buildActorInput({ seniority: [], industry: [] }, 100);
		expect('seniority_level' in input).toBe(false);
		expect('company_industry' in input).toBe(false);
	});

	it('maps our names onto the actor’s names', () => {
		const params: LeadParams = {
			seniority: ['founder', 'c_suite'],
			functionArea: ['marketing'],
			industry: ['health, wellness & fitness'],
			size: ['11-20'],
			location: ['united states'],
			city: ['HQ'],
			jobTitle: ['Head of Brand'],
			keywords: ['supplements'],
		};
		const input = buildActorInput(params, 500);
		expect(input.seniority_level).toEqual(['founder', 'c_suite']);
		expect(input.functional_level).toEqual(['marketing']);
		expect(input.company_industry).toEqual(['health, wellness & fitness']);
		expect(input.size).toEqual(['11-20']);
		expect(input.contact_location).toEqual(['united states']);
		expect(input.contact_city).toEqual(['HQ']);
		expect(input.contact_job_title).toEqual(['Head of Brand']);
		expect(input.company_keywords).toEqual(['supplements']);
	});

	it('defaults email_status to validated — an unverified email is a paid bounce', () => {
		expect(buildActorInput({}, 10).email_status).toEqual(['validated']);
	});

	it('honours an explicit email_status', () => {
		expect(buildActorInput({ emailStatus: ['unknown'] }, 10).email_status).toEqual(['unknown']);
	});

	it('passes revenue bounds only when set', () => {
		expect('min_revenue' in buildActorInput({}, 10)).toBe(false);
		expect(buildActorInput({ minRevenue: '1M', maxRevenue: '50M' }, 10)).toMatchObject({
			min_revenue: '1M',
			max_revenue: '50M',
		});
	});
});

describe('hasTargeting', () => {
	it('rejects a job with no filter at all', () => {
		expect(hasTargeting({})).toBe(false);
		expect(hasTargeting({ seniority: [], keywords: [] })).toBe(false);
		// email_status and revenue alone are not targeting — they would still
		// bill for an arbitrary slice of a 250M-row database.
		expect(hasTargeting({ emailStatus: ['validated'], minRevenue: '1M' })).toBe(false);
	});

	it('accepts any one real filter', () => {
		expect(hasTargeting({ keywords: ['gym'] })).toBe(true);
		expect(hasTargeting({ industry: ['retail'] })).toBe(true);
		expect(hasTargeting({ city: ['Alex'] })).toBe(true);
	});
});

describe('estimateCostUsd', () => {
	it('includes the run-start event plus per-lead billing', () => {
		expect(estimateCostUsd(1000)).toBe(Math.round((0.02 + 1000 * USD_PER_LEAD) * 100) / 100);
	});

	it('grows with the ceiling', () => {
		expect(estimateCostUsd(5000)).toBeGreaterThan(estimateCostUsd(500));
	});
});

describe('normalizeEmail', () => {
	it('lowercases and trims', () => {
		expect(normalizeEmail('  Ana@Acme.COM ')).toBe('ana@acme.com');
	});

	it('rejects things that are not emails', () => {
		for (const bad of ['', '   ', 'ana', 'ana@acme', 'ana at acme.com', 'a@b@c.com', null]) {
			expect(normalizeEmail(bad as string | null)).toBeNull();
		}
	});
});

describe('normalizeDomain', () => {
	it('strips scheme, www, path and trailing dots', () => {
		expect(normalizeDomain('https://www.Acme.com/about?x=1')).toBe('acme.com');
		expect(normalizeDomain('HTTP://acme.com.')).toBe('acme.com');
		expect(normalizeDomain('acme.com')).toBe('acme.com');
	});

	it('returns null for empty input', () => {
		expect(normalizeDomain(null)).toBeNull();
		expect(normalizeDomain('   ')).toBeNull();
	});
});

describe('leadDedupKey', () => {
	const base = { email: null, fullName: null, companyDomain: null, companyName: null };

	it('uses the email when there is one', () => {
		expect(leadDedupKey({ ...base, email: 'ana@acme.com', fullName: 'Ana' })).toBe('ana@acme.com');
	});

	it('falls back to name + domain without an email', () => {
		expect(leadDedupKey({ ...base, fullName: 'Ana  Silva', companyDomain: 'acme.com' })).toBe(
			'name:ana silva|acme.com',
		);
	});

	it('falls back to company name when there is no domain', () => {
		expect(leadDedupKey({ ...base, fullName: 'Ana Silva', companyName: 'Acme Inc' })).toBe(
			'name:ana silva|acme inc',
		);
	});

	it('returns null when there is no usable identity', () => {
		expect(leadDedupKey(base)).toBeNull();
		expect(leadDedupKey({ ...base, fullName: 'Ana' })).toBeNull();
		expect(leadDedupKey({ ...base, companyDomain: 'acme.com' })).toBeNull();
	});

	// The property the resumable import depends on: the same item must always
	// produce the same key, or a cursor retry double-imports.
	it('is deterministic for the same input', () => {
		const lead = { ...base, fullName: 'Ana Silva', companyDomain: 'acme.com' };
		expect(leadDedupKey(lead)).toBe(leadDedupKey(lead));
	});

	it('stays inside the column limit', () => {
		const key = leadDedupKey({ ...base, fullName: 'x'.repeat(500), companyName: 'y'.repeat(500) });
		expect(key!.length).toBeLessThanOrEqual(400);
	});
});

describe('normalizeLead', () => {
	it('reads the actor’s snake_case fields', () => {
		const lead = normalizeLead({
			first_name: 'Ana',
			last_name: 'Silva',
			email: 'Ana@Acme.com',
			mobile_number: '+1 555 0100',
			linkedin_url: 'https://linkedin.com/in/ana',
			job_title: 'Head of Brand',
			company_name: 'Acme Inc',
			company_website: 'https://www.acme.com/',
			company_industry: 'retail',
			company_size: '11-20',
			location: 'HQ, TN',
		})!;
		expect(lead.fullName).toBe('Ana Silva');
		expect(lead.email).toBe('ana@acme.com');
		expect(lead.companyDomain).toBe('acme.com');
		expect(lead.mobilePhone).toBe('+1 555 0100');
		expect(lead.dedupKey).toBe('ana@acme.com');
	});

	// The bug this batch of columns fixed: 0041 preferred mobile_number and
	// stopped, so a lead with only a company switchboard looked phoneless.
	// 23 of the first 52 real leads were in exactly that state.
	it('keeps mobile and company phone as separate fields', () => {
		const both = normalizeLead({
			email: 'a@b.com',
			mobile_number: '+1 555 0001',
			company_phone: '+1 555 0002',
		})!;
		expect(both.mobilePhone).toBe('+1 555 0001');
		expect(both.companyPhone).toBe('+1 555 0002');

		const onlyCompany = normalizeLead({ email: 'c@d.com', company_phone: '+1 555 0003' })!;
		expect(onlyCompany.mobilePhone).toBeNull();
		expect(onlyCompany.companyPhone).toBe('+1 555 0003');
	});

	it('carries the personalisation fields the first mapping discarded', () => {
		const lead = normalizeLead({
			email: 'a@b.com',
			headline: '🚀 VP of Engineering at Acme',
			functional_level: 'c_suite',
			company_annual_revenue_clean: '1.1M',
			company_annual_revenue: '1100000',
			company_description: 'Makes widgets.',
			company_founded_year: '1964',
			company_website: 'https://www.acme.com/',
			company_linkedin: 'https://www.linkedin.com/company/acme',
			company_city: 'Atlanta',
			company_state: 'Georgia',
			company_country: 'United States',
			company_full_address: '1006 Washington St, Calistoga, California 94515, US',
		})!;
		expect(lead.headline).toContain('VP of Engineering');
		expect(lead.functionArea).toBe('c_suite');
		// Readable form wins over the raw integer; both stay in `raw`.
		expect(lead.companyRevenue).toBe('1.1M');
		expect(lead.companyWebsite).toBe('https://www.acme.com/');
		expect(lead.companyDomain).toBe('acme.com');
		expect(lead.companyLinkedin).toContain('/company/acme');
		expect(lead.companyCity).toBe('Atlanta');
		expect(lead.companyState).toBe('Georgia');
		expect(lead.companyAddress).toContain('Calistoga');
		expect(lead.companyFoundedYear).toBe('1964');
	});

	it('normalises list-ish fields to one comma string either way', () => {
		// Actors send these as an array or as a comma string depending on version.
		const asArray = normalizeLead({ email: 'a@b.com', keywords: ['health', 'equity'] })!;
		expect(asArray.companyKeywords).toBe('health, equity');
		const asString = normalizeLead({ email: 'c@d.com', company_technologies: 'adroll, disqus' })!;
		expect(asString.companyTechnologies).toBe('adroll, disqus');
		const absent = normalizeLead({ email: 'e@f.com' })!;
		expect(absent.companyKeywords).toBeNull();
	});

	// A personal address is a different consent question from a work address,
	// so it must never silently become the primary email.
	it('never promotes a personal email into the work email field', () => {
		const lead = normalizeLead({ personal_email: 'ana@gmail.com', full_name: 'Ana', domain: 'x.com' })!;
		expect(lead.email).toBeNull();
		expect(lead.personalEmail).toBe('ana@gmail.com');
	});

	// Third-party actors rename fields between versions; the mapper reads
	// several candidates so a rename degrades one field instead of the row.
	it('tolerates camelCase variants', () => {
		const lead = normalizeLead({ fullName: 'Bob Lee', companyDomain: 'b.io', jobTitle: 'CEO' })!;
		expect(lead.fullName).toBe('Bob Lee');
		expect(lead.jobTitle).toBe('CEO');
		expect(lead.dedupKey).toBe('name:bob lee|b.io');
	});

	it('drops an item with no usable identity instead of staging junk', () => {
		expect(normalizeLead({ company_industry: 'retail' })).toBeNull();
		expect(normalizeLead({})).toBeNull();
	});

	it('keeps the untouched item for auditing a bad mapping', () => {
		const item = { email: 'a@b.com', weird_new_field: 42 };
		expect(normalizeLead(item)!.raw).toEqual(item);
	});

	it('ignores an invalid email but still uses the name fallback', () => {
		const lead = normalizeLead({ email: 'not-an-email', full_name: 'Ce Dee', domain: 'c.com' })!;
		expect(lead.email).toBeNull();
		expect(lead.dedupKey).toBe('name:ce dee|c.com');
	});
});

describe('normalizePage', () => {
	it('collapses duplicates inside the page', () => {
		// Two rows for the same person in one upsert would trip Postgres's
		// "cannot affect row a second time".
		const { leads, skipped } = normalizePage([
			{ email: 'a@b.com' },
			{ email: 'A@B.com' },
			{ email: 'c@d.com' },
		]);
		expect(leads.map((l) => l.dedupKey)).toEqual(['a@b.com', 'c@d.com']);
		expect(skipped).toBe(1);
	});

	it('counts unusable items as skipped', () => {
		const { leads, skipped } = normalizePage([{ email: 'a@b.com' }, {}, { industry: 'x' }]);
		expect(leads).toHaveLength(1);
		expect(skipped).toBe(2);
	});

	it('handles an empty page', () => {
		expect(normalizePage([])).toEqual({ leads: [], skipped: 0 });
	});
});
