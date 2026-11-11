import { describe, expect, it } from 'vitest';
import type { BoardContext, StatusDef, WorkRow } from '@/lib/work/boards/types';
import { categoryOf, flattenGroups, progressValue, sortRows, statusTone, groupColor } from './rows';
import { hiddenOnTypeChange, mapStatus, fieldsFor, planningFieldsCsv, KIND_FIELDS } from '@/lib/work/fields';

const st = (slug: string, extra: Partial<StatusDef> = {}): StatusDef => ({ slug, label: slug, color: null, ...extra });
const TASK = [st('backlog', { category: 'not_started' }), st('to_do', { is_initial: true, category: 'not_started' }), st('in_progress', { category: 'active' }), st('blocked', { category: 'active' }), st('review', { category: 'active' }), st('done', { is_terminal: true, category: 'done' }), st('discard', { is_terminal: true, category: 'cancelled' })];
const BUG = [st('backlog', { category: 'not_started' }), st('triage', { is_initial: true, category: 'not_started' }), st('in_progress', { category: 'active' }), st('in_review', { category: 'active' }), st('fixed', { is_terminal: true, category: 'done' }), st('wont_fix', { is_terminal: true, category: 'cancelled' })];
const ctx = { statusesByKind: { task: TASK, bug: BUG }, progress: {}, people: { a: { name: 'Ana Bell', initials: 'AB' }, z: { name: 'Zoe Moss', initials: 'ZM' } } } as unknown as BoardContext;

function row(over: Partial<WorkRow>): WorkRow {
	return { id: over.id ?? Math.random().toString(36).slice(2), name: 'x', kind: 'task', status: 'to_do', owner_id: null, parent_id: null, starts_at: null, ends_at: null, quarter_id: null, department_tag_id: null, client_id: null, priority: null, completed_at: null, updated_at: '2026-11-01', created_by: null, archived: false, ...over };
}

describe('status tones (8.5: quiet badges, token colours)', () => {
	it('maps categories and the attention slugs', () => {
		expect(statusTone(st('done', { category: 'done' }))).toBe('success');
		expect(statusTone(st('discard', { category: 'cancelled' }))).toBe('muted');
		expect(statusTone(st('blocked', { category: 'active' }))).toBe('danger');
		expect(statusTone(st('review', { category: 'active' }))).toBe('warning');
		expect(statusTone(st('in_progress', { category: 'active' }))).toBe('primary');
		expect(statusTone(st('to_do', { category: 'not_started' }))).toBe('neutral');
		expect(statusTone(st('backlog', { category: 'not_started' }))).toBe('muted');
	});
	it('derives a category when the 0162 column is missing', () => {
		expect(categoryOf(st('done', { is_terminal: true }))).toBe('done');
		expect(categoryOf(st('wont_fix', { is_terminal: true }))).toBe('cancelled');
		expect(categoryOf(st('planning'))).toBe('not_started');
		expect(categoryOf(st('live_ops'))).toBe('active');
	});
	it('group colours are tokens, never hex', () => {
		expect(groupColor('status', 'blocked', 0, ctx, ['task'])).toBe('var(--c-danger)');
		expect(groupColor('owner', 'a', 2, ctx, ['task'])).toMatch(/^var\(--viz-\d\)$/);
		expect(groupColor('owner', '__none__', 2, ctx, ['task'])).toBe('var(--line2)');
	});
});

describe('progress (D14)', () => {
	it('manual value wins, else rollup, else own status', () => {
		const c = { ...ctx, progress: { p: { done: 1, total: 4 } } } as BoardContext;
		expect(progressValue(c, row({ id: 'p', manual_progress: 80 }))).toBe(80);
		expect(progressValue(c, row({ id: 'p' }))).toBe(25);
		expect(progressValue(c, row({ id: 'q', status: 'done' }))).toBe(100);
		expect(progressValue(c, row({ id: 'q', status: 'discard' }))).toBe(0);
	});
});

