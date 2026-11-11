import { describe, expect, it } from 'vitest';
import { evalFilter, interpolate, nextCronRun, StepsSchema, type RunContext } from './shared';

const ctx: RunContext = {
	row: { id: 'r1', status: 'live', title: 'Forbes feature', amount: 12 },
	vars: { owner: 'abc' },
	rule: { id: 'x', slug: 'test', name: 'Test' },
	run: { id: 'run1', requested_by: null },
};

describe('interpolate', () => {
	it('substitutes dotted paths and blanks missing ones', () => {
		expect(interpolate('{{row.title}} by {{vars.owner}} {{row.nope}}', ctx)).toBe('Forbes feature by abc ');
	});
});

describe('evalFilter', () => {
	it('handles the operator set', () => {
		expect(evalFilter({ field: 'row.status', op: 'equals', value: 'live' }, ctx)).toBe(true);
		expect(evalFilter({ field: 'row.status', op: 'not_equals', value: 'live' }, ctx)).toBe(false);
		expect(evalFilter({ field: 'row.title', op: 'contains', value: 'forbes' }, ctx)).toBe(true);
		expect(evalFilter({ field: 'row.missing', op: 'is_empty' }, ctx)).toBe(true);
		expect(evalFilter({ field: 'row.amount', op: 'gt', value: 10 }, ctx)).toBe(true);
		expect(evalFilter({ field: 'row.amount', op: 'lt', value: 10 }, ctx)).toBe(false);
	});
});

describe('StepsSchema', () => {
	it('accepts the closed list and rejects unknown types', () => {
		expect(StepsSchema.safeParse([{ type: 'filter', config: { field: 'row.x' } }, { type: 'wait', config: { minutes: 5 } }]).success).toBe(true);
		expect(StepsSchema.safeParse([{ type: 'shell', config: {} }]).success).toBe(false);
		expect(StepsSchema.safeParse(new Array(21).fill({ type: 'wait', config: {} })).success).toBe(false);
	});
});

describe('nextCronRun (America/Chicago)', () => {
	// 2026-09-19 02:40 CDT == 07:40Z
	const from = new Date('2026-09-19T07:40:00Z');
	it('every minute -> next minute', () => {
		expect(nextCronRun('* * * * *', from)?.toISOString()).toBe('2026-09-19T07:41:00.000Z');
	});
	it('09:00 weekdays -> Monday 09:00 CDT (14:00Z) when from is Saturday', () => {
		expect(nextCronRun('0 9 * * MON-FRI', from)?.toISOString()).toBe('2026-09-21T14:00:00.000Z');
	});
	it('every 15 minutes', () => {
		expect(nextCronRun('*/15 * * * *', from)?.toISOString()).toBe('2026-09-19T07:45:00.000Z');
	});
	it('first of month 06:30', () => {
		expect(nextCronRun('30 6 1 * *', from)?.toISOString()).toBe('2026-10-01T11:30:00.000Z');
	});
	it('rejects malformed expressions', () => {
		expect(nextCronRun('nope', from)).toBeNull();
		expect(nextCronRun('61 * * * *', from)).toBeNull();
	});
});
