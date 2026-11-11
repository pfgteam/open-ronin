import { describe, expect, it } from 'vitest';
import {
	buildTradeShowInput,
	estimateTradeShowCostUsd,
	exhibitorDedupKey,
	isValidShowUrl,
	normalizeExhibitor,
	normalizeExhibitorPage,
} from './tradeShowPreset';

const SHOW = 'https://tbse26.mapyourshow.com/8_0/explore/exhibitor-gallery.cfm';

describe('buildTradeShowInput', () => {
	it('always pins result_limit to the job ceiling', () => {
		// Blank means "every exhibitor" to this actor. A large fair would bill
		// well past what the operator asked for.
		const input = buildTradeShowInput({ url: SHOW }, 250);
		expect(input.result_limit).toBe(250);
		expect(input.start_url).toBe(SHOW);
	});

	it('looks up emails by default — an exhibitor with no contact is barely a lead', () => {
		expect(buildTradeShowInput({ url: SHOW }, 10).lookup_emails).toBe(true);
	});

	it('leaves booth sizes off unless asked, since they cost extra', () => {
		expect(buildTradeShowInput({ url: SHOW }, 10).get_booth_sizes).toBe(false);
		expect(buildTradeShowInput({ url: SHOW, boothSizes: true }, 10).get_booth_sizes).toBe(true);
	});
});

describe('estimateTradeShowCostUsd', () => {
	it('charges more when booth sizes are requested', () => {
		expect(estimateTradeShowCostUsd(1000, true)).toBeGreaterThan(estimateTradeShowCostUsd(1000));
	});
});

describe('isValidShowUrl', () => {
	it('accepts http and https', () => {
		expect(isValidShowUrl(SHOW)).toBe(true);
		expect(isValidShowUrl('http://expo.example/exhibitors')).toBe(true);
	});

	it('rejects anything that is not a plain web URL', () => {
		for (const bad of ['', '   ', 'expo.example/list', 'javascript:alert(1)', 'file:///etc/passwd', 42, null]) {
			expect(isValidShowUrl(bad)).toBe(false);
		}
	});

	it('rejects an absurdly long string', () => {
		expect(isValidShowUrl(`https://x.com/${'a'.repeat(2100)}`)).toBe(false);
	});
});

describe('exhibitorDedupKey', () => {
	// The rule that differs from leads: an exhibitor is a COMPANY, and most
	// listings carry no person at all. Keying on email would discard the list.
	it('keys on the company domain when there is one', () => {
		expect(
			exhibitorDedupKey({ companyDomain: 'acme.com', companyName: 'Acme', sourceUrl: SHOW }),
		).toBe('acme.com');
	});

	it('falls back to the company name scoped to the show', () => {
		const key = exhibitorDedupKey({ companyDomain: null, companyName: 'Acme  Inc', sourceUrl: SHOW });
		expect(key).toBe('exhibitor:acme inc|tbse26.mapyourshow.com');
	});

	it('lets the same company appear once per fair', () => {
		const a = exhibitorDedupKey({ companyDomain: null, companyName: 'Acme', sourceUrl: 'https://showA.com/list' });
		const b = exhibitorDedupKey({ companyDomain: null, companyName: 'Acme', sourceUrl: 'https://showB.com/list' });
		expect(a).not.toBe(b);
	});

	it('survives an unparseable source URL', () => {
		expect(
			exhibitorDedupKey({ companyDomain: null, companyName: 'Acme', sourceUrl: 'not a url' }),
		).toBe('exhibitor:acme|');
	});

	it('returns null with no company at all', () => {
		expect(exhibitorDedupKey({ companyDomain: null, companyName: null, sourceUrl: SHOW })).toBeNull();
	});

	it('is deterministic, so a cursor retry cannot double-import', () => {
		const l = { companyDomain: null, companyName: 'Acme', sourceUrl: SHOW };
		expect(exhibitorDedupKey(l)).toBe(exhibitorDedupKey(l));
	});
});

