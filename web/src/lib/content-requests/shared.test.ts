import { describe, expect, it } from 'vitest';
import { slaClock, sortQueue, type ContentRequestRow } from './shared';

const now = new Date('2026-09-19T15:00:00Z');

function row(p: Partial<ContentRequestRow>): Pick<ContentRequestRow, 'status' | 'sla_accept_by' | 'due_on' | 'priority' | 'created_at'> {
	return { status: 'requested', sla_accept_by: '2026-09-20T15:00:00Z', due_on: null, priority: 'normal', created_at: '2026-09-19T15:00:00Z', ...p };
}

describe('slaClock', () => {
	it('shows the accept-by clock while requested', () => {
		expect(slaClock(row({ sla_accept_by: '2026-09-20T15:00:00Z' }), now)).toEqual({ state: 'ok', clock: 'accept', label: 'accept in 24h' });
		expect(slaClock(row({ sla_accept_by: '2026-09-19T17:00:00Z' }), now)).toEqual({ state: 'soon', clock: 'accept', label: 'accept in 2h' });
		expect(slaClock(row({ sla_accept_by: '2026-09-19T12:00:00Z' }), now)).toEqual({ state: 'late', clock: 'accept', label: 'accept 3h late' });
	});
	it('switches to the due date once accepted', () => {
		expect(slaClock(row({ status: 'accepted', due_on: '2026-09-25' }), now).clock).toBe('due');
		expect(slaClock(row({ status: 'in_studio', due_on: '2026-09-25' }), now).state).toBe('ok');
		expect(slaClock(row({ status: 'accepted', due_on: '2026-09-19' }), now)).toEqual({ state: 'soon', clock: 'due', label: 'due today' });
		expect(slaClock(row({ status: 'accepted', due_on: '2026-09-10' }), now).state).toBe('late');
		expect(slaClock(row({ status: 'accepted', due_on: null }), now).state).toBe('none');
	});
	it('is silent on closed rows', () => {
		expect(slaClock(row({ status: 'delivered', due_on: '2026-09-10' }), now).clock).toBe('none');
		expect(slaClock(row({ status: 'declined' }), now).clock).toBe('none');
	});
});

describe('sortQueue', () => {
	it('puts open rows first, soonest due first, undated last, then priority, then oldest', () => {
		const rows = [
			{ ...row({ status: 'delivered', due_on: '2026-09-01' }), id: 'closed' },
			{ ...row({ due_on: null, priority: 'urgent' }), id: 'undated-urgent' },
			{ ...row({ due_on: '2026-09-22' }), id: 'later' },
			{ ...row({ due_on: '2026-09-20', priority: 'low' }), id: 'soon-low' },
			{ ...row({ due_on: '2026-09-20', priority: 'high', created_at: '2026-09-19T16:00:00Z' }), id: 'soon-high' },
			{ ...row({ due_on: null, priority: 'normal', created_at: '2026-09-18T00:00:00Z' }), id: 'undated-normal' },
		];
		expect(sortQueue(rows).map((r) => r.id)).toEqual(['soon-high', 'soon-low', 'later', 'undated-urgent', 'undated-normal', 'closed']);
	});
});
