import { describe, expect, it } from 'vitest';
import { mapContract, mapPayment, renewalWindow, summarizeMrr, CONTRACT_COLUMNS, type ContractRow } from './finance';

const TODAY = '2026-09-19';

function contract(over: Partial<ContractRow> = {}): ContractRow {
	return {
		contract_id: 'c1',
		client_id: 'cl1',
		display_name: 'Acme',
		airtable_contract_id: 'recA',
		status: 'active',
		package: 'Grow & Scale 6',
		package_family: 'Grow & Scale',
		per_month_cents: 450000,
		starts_on: '2026-04-01',
		ends_on: null,
		term_months: 6,
		renewal_on: '2026-10-01',
		last_secured_month: '2026-09-01',
		last_live_month: '2026-08-01',
		days_since_last_secured: 18,
		...over,
	};
}

describe('mapContract', () => {
	it('converts cents to dollars, computes renewal window, never emits comp fields', () => {
		const raw = { ...contract(), hourly_rate_cents: 9999 } as ContractRow & Record<string, unknown>;
		const out = mapContract(raw, TODAY);
		expect(out.per_month_usd).toBe(4500);
		expect(out.days_to_renewal).toBe(12);
		expect(out.renewal_window).toBe('30');
		expect(out.url).toBe('/clients/cl1');
		expect(JSON.stringify(out)).not.toContain('hourly_rate');
	});
	it('no window for inactive contracts or past renewals', () => {
		expect(mapContract(contract({ status: 'closed' }), TODAY).renewal_window).toBeNull();
		expect(mapContract(contract({ renewal_on: '2026-01-01' }), TODAY).renewal_window).toBeNull();
		expect(mapContract(contract({ renewal_on: '2026-12-01' }), TODAY).renewal_window).toBe('90');
	});
	it('select list never includes comp or people columns', () => {
		expect(CONTRACT_COLUMNS).not.toMatch(/hourly|payroll|comp/);
	});
});

describe('renewalWindow', () => {
	it('buckets 30/60/90 and null beyond', () => {
		expect(renewalWindow(0)).toBe('30');
		expect(renewalWindow(30)).toBe('30');
		expect(renewalWindow(31)).toBe('60');
		expect(renewalWindow(90)).toBe('90');
		expect(renewalWindow(91)).toBeNull();
		expect(renewalWindow(-1)).toBeNull();
		expect(renewalWindow(null)).toBeNull();
	});
});

describe('mapPayment', () => {
	it('late = unpaid past due + 10 day grace (decision 14)', () => {
		const base = { id: 'p1', airtable_contract_id: 'recA', due_on: '2026-09-01', paid_on: null, status: 'Invoice', type: 'Retainer' };
		expect(mapPayment(base, 'Acme', TODAY).is_late).toBe(true);
		expect(mapPayment(base, 'Acme', TODAY).days_overdue).toBe(18);
		expect(mapPayment({ ...base, due_on: '2026-09-12' }, 'Acme', TODAY).is_late).toBe(false);
		expect(mapPayment({ ...base, status: 'Paid', paid_on: '2026-09-02' }, 'Acme', TODAY).is_late).toBe(false);
		expect(mapPayment({ ...base, status: 'Paid', paid_on: '2026-09-02' }, 'Acme', TODAY).days_overdue).toBeNull();
	});
});

describe('summarizeMrr', () => {
	it('sums active contracts by family, dollars, sorted desc', () => {
		const s = summarizeMrr([
			contract({ contract_id: 'a', per_month_cents: 100000, package_family: 'Kickstarter' }),
			contract({ contract_id: 'b', per_month_cents: 300000, package_family: 'Grow & Scale' }),
			contract({ contract_id: 'c', per_month_cents: 999999, status: 'closed' }),
			contract({ contract_id: 'd', per_month_cents: null, package_family: null }),
		]);
		expect(s.mrr_usd).toBe(4000);
		expect(s.active_contracts).toBe(3);
		expect(s.by_family.map((f) => f.package_family)).toEqual(['Grow & Scale', 'Kickstarter', 'Other']);
	});
});
