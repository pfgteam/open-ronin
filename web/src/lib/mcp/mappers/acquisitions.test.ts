import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapNote, mapTarget, sortForReadPath, PATCHABLE_COLUMNS, TARGET_STATUSES, TARGET_COLUMNS, type TargetRow } from './acquisitions';

function target(over: Partial<TargetRow> = {}): TargetRow {
	return {
		id: 't1',
		target_ref: 'DG-2026-001',
		company_name: 'Acme PR',
		website: 'https://acme.example',
		linkedin_url: null,
		owner_name: 'Jo Owner',
		owner_title: 'Founder',
		email: 'jo@acme.example',
		phone: null,
		agency_services: 'PR,social',
		employee_count: '12',
		founded_year: '2012',
		est_revenue: '2M',
		est_ebitda: null,
		financial_confidence: 'estimate',
		city: 'HQ',
		state: 'Tennessee',
		country: 'US',
		owner_signal: null,
		vertical: 'healthcare PR',
		notable_clients: null,
		retainer_mix_pct: 70,
		top3_concentration_pct: 25,
		growth_trend: 'growing',
		management_depth: 'has_seconds',
		owner_readiness: 'exploring',
		sourcing_channel: 'proprietary',
		relationship_warmth: 'warm_intro',
		last_touch_on: '2026-09-01',
		next_action: 'Intro call',
		next_action_on: '2026-09-10',
		hard_gate: 'pass',
		scorecard_total: 31,
		score_drivers: 'retainer mix',
		recommendation: 'escalate',
		fit_score: 80,
		status: 'screened',
		notes: null,
		batna: null,
		deal_structure: null,
		deal_stage_notes: null,
		owner_profile_id: 'u1',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

describe('mapTarget', () => {
	it('drops the internal owner id and join keys, adds location/overdue/url', () => {
		const raw = { ...target(), scraped_record_id: 'sr1', created_by: 'u9' } as TargetRow & Record<string, unknown>;
		const out = mapTarget(raw, { name: 'Alex', email: 'owner@example.com' }, '2026-09-19');
		const json = JSON.stringify(out);
		expect(json).not.toContain('owner_profile_id');
		expect(json).not.toContain('scraped_record_id');
		expect(json).not.toContain('created_by');
		expect(out.location).toBe('HQ, Tennessee');
		expect(out.next_action_overdue).toBe(true);
		expect(out.is_terminal).toBe(false);
		expect(out.url).toBe('/the-work/acquisitions/t1');
		expect(out.owner_name_internal).toBe('Alex');
	});
	it('a terminal status is never overdue', () => {
		const out = mapTarget(target({ status: 'passed' }), { name: null, email: null }, '2026-09-19');
		expect(out.is_terminal).toBe(true);
		expect(out.next_action_overdue).toBe(false);
	});
});

describe('mapNote', () => {
	it('hides author_id and proposed_action_id, keeps the provenance bit', () => {
		const out = mapNote(
			{ id: 'n1', target_id: 't1', kind: 'risk', title: 'Key person', body_md: 'x', severity: 'high', risk_status: 'open', author_id: 'u1', identity_slug: 'deal_integration', proposed_action_id: 'pa1', occurred_on: '2026-09-19', created_at: '2026-09-19T00:00:00Z' },
			'Alex',
		);
		expect(Object.keys(out).sort()).toEqual(['author_name', 'body_md', 'created_at', 'id', 'identity_slug', 'kind', 'occurred_on', 'risk_status', 'severity', 'target_id', 'title', 'via_proposal'].sort());
		expect(out.via_proposal).toBe(true);
	});
});

describe('sortForReadPath', () => {
	it('gate pass first, then scorecard desc, then next action soonest', () => {
		const rows = [
			{ id: 'a', hard_gate: null, scorecard_total: 35, next_action_on: null },
			{ id: 'b', hard_gate: 'pass', scorecard_total: 22, next_action_on: '2026-10-01' },
			{ id: 'c', hard_gate: 'pass', scorecard_total: 31, next_action_on: null },
			{ id: 'd', hard_gate: 'fail', scorecard_total: 40, next_action_on: null },
			{ id: 'e', hard_gate: 'pass', scorecard_total: 22, next_action_on: '2026-09-20' },
		];
		expect(sortForReadPath(rows).map((r) => r.id)).toEqual(['c', 'e', 'b', 'a', 'd']);
	});
});

describe('vocabulary mirrors the baseline migration', () => {
	const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations', '20261111000000_baseline.sql'), 'utf8');
	it('status list', () => {
		const m = sql.match(/acquisition_targets_status_check CHECK \(\(status = ANY \(ARRAY\[([^\]]+)\]/);
		expect(m).not.toBeNull();
		const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
		expect([...TARGET_STATUSES]).toEqual(inSql);
	});
	it('patchable columns', () => {
		const body = sql.split('FUNCTION public.acquisition_patchable_columns()')[1].split('$$;')[0];
		const inSql = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
		expect([...PATCHABLE_COLUMNS]).toEqual(inSql);
	});
	it('select list has no join keys', () => {
		expect(TARGET_COLUMNS).not.toMatch(/scraped_record_id|created_by/);
	});
});
