import { describe, expect, it } from 'vitest';
import { aggregateOppMonths, buildNameResolver, monthOf, windowMonths } from './oppMonths';

const NOW = new Date('2026-09-19T12:00:00Z');

describe('buildNameResolver', () => {
	it('exact display name wins, aliases fill in, ambiguous folds resolve to nothing', () => {
		const r = buildNameResolver(
			[{ id: 'a', display_name: 'Acme Co' }, { id: 'b', display_name: 'Béta PR' }, { id: 'c', display_name: 'Beta PR' }],
			[{ client_id: 'a', raw_name: 'ACME Company' }],
		);
		expect(r('acme co')).toBe('a');
		expect(r('ACME Company')).toBe('a');
		expect(r('Acme  Co.')).toBe('a');
		expect(r('beta pr')).toBe('c'); // exact lowercase match on c
		expect(r('bèta pr')).toBeUndefined(); // folds to "beta pr" which is ambiguous (b and c)
		expect(r('Nobody')).toBeUndefined();
	});
});

describe('aggregateOppMonths', () => {
	const resolve = buildNameResolver([{ id: 'cl1', display_name: 'Acme' }, { id: 'cl2', display_name: 'Two' }, { id: 'cl3', display_name: 'Multi' }], []);
	const contracts = new Map([['cl1', ['recA']], ['cl3', ['recM1', 'recM2']]]);
	it('counts secured by R3 bucket with the date fallback, live by live date, zero-fills the window, reports skips', () => {
		const out = aggregateOppMonths(
			[
				{ status: 'Secured Coverage', clientName: 'Acme', dateSent: '2026-09-03', liveLink: 'https://x', liveDate: '2026-09-10' },
				{ status: 'Client Decline', clientName: 'Acme', dateSecured: '2026-08-20' },
				{ status: 'Pitched', clientName: 'Acme', dateSecured: '2026-08-21' }, // not a secured bucket
				{ status: 'Secured Coverage', clientName: 'Acme', dateAdded: '2024-01-05' }, // outside window, kept
				{ status: 'Secured Coverage', clientName: 'Two', dateSent: '2026-09-01' }, // not in scope
				{ status: 'Secured Coverage', clientName: 'Multi', dateSent: '2026-09-01' }, // ambiguous
				{ status: 'Secured Coverage', clientName: 'Ghost', dateSent: '2026-09-01' },
				{ status: 'Secured Coverage', clientName: null },
			],
			resolve,
			contracts,
			NOW,
		);
		const byMonth = new Map(out.rows.filter((r) => r.airtable_contract_id === 'recA').map((r) => [r.month, r]));
		expect(byMonth.get('2026-09-01')).toMatchObject({ secured_count: 1, live_count: 1 });
		expect(byMonth.get('2026-08-01')).toMatchObject({ secured_count: 1, live_count: 0 });
		expect(byMonth.get('2026-07-01')).toMatchObject({ secured_count: 0, live_count: 0 });
		expect(byMonth.get('2024-01-01')).toMatchObject({ secured_count: 1 });
		expect(out.rows.filter((r) => r.airtable_contract_id === 'recA').length).toBe(15); // 14 window + 1 historical
		expect(out.rows.some((r) => r.airtable_contract_id.startsWith('recM'))).toBe(false);
		expect(out.skipped).toEqual({ no_client_name: 1, unresolved_name: 1, client_not_in_scope: 1, multi_contract_ambiguous: 1 });
		expect(out.unresolved_names).toEqual([['Ghost', 1]]);
		expect(out.secured_month_basis).toEqual({ date_sent: 1, date_secured: 1, date_added: 1, none: 0 });
	});
});

describe('helpers', () => {
	it('monthOf / windowMonths', () => {
		expect(monthOf('2026-09-19')).toBe('2026-09-01');
		expect(monthOf('junk')).toBeNull();
		expect(monthOf(undefined)).toBeNull();
		const w = windowMonths(NOW, 3);
		expect(w).toEqual(['2026-09-01', '2026-08-01', '2026-07-01']);
	});
});
