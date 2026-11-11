import { describe, expect, it } from 'vitest';
import {
	READABLE,
	READABLE_TABLES,
	redactRows,
	redactedFor,
	ruleFor,
	splitRef,
} from './readableTables';

// The tables whose exposure would be the worst outcome. These assertions are
// the point of the file: a future edit that adds one of them to READABLE —
// by hand or by a "sync the allowlist with the schema" script — fails here
// rather than in production.
const NEVER_READABLE = [
	'public.ghl_connections',
	'public.google_calendar_connections',
	'public.integrations',
	'public.mcp_consumers',
	'public.ghl_oauth_states',
	'public.profile_sensitive',
	'public.payroll_runs',
	'public.comp_reconciliation',
	'public.metric_revisions',
	'public.project_rate_overrides',
	'comms.connections',
];

describe('readable-table allowlist', () => {
	it.each(NEVER_READABLE)('denies %s', (table) => {
		expect(ruleFor(table)).toBeUndefined();
	});

	it('denies an unknown table rather than defaulting open', () => {
		expect(ruleFor('public.some_table_added_next_quarter')).toBeUndefined();
	});

	it('treats an unqualified name as public', () => {
		expect(splitRef('clients')).toEqual({ schema: 'public', table: 'clients' });
		expect(ruleFor('clients')).toBe(ruleFor('public.clients'));
	});

	it('splits a qualified name on the FIRST dot', () => {
		expect(splitRef('spine.agent_audit')).toEqual({ schema: 'spine', table: 'agent_audit' });
	});

	it('allows the everyday operational tables', () => {
		for (const t of ['public.clients', 'public.projects', 'public.calls', 'public.live_links']) {
			expect(ruleFor(t)).toBeDefined();
		}
	});

	it('never lists a redacted column in an explicit column rule', () => {
		for (const [table, rule] of Object.entries(READABLE)) {
			if (rule === null) continue;
			for (const col of redactedFor(table)) {
				expect(rule).not.toContain(col);
			}
		}
	});

	it('exposes every allowlisted table in READABLE_TABLES, sorted', () => {
		expect(READABLE_TABLES).toHaveLength(Object.keys(READABLE).length);
		expect(READABLE_TABLES).toEqual([...READABLE_TABLES].sort());
	});
});

describe('redaction', () => {
	it('strips comp and birthday from a profile row', () => {
		const rows = redactRows('public.profiles', [
			{ id: '1', email: 'a@b.com', hourly_rate_cents: 5000, birthday: '1990-01-01' },
		]);
		expect(rows[0]).toEqual({ id: '1', email: 'a@b.com' });
	});

	it('strips personal contact details from a scraped record', () => {
		const rows = redactRows('public.scraped_records', [
			{ id: '1', full_name: 'X', personal_email: 'p@x.com', mobile_phone: '555', email: 'w@x.com' },
		]);
		expect(rows[0]).toEqual({ id: '1', full_name: 'X', email: 'w@x.com' });
	});

	it('leaves a table with no redactions untouched', () => {
		const row = { id: '1', name: 'Q1' };
		expect(redactRows('public.quarters', [row])[0]).toEqual(row);
	});

	it('does not mutate the caller\'s rows', () => {
		const row = { id: '1', hourly_rate_cents: 5000 };
		redactRows('public.profiles', [row]);
		expect(row.hourly_rate_cents).toBe(5000);
	});
});