describe('normalizeExhibitor', () => {
	it('keeps a company-only row, which is the common case', () => {
		const row = normalizeExhibitor({ company_name: 'Acme Foods', booth: 'A-142' }, SHOW)!;
		expect(row.companyName).toBe('Acme Foods');
		expect(row.booth).toBe('A-142');
		expect(row.fullName).toBeNull();
		expect(row.sourceUrl).toBe(SHOW);
		expect(row.dedupKey).toContain('acme foods');
	});

	it('picks up a contact person when the listing has one', () => {
		const row = normalizeExhibitor(
			{ company_name: 'Acme', website: 'https://www.acme.com/', contact_name: 'Ana Silva', contact_email: 'Ana@Acme.com' },
			SHOW,
		)!;
		expect(row.fullName).toBe('Ana Silva');
		expect(row.email).toBe('ana@acme.com');
		expect(row.companyDomain).toBe('acme.com');
		expect(row.dedupKey).toBe('acme.com');
	});

	it('drops a row with no company', () => {
		expect(normalizeExhibitor({ booth: 'A-1' }, SHOW)).toBeNull();
		expect(normalizeExhibitor({}, SHOW)).toBeNull();
	});

	it('joins category and product lists into one string', () => {
		const row = normalizeExhibitor(
			{ company_name: 'Acme', categories: ['Snacks', 'Beverages'], products: 'bars, drinks' },
			SHOW,
		)!;
		expect(row.companyIndustry).toBe('Snacks, Beverages');
		expect(row.companyKeywords).toBe('bars, drinks');
	});

	it('leaves the database-lead fields null instead of inventing them', () => {
		const row = normalizeExhibitor({ company_name: 'Acme' }, SHOW)!;
		expect(row.seniority).toBeNull();
		expect(row.companyRevenue).toBeNull();
		expect(row.headline).toBeNull();
	});

	// The exact payload a live A2Z run returned. This is the shape that broke
	// the first import: every field underscore-prefixed, so matching on bare
	// names found nothing and all 25 rows were discarded as "no identity".
	it('reads the real underscore-prefixed A2Z payload', () => {
		const row = normalizeExhibitor(
			{
				___exhibitor_profile_url: 'https://exhibitor.newtopianow.com/2026/Public/eBooth.aspx?BoothID=1655227',
				__company_name: '5 Lakes Flavor / Ruby Crunch Chili Crisp',
				_company_website: 'http://www.5lakesflavor.com',
				_company_country: 'United States',
				_hall_stands: '951',
			},
			SHOW,
		)!;
		expect(row.companyName).toBe('5 Lakes Flavor / Ruby Crunch Chili Crisp');
		expect(row.companyWebsite).toBe('http://www.5lakesflavor.com');
		expect(row.companyDomain).toBe('5lakesflavor.com');
		expect(row.companyCountry).toBe('United States');
		expect(row.booth).toBe('951');
		// Per-row profile page beats repeating the list URL, which is in params.
		expect(row.sourceUrl).toContain('eBooth.aspx');
		expect(row.dedupKey).toBe('5lakesflavor.com');
	});

	it('takes the most-seen address from the found_emails lookup', () => {
		const row = normalizeExhibitor(
			{
				__company_name: 'Apex-Brasil',
				found_emails: [
					{ email: 'raro@example.org', event_count: 1 },
					{ email: 'info@example.org', event_count: 12 },
				],
			},
			SHOW,
		)!;
		expect(row.email).toBe('info@example.org');
	});

	it('survives an empty or malformed found_emails', () => {
		expect(normalizeExhibitor({ __company_name: 'A', found_emails: [] }, SHOW)!.email).toBeNull();
		expect(normalizeExhibitor({ __company_name: 'B', found_emails: 'nope' }, SHOW)!.email).toBeNull();
	});

	it('keeps the untouched item for fixing the mapping after a real run', () => {
		// The actor publishes no output schema, so the first live run is what
		// confirms these field names.
		const item = { company_name: 'Acme', some_unknown_field: 7 };
		expect(normalizeExhibitor(item, SHOW)!.raw).toEqual(item);
	});
});

describe('normalizeExhibitorPage', () => {
	it('collapses duplicates inside the page', () => {
		const { leads, skipped } = normalizeExhibitorPage(
			[{ company_name: 'Acme', domain: 'acme.com' }, { company_name: 'Acme Inc', website: 'acme.com' }, { company_name: 'Other' }],
			SHOW,
		);
		expect(leads).toHaveLength(2);
		expect(skipped).toBe(1);
	});

	it('counts company-less rows as skipped', () => {
		const { leads, skipped } = normalizeExhibitorPage([{ company_name: 'Acme' }, {}, { booth: 'B-2' }], SHOW);
		expect(leads).toHaveLength(1);
		expect(skipped).toBe(2);
	});
});
