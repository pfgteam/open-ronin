import { describe, expect, it } from 'vitest';
import { isTwoPartyState, releaseGateBlocks, TWO_PARTY_STATES } from './shared';

describe('podcast release gate (mirror of 0111 podcast_two_party_consent_state)', () => {
	it('two-party states need a release; null/unknown fail closed', () => {
		expect(isTwoPartyState('CA')).toBe(true);
		expect(isTwoPartyState('wa')).toBe(true);
		expect(isTwoPartyState('TX')).toBe(false);
		expect(isTwoPartyState(null)).toBe(true);
		expect(isTwoPartyState('')).toBe(true);
		expect(isTwoPartyState('California')).toBe(true);
	});
	it('blocks recorded/editing/published only without a signature', () => {
		expect(releaseGateBlocks('recorded', false, 'CA')).toBe(true);
		expect(releaseGateBlocks('recorded', true, 'CA')).toBe(false);
		expect(releaseGateBlocks('recorded', false, 'TX')).toBe(false);
		expect(releaseGateBlocks('scheduled', false, 'CA')).toBe(false);
		expect(releaseGateBlocks('published', false, null)).toBe(true);
	});
	it('list matches the SQL function', () => {
		expect([...TWO_PARTY_STATES].sort()).toEqual(['CA', 'CT', 'DE', 'FL', 'IL', 'MA', 'MD', 'MI', 'MT', 'NH', 'NV', 'OR', 'PA', 'WA']);
	});
});
