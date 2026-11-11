import { describe, expect, it } from 'vitest';
import { HEAT_LABELS, REASON_LABELS, heatLevel } from './shared';

describe('heatLevel', () => {
	it('uses the rev_my_day "hot" line (>= 10) and a warm band from 4', () => {
		expect(heatLevel(40)).toBe('hot');
		expect(heatLevel(10)).toBe('hot');
		expect(heatLevel(9)).toBe('warm');
		expect(heatLevel(4)).toBe('warm');
		expect(heatLevel(3)).toBe('cold');
		expect(heatLevel(null)).toBe('cold');
		expect(heatLevel(undefined)).toBe('cold');
	});
	it('labels every level', () => {
		expect(HEAT_LABELS).toEqual({ hot: 'Hot', warm: 'Warm', cold: 'Cold' });
	});
});

describe('REASON_LABELS', () => {
	it('covers every reason rev_my_day emits', () => {
		for (const r of ['new lead', 'follow-up overdue', 'due today', 'SLA breached', 'on delay', 'hot', 'next up']) {
			expect(REASON_LABELS[r]).toBeTruthy();
		}
	});
});
