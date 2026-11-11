import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStage } from './status';
import { countsTowardGoal, isLive, stageColor, stageOf } from './status';

// Drift guard for the Media Opportunities Status vocabulary. When a Status
// value is not in the map it falls to 'unmapped', counts toward no goal and
// renders a gray chip — that is how the Media counters once showed 0 · 0 · 0
// over rows visibly reading "Secured Coverage" (an en-dash spelling of
// "Live - Pending Client Approval" was the value that fell through).
//
// The 17 entries below are the live Airtable single-select choices, verbatim —
// trailing spaces and ASCII hyphen included. If someone renames a choice in
// Airtable without touching STAGE_BY_STATUS, the first test here goes red.

const LIVE_CHOICES: [string, MediaStage][] = [
	['Secured Coverage', 'secured'],
	['Pending Coverage', 'pitched'],
	['Sent Product', 'secured'],
	['Scheduled', 'secured'],
	['Product Request', 'secured'],
	['Media Decline', 'media_lost'],
	['Canceled', 'media_lost'],
	['Not Fit', 'media_lost'],
	['Client Decline', 'client_lost'],
	['Media Unresponsive', 'media_lost'],
	['Waiting to go Live', 'secured'],
	['Paid Opp', 'secured'],
	['Warm lead (responded) ', 'secured'],
	['Future Consideration ', 'pitched'],
	['Live - Pending Client Approval', 'secured'],
	['Client Unresponsive', 'client_lost'],
	['Client Missed Deadline', 'client_lost'],
];

// stageOf warns once per distinct unknown value. Silence it so the deliberate
// unmapped assertions do not noise the run.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	warn.mockRestore();
});

describe('status vocabulary coverage', () => {
	it('maps every one of the 17 live Airtable choices to a real stage', () => {
		expect(LIVE_CHOICES).toHaveLength(17);
		const unmapped = LIVE_CHOICES.filter(([value]) => stageOf(value) === 'unmapped').map(
			([value]) => value,
		);
		expect(unmapped).toEqual([]);
	});

	it('maps each choice to its expected stage', () => {
		for (const [value, stage] of LIVE_CHOICES) {
			expect(stageOf(value), value).toBe(stage);
		}
	});

	it('returns unmapped for a genuinely unknown value', () => {
		expect(stageOf('Ghosted By Editor')).toBe('unmapped');
		expect(stageOf(undefined)).toBe('unmapped');
		expect(stageOf('')).toBe('unmapped');
	});

	it('warns once per distinct unknown value', () => {
		stageOf('Totally Novel Status A');
		stageOf('Totally Novel Status A');
		const calls = warn.mock.calls.filter((c: unknown[]) =>
			String(c[0]).includes('Totally Novel Status A'),
		);
		expect(calls).toHaveLength(1);
	});
});

describe('normalization', () => {
	it('folds dash variants of "Live - Pending Client Approval" to secured', () => {
		expect(stageOf('Live - Pending Client Approval')).toBe('secured'); // ASCII hyphen
		expect(stageOf('Live – Pending Client Approval')).toBe('secured'); // en-dash (the break)
		expect(stageOf('Live — Pending Client Approval')).toBe('secured'); // em-dash
		expect(stageOf('Live − Pending Client Approval')).toBe('secured'); // minus sign
	});

	it('folds a trailing space and a re-cased option', () => {
		expect(stageOf('Live - Pending Client Approval ')).toBe('secured');
		expect(stageOf('live - pending client approval')).toBe('secured');
		expect(stageOf('LIVE - PENDING CLIENT APPROVAL')).toBe('secured');
		expect(stageOf('warm lead (responded)')).toBe('secured');
	});
});

describe('countsTowardGoal', () => {
	it('counts secured and client_lost only', () => {
		for (const [value, stage] of LIVE_CHOICES) {
			const expected = stage === 'secured' || stage === 'client_lost';
			expect(countsTowardGoal(value), value).toBe(expected);
		}
	});

	it('does not count a pitch, a media-side loss, or an unknown value', () => {
		expect(countsTowardGoal('Pending Coverage')).toBe(false);
		expect(countsTowardGoal('Not Fit')).toBe(false);
		expect(countsTowardGoal('Ghosted By Editor')).toBe(false);
		expect(countsTowardGoal(undefined)).toBe(false);
	});
});

describe('stageColor', () => {
	it('paints one color per stage', () => {
		expect(stageColor('Secured Coverage')).toBe('success');
		expect(stageColor('Pending Coverage')).toBe('warning');
		expect(stageColor('Client Decline')).toBe('danger');
		expect(stageColor('Media Decline')).toBe('danger');
		expect(stageColor('Ghosted By Editor')).toBe('default');
		expect(stageColor(undefined)).toBe('default');
	});
});

describe('isLive', () => {
	it('is a property of the Live Link, not of the status', () => {
		expect(isLive('https://outlet.com/story')).toBe(true);
		expect(isLive('')).toBe(false);
		expect(isLive('   ')).toBe(false);
		expect(isLive(undefined)).toBe(false);
	});
});
