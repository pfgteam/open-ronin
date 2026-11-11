import { describe, expect, it } from 'vitest';
import { nextActionWrite } from './nextAction';

describe('nextActionWrite', () => {
	it('writes nothing when the rep did not touch the next step (the due time survives a log)', () => {
		expect(nextActionWrite({})).toBeNull();
		expect(nextActionWrite({ next_action: null, next_action_at: null })).toBeNull();
	});
	it('changes only the text when only the text was given, keeping the due time', () => {
		expect(nextActionWrite({ next_action: 'Call back' })).toEqual({ next_action: 'Call back' });
	});
	it('changes only the time when only the time was given', () => {
		expect(nextActionWrite({ next_action_at: '2026-10-22T14:00:00.000Z' })).toEqual({ next_action_at: '2026-10-22T14:00:00.000Z' });
	});
	it('writes both when both were given', () => {
		expect(nextActionWrite({ next_action: 'Send deck', next_action_at: '2026-10-22T14:00:00Z' })).toEqual({ next_action: 'Send deck', next_action_at: '2026-10-22T14:00:00.000Z' });
	});
	it('clears both on an explicit "No next step", whatever else came along', () => {
		expect(nextActionWrite({ clear: true, next_action: 'x' })).toEqual({ next_action: null, next_action_at: null });
	});
	it('drops a time that is not a date', () => {
		expect(nextActionWrite({ next_action: 'Call', next_action_at: 'tomorrow-ish' })).toEqual({ next_action: 'Call' });
		expect(nextActionWrite({ next_action_at: 'nope' })).toBeNull();
	});
});
