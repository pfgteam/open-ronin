import { describe, expect, it } from 'vitest';
import { buildLogFields, patchAfterLog, type LogState } from './logPayload';

const base: LogState = { kind: 'call', outcome: 'disp-1', note: 'Talked budget', subject: '', inbound: false, positive: true, next: 'Follow up', when: null, clearNext: false };
const self = { dealId: 'deal-1', personId: 'person-1', originalNext: 'Follow up', extended: false };

describe('buildLogFields', () => {
	it('posts exactly what Self → Sales posted, minus the untouched next action (the bug fix)', () => {
		expect(buildLogFields(base, self)).toEqual({ deal_id: 'deal-1', person_id: 'person-1', kind: 'call', direction: 'outbound', disposition_id: 'disp-1', body_md: 'Talked budget', is_positive: 'yes' });
	});
	it('sends the next action text only when the rep edited it', () => {
		const f = buildLogFields({ ...base, next: 'Send deck' }, self);
		expect(f.next_action).toBe('Send deck');
		expect(f).not.toHaveProperty('next_action_at');
	});
	it('sends the time when one was picked', () => {
		expect(buildLogFields({ ...base, when: new Date('2026-10-22T14:00:00Z') }, self).next_action_at).toBe('2026-10-22T14:00:00.000Z');
	});
	it('"No next step" sends clear_next and neither next field', () => {
		const f = buildLogFields({ ...base, next: 'Other', when: new Date('2026-10-22T14:00:00Z'), clearNext: true }, self);
		expect(f.clear_next).toBe('yes');
		expect(f).not.toHaveProperty('next_action');
		expect(f).not.toHaveProperty('next_action_at');
	});
	it('meetings are inbound and notes are internal', () => {
		expect(buildLogFields({ ...base, kind: 'meeting', outcome: null }, self).direction).toBe('inbound');
		expect(buildLogFields({ ...base, kind: 'note', outcome: null }, self).direction).toBe('internal');
	});
	it('the extended form can mark an email inbound and send a subject', () => {
		const ext = { ...self, extended: true };
		const f = buildLogFields({ ...base, kind: 'email', outcome: null, inbound: true, subject: 'Pricing' }, ext);
		expect(f.direction).toBe('inbound');
		expect(f.subject).toBe('Pricing');
	});
	it('the Self form never sends a subject or an inbound flag', () => {
		const f = buildLogFields({ ...base, kind: 'email', outcome: null, inbound: true, subject: 'Pricing' }, self);
		expect(f.direction).toBe('outbound');
		expect(f).not.toHaveProperty('subject');
	});
	it('a deal without a primary person sends no person_id', () => {
		expect(buildLogFields(base, { ...self, personId: null })).not.toHaveProperty('person_id');
	});
});

describe('patchAfterLog', () => {
	const prev = { next_action: 'Follow up', next_action_at: '2026-10-21T15:00:00.000Z' };
	it('leaves the row alone when the next step was not touched', () => {
		expect(patchAfterLog(base, prev)).toEqual({});
	});
	it('updates only the text when only the text changed', () => {
		expect(patchAfterLog({ ...base, next: 'Send deck' }, prev)).toEqual({ next_action: 'Send deck' });
	});
	it('clears both on "No next step"', () => {
		expect(patchAfterLog({ ...base, clearNext: true }, prev)).toEqual({ next_action: null, next_action_at: null });
	});
	it('updates the time when one was picked', () => {
		expect(patchAfterLog({ ...base, when: new Date('2026-10-22T14:00:00Z') }, prev)).toEqual({ next_action_at: '2026-10-22T14:00:00.000Z' });
	});
});
