import { describe, expect, it } from 'vitest';
import { groupRows, isLate, progressOf, readableText, statusBattery, localToday, NO_GROUP_KEY } from './groups';
import { parseBaseFilter, parseColumns, type BoardContext, type WorkRow } from './types';
import { resolveColumns } from './columns';

const ctx: BoardContext = {
	statusesByKind: {
		project: [
			{ slug: 'to_do', label: 'To Do', color: '#0284c7' },
			{ slug: 'in_progress', label: 'In Progress', color: '#0ea5e9' },
			{ slug: 'done', label: 'Done', color: '#22c55e', is_terminal: true },
			{ slug: 'discard', label: 'Discard', color: '#475569', is_terminal: true },
		],
	},
	people: { u1: { name: 'Alex H.', initials: 'AH' } },
	departments: { d1: { label: 'Ops', color: '#0ea5e9' } },
	quarters: { q3: { name: '26-3' }, q4: { name: '26-4' } },
	parents: { p1: { name: 'Rocket V3 Launch', kind: 'priority' } },
	clients: {},
	progress: { a: { done: 1, total: 4 } },
	followers: {},
	customValues: { a: { c_stage: 'o2' }, b: { c_stage: 'o1' } },
	customColumns: [
		{ id: 'cc', key: 'c_stage', label: 'Stage', type: 'dropdown', position: 0, options: { options: [
			{ id: 'o1', label: 'Brief', color: '#579bfc' }, { id: 'o2', label: 'Draft', color: '#e8890c' },
		] } },
	],
};

const row = (o: Partial<WorkRow>): WorkRow => ({
	id: 'x', name: 'X', kind: 'project', status: 'to_do', owner_id: null, parent_id: null, starts_at: null, ends_at: null,
	quarter_id: null, department_tag_id: null, client_id: null, priority: null, completed_at: null, updated_at: '', created_by: null, archived: false, ...o,
});

describe('groupRows', () => {
	const rows = [
		row({ id: 'a', status: 'done', parent_id: 'p1', owner_id: 'u1', quarter_id: 'q3' }),
		row({ id: 'b', status: 'to_do', quarter_id: 'q4' }),
		row({ id: 'c', status: 'in_progress', parent_id: 'p1' }),
	];

	it('groups by parent with the "No <parent kind>" group last', () => {
		const g = groupRows(ctx, rows, 'parent', ['project']);
		expect(g.map((x) => x.label)).toEqual(['Rocket V3 Launch', 'No priority']);
		expect(g[0].rows.map((r) => r.id)).toEqual(['a', 'c']);
		expect(g[1].key).toBe(NO_GROUP_KEY);
	});

	it('keeps an empty group for every listed parent (a new goal with no priorities yet)', () => {
		const withGoals: BoardContext = { ...ctx, parents: { ...ctx.parents, p2: { name: 'Brand new goal', kind: 'priority' } }, parentGroups: ['p1', 'p2'] };
		const g = groupRows(withGoals, rows, 'parent', ['project']);
		expect(g.map((x) => x.label)).toEqual(['Brand new goal', 'Rocket V3 Launch', 'No priority']);
		expect(g[0].rows).toEqual([]);
		// Only when grouped by parent: other groupings ignore the list.
		expect(groupRows(withGoals, rows, 'status', ['project']).map((x) => x.key)).toEqual(['to_do', 'in_progress', 'done']);
	});

	it('orders status groups by the kind status order and uses its colour', () => {
		const g = groupRows(ctx, rows, 'status', ['project']);
		expect(g.map((x) => x.key)).toEqual(['to_do', 'in_progress', 'done']);
		expect(g[2].color).toBe('#22c55e');
	});

	it('orders quarters newest first', () => {
		const g = groupRows(ctx, rows, 'quarter', ['project']);
		expect(g.map((x) => x.label)).toEqual(['26-4', '26-3', 'No quarter']);
	});

	it('groups by a custom dropdown in option order', () => {
		const g = groupRows(ctx, rows, 'c_stage', ['project']);
		expect(g.map((x) => x.label)).toEqual(['Brief', 'Draft', 'Empty']);
	});
});

describe('battery, progress, lateness', () => {
	it('counts statuses in status order', () => {
		const b = statusBattery(ctx, [row({ status: 'done' }), row({ status: 'to_do' }), row({ status: 'done' })]);
		expect(b.map((s) => [s.slug, s.count])).toEqual([['to_do', 1], ['done', 2]]);
	});
	it('rolls progress up from children, else from own status', () => {
		expect(progressOf(ctx, row({ id: 'a' }))).toBe(25);
		expect(progressOf(ctx, row({ id: 'z', status: 'done' }))).toBe(100);
		expect(progressOf(ctx, row({ id: 'z', status: 'discard' }))).toBe(0);
	});
	it('is late only when open and due before today', () => {
		expect(isLate(ctx, row({ ends_at: '2026-09-30' }), '2026-10-01')).toBe(true);
		expect(isLate(ctx, row({ ends_at: '2026-09-30', status: 'done' }), '2026-10-01')).toBe(false);
		expect(isLate(ctx, row({ ends_at: '2026-10-01' }), '2026-10-01')).toBe(false);
	});
	it('picks readable text on colour', () => {
		expect(readableText('#22c55e')).toBe('#202020');
		expect(readableText('#475569')).toBe('#ffffff');
	});
	it('uses the local date, not UTC', () => {
		expect(localToday(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
	});
});

describe('board config parsing', () => {
	it('whitelists base filter keys and shapes', () => {
		expect(parseBaseFilter({ kinds: ['project', 'DROP;'], quarter: 'current', evil: 1, owner_id: 'nope' }))
			.toEqual({ kinds: ['project'], quarter: 'current' });
		expect(parseBaseFilter(null)).toEqual({});
	});
	it('keeps show_done only when it is literally true', () => {
		expect(parseBaseFilter({ show_done: true })).toEqual({ show_done: true });
		expect(parseBaseFilter({ show_done: 'yes' })).toEqual({});
		expect(parseBaseFilter({ show_done: false })).toEqual({});
	});
	it('resolves columns: config order, hidden dropped, unknown dropped, new custom appended', () => {
		const cols = resolveColumns(
			parseColumns([{ key: 'status' }, { key: 'owner', visible: false }, { key: 'bogus' }, { key: 'due', width: 120 }]),
			ctx.customColumns,
		);
		expect(cols.map((c) => c.key)).toEqual(['status', 'due', 'c_stage']);
		expect(cols[1].width).toBe(120);
	});
});
