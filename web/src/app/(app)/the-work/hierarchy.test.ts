import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CHILD_KINDS_FOR_PARENT, PARENT_KIND_FOR, isValidParent } from './hierarchy';

// The DB trigger (enforce_work_item_parent, baseline migration) and hierarchy.ts must agree:
// a UI that offers a parent the trigger rejects fails on save, and one that
// hides a parent the trigger allows hides real structure. Parse the CASE in
// the migration and compare.
const migration = readFileSync(
	path.resolve(import.meta.dirname, '../../../../../supabase/migrations/20261111000000_baseline.sql'),
	'utf8',
);

function triggerTable(): Record<string, string> {
	const fn = migration.slice(migration.indexOf('FUNCTION public.enforce_work_item_parent()'));
	const body = fn.slice(0, fn.indexOf('$$;'));
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)) out[m[1]] = m[2];
	return out;
}

describe('work item hierarchy', () => {
	it('matches the enforce_work_item_parent() trigger exactly', () => {
		expect(triggerTable()).toEqual(PARENT_KIND_FOR);
	});

	it('is strict: Goal > Priority > Project > Task, tasks have no children', () => {
		expect(CHILD_KINDS_FOR_PARENT.goal).toEqual(['priority']);
		expect(CHILD_KINDS_FOR_PARENT.priority).toEqual(['project']);
		expect(CHILD_KINDS_FOR_PARENT.project).toEqual(['task']);
		expect(CHILD_KINDS_FOR_PARENT.task).toBeUndefined();
	});

	it('keeps the client chain', () => {
		expect(PARENT_KIND_FOR.assignment).toBe('campaign');
		expect(PARENT_KIND_FOR.campaign).toBe('twelve_week_plan');
		expect(PARENT_KIND_FOR.twelve_week_plan).toBe('strategy');
	});

	it('validates parents', () => {
		expect(isValidParent('task', 'project')).toBe(true);
		expect(isValidParent('task', 'task')).toBe(false);
		expect(isValidParent('project', 'project')).toBe(false);
		expect(isValidParent('recurring', 'project')).toBe(false);
		expect(isValidParent('recurring', null)).toBe(true);
	});
});
