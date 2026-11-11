import { describe, it, expect } from 'vitest';
import { worstActiveHealth, type HealthChild } from './goalHealth';

const child = (health: HealthChild['health'], isTerminal = false): HealthChild => ({ health, isTerminal });

describe('worstActiveHealth', () => {
	it('returns null for no children at all', () => {
		expect(worstActiveHealth([])).toBeNull();
	});

	it('returns null when every active child has no health', () => {
		expect(worstActiveHealth([child(null), child(null)])).toBeNull();
	});

	it('returns the only health when a single active child has one', () => {
		expect(worstActiveHealth([child('at_risk')])).toBe('at_risk');
	});

	it('lets off_track beat at_risk', () => {
		expect(worstActiveHealth([child('at_risk'), child('off_track')])).toBe('off_track');
		expect(worstActiveHealth([child('off_track'), child('at_risk')])).toBe('off_track');
	});

	it('lets at_risk beat on_track', () => {
		expect(worstActiveHealth([child('on_track'), child('at_risk')])).toBe('at_risk');
		expect(worstActiveHealth([child('at_risk'), child('on_track')])).toBe('at_risk');
	});

	it('lets off_track beat on_track', () => {
		expect(worstActiveHealth([child('on_track'), child('off_track'), child('on_track')])).toBe('off_track');
	});

	it('returns on_track only when every active child with a health is on_track', () => {
		expect(worstActiveHealth([child('on_track'), child(null), child('on_track')])).toBe('on_track');
	});

	it('ignores terminal children entirely — a done child cannot drag the goal down', () => {
		expect(worstActiveHealth([child('on_track'), child('off_track', true)])).toBe('on_track');
	});

	it('returns null when the only child carrying a health is terminal', () => {
		expect(worstActiveHealth([child('off_track', true), child(null)])).toBeNull();
	});

	it('does not mutate the input array', () => {
		const children = [child('on_track'), child('off_track')];
		const snapshot = JSON.parse(JSON.stringify(children));
		worstActiveHealth(children);
		expect(children).toEqual(snapshot);
	});
});
