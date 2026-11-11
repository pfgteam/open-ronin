import { describe, expect, it } from 'vitest';
import {
	DEAL_MODEL_COLUMNS,
	cell,
	pendingToDealRow,
	targetToDealRow,
	toCsv,
} from './acquisitionCsv';

describe('deal model CSV contract', () => {
	it('carries exactly the screening columns, in order', () => {
		// The brief's list, verbatim. The sheet reads by header, so this is the
		// interface; reordering it is a breaking change.
		expect([...DEAL_MODEL_COLUMNS]).toEqual([
			'Company', 'Website', 'Owner', 'Title', 'Email', 'Phone', 'LinkedIn', 'Services',
			'Employees', 'Est Revenue', 'Founded', 'City', 'State', 'Country', 'Signal', 'Status',
			'Fit', 'Notes',
		]);
	});

	it('writes the header first, CRLF separated', () => {
		const csv = toCsv([]);
		expect(csv).toBe(DEAL_MODEL_COLUMNS.join(','));
		expect(toCsv([targetToDealRow(TARGET)]).split('\r\n')).toHaveLength(2);
	});

	it('neutralises spreadsheet formulas and quotes commas', () => {
		expect(cell('=cmd|calc')).toBe("'=cmd|calc");
		expect(cell('Acme, Inc.')).toBe('"Acme, Inc."');
		expect(cell('say "hi"')).toBe('"say ""hi"""');
		expect(cell(null)).toBe('');
	});
});

const TARGET = {
	company_name: 'Bright PR',
	website: 'https://www.brightpr.com',
	owner_name: 'Jane Doe',
	owner_title: 'Founder & CEO',
	email: 'jane@brightpr.com',
	phone: '+1 615 555 0100',
	linkedin_url: 'https://linkedin.com/in/janedoe',
	agency_services: 'PR, social',
	employee_count: '12',
	est_revenue: '1.8M',
	founded_year: '2008',
	city: 'HQ',
	state: 'Tennessee',
	country: 'United States',
	owner_signal: 'The founder is stepping back in 2027.',
	status: 'identified',
	fit_score: 72,
	notes: 'Warm intro via Jamie',
};

const PENDING = {
	company_name: 'Bright PR',
	company_website: 'https://www.brightpr.com',
	company_domain: 'brightpr.com',
	full_name: 'Jane Doe',
	job_title: 'Founder & CEO',
	email: 'jane@brightpr.com',
	personal_email: 'jane@gmail.com',
	mobile_phone: '+1 615 555 0100',
	company_phone: '+1 615 555 0199',
	linkedin_url: 'https://linkedin.com/in/janedoe',
	agency_services: 'PR, social',
	company_size: '12',
	company_revenue: '1.8M',
	company_founded_year: '2008',
	company_city: 'HQ',
	company_state: 'Tennessee',
	company_country: 'United States',
	owner_signal: 'The founder is stepping back in 2027.',
};

describe('row mapping', () => {
	it('maps a target one to one', () => {
		const row = targetToDealRow(TARGET);
		expect(row.Company).toBe('Bright PR');
		expect(row.Owner).toBe('Jane Doe');
		expect(row.Services).toBe('PR, social');
		expect(row.Fit).toBe(72);
		expect(row.Status).toBe('identified');
	});

	it('maps a pending record with the same precedence the approve action uses', () => {
		const row = pendingToDealRow(PENDING);
		expect(row.Email).toBe('jane@brightpr.com');
		expect(row.Phone).toBe('+1 615 555 0100');
		expect(row.Website).toBe('https://www.brightpr.com');
		expect(row.Status).toBe('pending review');
		expect(row.Fit).toBeNull();
	});

	it('falls back to domain, personal email and company phone when the primaries are blank', () => {
		const row = pendingToDealRow({
			...PENDING,
			company_name: null,
			company_website: null,
			email: null,
			mobile_phone: null,
		});
		expect(row.Company).toBe('brightpr.com');
		expect(row.Website).toBe('brightpr.com');
		expect(row.Email).toBe('jane@gmail.com');
		expect(row.Phone).toBe('+1 615 555 0199');
	});

	it('produces identical firm columns before and after approval', () => {
		const before = pendingToDealRow(PENDING);
		const after = targetToDealRow(TARGET);
		for (const c of DEAL_MODEL_COLUMNS) {
			if (c === 'Status' || c === 'Fit' || c === 'Notes') continue;
			expect(before[c], c).toBe(after[c]);
		}
	});
});
