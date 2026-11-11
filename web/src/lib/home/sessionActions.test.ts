import { describe, expect, it } from 'vitest';
import { groupSessionActions, scopeSessionActions } from './sessionActions';

const calls = new Map([
	['c1', { id: 'c1', call_type: 'client', occurred_at: '2026-09-10T10:00:00Z', client_id: 'k1', attendee_user_ids: ['me'] }],
	['c2', { id: 'c2', call_type: 'internal', occurred_at: '2026-09-12T10:00:00Z', client_id: null, attendee_user_ids: ['rep1'] }],
	['c3', { id: 'c3', call_type: 'client', occurred_at: '2026-09-13T10:00:00Z', client_id: 'k1', attendee_user_ids: ['stranger'] }],
]);
const clients = new Map([['k1', 'Acme']]);
const scope = { viewerId: 'me', viewerEmail: 'me@example.com', reports: ['rep1'], reportEmails: ['rep1@example.com'] };

function sug(id: string, call_id: string, email: string | null) {
	return { id, call_id, title: `t-${id}`, detail_md: null, suggested_owner_email: email, created_at: '2026-09-14T00:00:00Z' };
}

describe('scopeSessionActions', () => {
	it('keeps suggestions addressed to the viewer, attended by them, or belonging to a report', () => {
		const out = scopeSessionActions(
			[
				sug('a', 'c3', 'ME@example.com'),      // named owner (case-insensitive) on a call I did not attend
				sug('b', 'c1', 'other@example.com'),   // I attended
				sug('c', 'c3', 'rep1@example.com'),    // report named owner
				sug('d', 'c2', null),              // report attended
				sug('e', 'c3', 'stranger@example.com'), // not mine, not my team's
			],
			calls,
			clients,
			scope,
		);
		expect(out.map((o) => [o.id, o.reason])).toEqual([
			['a', 'you'],
			['c', 'report'],
			['d', 'report_attended'],
			['b', 'attended'],
		]);
		expect(out[0].clientName).toBe('Acme');
		expect(out[2].clientName).toBeNull();
	});

	it('orders by call date, newest first', () => {
		const out = scopeSessionActions([sug('x', 'c1', null), sug('y', 'c2', null)], calls, clients, scope);
		expect(out.map((o) => o.id)).toEqual(['y', 'x']);
	});

	it('drops a suggestion whose call is missing unless the owner email matches', () => {
		const out = scopeSessionActions([sug('gone', 'nope', null), sug('mine', 'nope', 'me@example.com')], calls, clients, scope);
		expect(out.map((o) => o.id)).toEqual(['mine']);
	});
});

describe('attendeeIds', () => {
	it('carries the call attendees so the UI can offer them as owners', () => {
		const out = scopeSessionActions([sug('a', 'c1', null)], calls, clients, scope);
		expect(out[0].attendeeIds).toEqual(['me']);
	});

	it('is empty when the call is missing', () => {
		const out = scopeSessionActions([sug('mine', 'nope', 'me@example.com')], calls, clients, scope);
		expect(out[0].attendeeIds).toEqual([]);
	});
});

describe('groupSessionActions', () => {
	it('groups by call in first-seen order and keeps each group\'s suggestions in order', () => {
		const out = scopeSessionActions(
			[sug('a', 'c1', null), sug('b', 'c2', null), sug('c', 'c1', null)],
			calls,
			clients,
			scope,
		);
		// scope sorts newest call first: c2 (Sep 12) then c1 (Sep 10).
		const groups = groupSessionActions(out);
		expect(groups.map((g) => g.callId)).toEqual(['c2', 'c1']);
		expect(groups[1].actions.map((a) => a.id)).toEqual(['a', 'c']);
		expect(groups[1].clientName).toBe('Acme');
		expect(groups[1].callType).toBe('client');
		expect(groups[1].occurredAt).toBe('2026-09-10T10:00:00Z');
		expect(groups[0].clientName).toBeNull();
	});

	it('is empty for no actions', () => {
		expect(groupSessionActions([])).toEqual([]);
	});
});
