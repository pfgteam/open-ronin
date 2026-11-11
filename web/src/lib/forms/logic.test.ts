import { describe, expect, it } from 'vitest';
import { finalizeSubmission, ruleHolds, validateFields, visibleFields, type FormField } from './logic';

const fields: FormField[] = [
	{ key: 'kind', label: 'Kind', type: 'select', options: ['bug', 'idea'], required: true },
	{ key: 'severity', label: 'Severity', type: 'select', options: ['low', 'high'], required: true, show_if: { field: 'kind', op: 'eq', value: 'bug' } },
	{ key: 'repro', label: 'Repro steps', type: 'textarea', show_if: { field: 'severity', op: 'eq', value: 'high' } },
	{ key: 'notes', label: 'Notes', type: 'text' },
];

describe('form logic', () => {
	it('evaluates every operator', () => {
		expect(ruleHolds({ field: 'a', op: 'eq', value: 'x' }, { a: 'x' })).toBe(true);
		expect(ruleHolds({ field: 'a', op: 'neq', value: 'x' }, { a: 'y' })).toBe(true);
		expect(ruleHolds({ field: 'a', op: 'in', value: 'x, y' }, { a: ['y'] })).toBe(true);
		expect(ruleHolds({ field: 'a', op: 'not_empty' }, { a: '' })).toBe(false);
		expect(ruleHolds({ field: 'a', op: 'empty' }, {})).toBe(true);
		expect(ruleHolds(null, {})).toBe(true);
	});

	it('shows B only if A = X, and chains hidden controllers', () => {
		expect(visibleFields(fields, { kind: 'idea' }).map((f) => f.key)).toEqual(['kind', 'notes']);
		expect(visibleFields(fields, { kind: 'bug', severity: 'low' }).map((f) => f.key)).toEqual(['kind', 'severity', 'notes']);
		expect(visibleFields(fields, { kind: 'bug', severity: 'high' }).map((f) => f.key)).toEqual(['kind', 'severity', 'repro', 'notes']);
		// severity=high but kind=idea: severity is hidden, so repro is hidden too
		expect(visibleFields(fields, { kind: 'idea', severity: 'high' }).map((f) => f.key)).toEqual(['kind', 'notes']);
	});

	it('strips hidden values and enforces required only on visible fields', () => {
		const r = finalizeSubmission(fields, { kind: 'idea', severity: 'high', repro: 'stale', notes: 'n' });
		expect(r.errors).toEqual([]);
		expect(r.data).toEqual({ kind: 'idea', notes: 'n' });
		const missing = finalizeSubmission(fields, { kind: 'bug' });
		expect(missing.errors).toEqual(['Severity is required.']);
	});

	it('refuses rules that point forward or at unknown fields', () => {
		expect(validateFields(fields)).toEqual([]);
		expect(validateFields([{ key: 'a', label: 'A', type: 'text', show_if: { field: 'b', op: 'eq', value: '1' } }, { key: 'b', label: 'B', type: 'text' }])).toContain('Field 1: a rule can only depend on a field above it.');
		expect(validateFields([{ key: 'Bad Key', label: 'A', type: 'text' }])[0]).toMatch(/lowercase identifier/);
	});
});