describe('sorting over the full set', () => {
	const rows = [row({ id: '1', name: 'b', ends_at: '2026-12-01', owner_id: 'z' }), row({ id: '2', name: 'a', ends_at: null, owner_id: 'a' }), row({ id: '3', name: 'c', ends_at: '2026-11-01', owner_id: null })];
	it('nulls last in both directions', () => {
		expect(sortRows(rows, { key: 'due', dir: 'asc' }, ctx).map((r) => r.id)).toEqual(['3', '1', '2']);
		expect(sortRows(rows, { key: 'due', dir: 'desc' }, ctx).map((r) => r.id)).toEqual(['1', '3', '2']);
	});
	it('owner sorts by name; manual keeps the incoming order', () => {
		expect(sortRows(rows, { key: 'owner', dir: 'asc' }, ctx).map((r) => r.id)).toEqual(['2', '1', '3']);
		expect(sortRows(rows, null, ctx)).toBe(rows);
	});
	it('status sorts by the kind\'s status order', () => {
		const r = [row({ id: 'd', status: 'done' }), row({ id: 'b', status: 'backlog' }), row({ id: 'i', status: 'in_progress' })];
		expect(sortRows(r, { key: 'status', dir: 'asc' }, ctx).map((x) => x.id)).toEqual(['b', 'i', 'd']);
	});
});

describe('flat render list', () => {
	it('collapsed groups keep their header only; add + footer per open group', () => {
		const g1 = { key: 'a', label: 'A', color: 'x', rows: [row({ id: '1' }), row({ id: '2' })], count: 2 };
		const g2 = { key: 'b', label: 'B', color: 'x', rows: [row({ id: '3' })], count: 1 };
		const items = flattenGroups([g1, g2], new Set(['b']), { add: true, grouped: true });
		expect(items.map((i) => i.type)).toEqual(['group', 'row', 'row', 'add', 'footer', 'group']);
	});
});

describe('type change (5.6)', () => {
	it('maps statuses by category, same slug first', () => {
		expect(mapStatus(st('in_progress', { category: 'active' }), BUG)?.slug).toBe('in_progress');
		expect(mapStatus(st('review', { category: 'active' }), BUG)?.slug).toBe('in_progress');
		expect(mapStatus(st('done', { is_terminal: true, category: 'done' }), BUG)?.slug).toBe('fixed');
		expect(mapStatus(st('discard', { is_terminal: true, category: 'cancelled' }), BUG)?.slug).toBe('wont_fix');
		expect(mapStatus(st('backlog', { category: 'not_started' }), BUG)?.slug).toBe('backlog');
		expect(mapStatus(st('to_do', { category: 'not_started' }), BUG)?.slug).toBe('triage');
	});
	it('lists the filled-in fields the new type hides, and only those', () => {
		const t = row({ kind: 'project', project_lead_id: 'a', department_tag_id: 'd', quarter_id: null, description_md: 'kept' } as Partial<WorkRow>);
		const hidden = hiddenOnTypeChange(t, 'task').map((f) => f.key);
		expect(hidden).toContain('lead');
		expect(hidden).toContain('department');
		expect(hidden).not.toContain('quarter'); // empty
		expect(hidden).not.toContain('description'); // tasks show it too
	});
	it('progress and health only on containers; parent only on kinds that can have one', () => {
		expect(fieldsFor('task').some((f) => f.key === 'progress')).toBe(false);
		expect(fieldsFor('project').some((f) => f.key === 'progress')).toBe(true);
		expect(fieldsFor('goal').some((f) => f.key === 'parent')).toBe(false);
		expect(fieldsFor('task').some((f) => f.key === 'parent')).toBe(true);
	});
	it('the planning field CSV covers every kind', () => {
		const csv = planningFieldsCsv();
		for (const kind of Object.keys(KIND_FIELDS)) expect(csv).toContain(`\n${kind},1,`);
	});
});
