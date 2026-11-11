import { describe, expect, it } from 'vitest';
import { WORK_ITEM_KINDS, BUG_SEVERITIES, BUG_ENVIRONMENTS, mapWorkItem, mapBug, isOverdue, terminalKey, buildTerminalSet, resolveTerminalKind } from './work';

describe('WORK_ITEM_KINDS', () => {
	it('is the 17-value list from projects_kind_check (0016:24-30 + bug from 0111)', () => {
		expect(WORK_ITEM_KINDS).toEqual([
			'goal', 'priority', 'process', 'recurring',
			'project', 'stage', 'task',
			'client_work', 'assignment', 'strategy', 'client_goal', 'target',
			'campaign', 'twelve_week_plan',
			'event', 'product_launch',
			'bug',
		]);
	});
});

describe('mapBug', () => {
	it('adds severity/environment/regression and still hides the planning columns', () => {
		const raw = {
			id: 'b1', name: 'Calendar sync drops attendees', kind: 'bug', status: 'new', priority: 'high',
			owner_id: 'u1', starts_at: null, ends_at: null, description_md: 'repro', client_id: null,
			severity: 'high', environment: 'production', is_regression: true,
			created_at: '2026-09-19T00:00:00Z', updated_at: null,
			notes_md: 'secret notes',
		};
		const row = mapBug(raw, { ownerName: 'QA Bot', ownerEmail: 'user-d3c583@example.com' });
		expect(row.severity).toBe('high');
		expect(row.environment).toBe('production');
		expect(row.regression).toBe(true);
		expect(row.url).toBe('/the-work/b1');
		expect(JSON.stringify(row)).not.toContain('secret notes');
		expect(BUG_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
		expect(BUG_ENVIRONMENTS).toEqual(['production', 'preview', 'staging', 'local']);
	});
});

describe('mapWorkItem', () => {
	it('exposes exactly the allowlist — no notes_md/lead_measure_md/process_action_md', () => {
		const raw = {
			id: 'w1',
			name: 'Ship feature',
			kind: 'task',
			status: 'in_progress',
			priority: 'high',
			owner_id: 'u1',
			starts_at: '2026-08-01',
			ends_at: '2026-09-01',
			description_md: 'desc',
			client_id: '8d25ace2-0000-4000-8000-000000000001',
			notes_md: 'secret notes',
			lead_measure_md: 'secret lead',
			lag_measure_md: 'secret lag',
			process_action_md: 'secret process',
		};
		const row = mapWorkItem(raw, { ownerName: 'Jane Doe', ownerEmail: 'user-8a8dee@example.com' });
		expect(Object.keys(row).sort()).toEqual(
			[
				'client_id', 'description_md', 'ends_at', 'id', 'kind',
				'name', 'owner_email', 'owner_name', 'priority', 'starts_at', 'status', 'url',
			].sort(),
		);
		const json = JSON.stringify(row);
		for (const forbidden of ['notes_md', 'lead_measure_md', 'process_action_md', 'secret']) {
			expect(json).not.toContain(forbidden);
		}
	});

	it('url points at /the-work/<id>', () => {
		const raw = {
			id: 'w1', name: 'X', kind: 'task', status: 's', priority: null, owner_id: null,
			starts_at: null, ends_at: null, description_md: null, client_id: null,
		};
		const row = mapWorkItem(raw, { ownerName: null, ownerEmail: null });
		expect(row.url).toBe('/the-work/w1');
	});
});

describe('isOverdue', () => {
	it('true when ends_at is before today and not terminal', () => {
		expect(isOverdue('2026-08-30', '2026-09-02', false)).toBe(true);
	});
	it('false when terminal even if past due', () => {
		expect(isOverdue('2026-08-30', '2026-09-02', true)).toBe(false);
	});
	it('false when ends_at is null', () => {
		expect(isOverdue(null, '2026-09-02', false)).toBe(false);
	});
	it('false when due today (not overdue)', () => {
		expect(isOverdue('2026-09-02', '2026-09-02', false)).toBe(false);
	});
});

describe('terminalKey / buildTerminalSet', () => {
	it('keys are per-kind — same slug in different kinds does not collide', () => {
		const set = buildTerminalSet([
			{ kind: 'task', slug: 'done', is_terminal: true },
			{ kind: 'goal', slug: 'done', is_terminal: false },
		]);
		expect(set.has(terminalKey('task', 'done'))).toBe(true);
		expect(set.has(terminalKey('goal', 'done'))).toBe(false);
	});
});

describe('resolveTerminalKind', () => {
	const aliases = { client_goal: 'client_work', product_launch: 'event', stage: 'task', bug: 'task' };

	it('aliases to the sibling kind when the alias target has its own config', () => {
		const kindsWithConfig = new Set(['client_work', 'task']);
		expect(resolveTerminalKind('client_goal', kindsWithConfig, aliases)).toBe('client_work');
	});

	it('falls back to the original kind when the alias target has no config', () => {
		const kindsWithConfig = new Set(['task']);
		expect(resolveTerminalKind('client_goal', kindsWithConfig, aliases)).toBe('client_goal');
	});

	it('returns a non-aliased kind unchanged', () => {
		const kindsWithConfig = new Set(['goal']);
		expect(resolveTerminalKind('goal', kindsWithConfig, aliases)).toBe('goal');
	});

	it('a kind with its own config is never aliased even if listed as an alias source', () => {
		const kindsWithConfig = new Set(['stage', 'task']);
		expect(resolveTerminalKind('stage', kindsWithConfig, aliases)).toBe('stage');
	});
});
