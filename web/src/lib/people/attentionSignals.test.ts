import { describe, expect, it } from 'vitest';
import {
	computeAttentionSignals,
	pulseTone,
	LOW_SCORE,
	STREAK_WEEKS,
	MIN_DROP,
	type WeekPoint,
} from './attentionSignals';

// Helper: build a newest-first contiguous series from averages.
// `null` = the week exists on the calendar but nothing was submitted.
const series = (...averages: Array<number | null>): WeekPoint[] =>
	averages.map((average, i) => ({ weekEnd: `2026-08-${String(21 - i * 7).padStart(2, '0')}`, average }));

describe('computeAttentionSignals', () => {
	it('flags nothing for an empty series', () => {
		const s = computeAttentionSignals([]);
		expect(s.needsAttention).toBe(false);
		expect(s.latestAverage).toBeNull();
		expect(s.trend).toBeNull();
		expect(s.reasons).toEqual([]);
	});

	it('flags nothing when every week is healthy', () => {
		const s = computeAttentionSignals(series(4.3, 4.0, 4.5, 4.1, 4.2, 4.4, 4.0, 4.6));
		expect(s.needsAttention).toBe(false);
		expect(s.streakLength).toBe(0);
	});

	it('flags the latest week alone when it dips below the threshold', () => {
		const s = computeAttentionSignals(series(2.0, 4.0, 4.2));
		expect(s.lowLatest).toBe(true);
		expect(s.strugglingStreak).toBe(false);
		expect(s.streakLength).toBe(1);
		expect(s.needsAttention).toBe(true);
		expect(s.reasons[0]).toContain('Latest week at 2');
	});

	it('does not flag a low week that is not the latest', () => {
		const s = computeAttentionSignals(series(4.2, 1.5, 4.0));
		expect(s.lowLatest).toBe(false);
		expect(s.strugglingStreak).toBe(false);
		expect(s.streakLength).toBe(0);
	});

	it('flags a struggling streak at STREAK_WEEKS consecutive low weeks', () => {
		const s = computeAttentionSignals(series(2.0, 2.2, 4.0));
		expect(s.streakLength).toBe(STREAK_WEEKS);
		expect(s.strugglingStreak).toBe(true);
		expect(s.reasons[0]).toBe(`2 weeks in a row below ${LOW_SCORE}`);
	});

	// The rule the plan calls out in bold: a week nobody submitted is MISSING.
	// It is not a low score, so it must END the run rather than extend it.
	it('BREAKS the streak on a missing week instead of counting it as low', () => {
		const s = computeAttentionSignals(series(2.0, null, 2.1, 2.2));
		expect(s.streakLength).toBe(1);
		expect(s.strugglingStreak).toBe(false);
		expect(s.lowLatest).toBe(true); // the latest week with data is still low
	});

	it('treats a leading missing week as no data, not as a zero', () => {
		const s = computeAttentionSignals(series(null, 4.5, 4.2));
		expect(s.latestAverage).toBe(4.5);
		expect(s.lowLatest).toBe(false);
		expect(s.streakLength).toBe(0);
		expect(s.needsAttention).toBe(false);
	});

	it('never lets missing weeks alone trigger attention', () => {
		const s = computeAttentionSignals(series(null, null, null, null));
		expect(s.needsAttention).toBe(false);
		expect(s.latestAverage).toBeNull();
	});

	it('flags a declining trend when the recent window falls by MIN_DROP', () => {
		// recent 4 weeks avg 3.0, previous 4 weeks avg 4.0 -> drop 1.0
		const s = computeAttentionSignals(series(3.0, 3.0, 3.0, 3.0, 4.0, 4.0, 4.0, 4.0));
		expect(s.trend).toEqual({ recent: 3, previous: 4, drop: 1 });
		expect(s.decliningTrend).toBe(true);
		expect(s.needsAttention).toBe(true);
		expect(s.reasons.some((r) => r.includes('Down 1'))).toBe(true);
	});

	it('ignores a drop smaller than MIN_DROP', () => {
		const s = computeAttentionSignals(series(3.8, 3.8, 3.8, 3.8, 4.0, 4.0, 4.0, 4.0));
		expect(s.trend?.drop).toBeLessThan(MIN_DROP);
		expect(s.decliningTrend).toBe(false);
		expect(s.needsAttention).toBe(false);
	});

	it('claims no trend when a window lacks enough data points', () => {
		// previous window has a single data point — not enough to compare against
		const s = computeAttentionSignals(series(3.0, 3.0, 3.0, 3.0, 4.5, null, null, null));
		expect(s.trend).toBeNull();
		expect(s.decliningTrend).toBe(false);
	});

	it('computes the trend from real data only, skipping missing weeks', () => {
		// recent window: 3.0 and 3.0 (two nulls skipped); previous: 4.5 and 4.5
		const s = computeAttentionSignals(series(3.0, null, 3.0, null, 4.5, 4.5, null, null));
		expect(s.trend).toEqual({ recent: 3, previous: 4.5, drop: 1.5 });
		expect(s.decliningTrend).toBe(true);
	});

	it('ignores an improvement (negative drop)', () => {
		const s = computeAttentionSignals(series(4.5, 4.5, 4.5, 4.5, 3.0, 3.0, 3.0, 3.0));
		expect(s.trend?.drop).toBe(-1.5);
		expect(s.decliningTrend).toBe(false);
		expect(s.needsAttention).toBe(false);
	});

	it('reports the streak reason instead of the latest-week one when both apply', () => {
		const s = computeAttentionSignals(series(2.0, 2.0, 2.0, 4.0));
		expect(s.reasons).toHaveLength(1);
		expect(s.reasons[0]).toBe(`3 weeks in a row below ${LOW_SCORE}`);
	});

	it('treats exactly LOW_SCORE as not-low (strictly below is the rule)', () => {
		const s = computeAttentionSignals(series(LOW_SCORE, LOW_SCORE));
		expect(s.lowLatest).toBe(false);
		expect(s.streakLength).toBe(0);
	});

	it('rounds reported averages to one decimal', () => {
		const s = computeAttentionSignals(series(4.06666, 4.0));
		expect(s.latestAverage).toBe(4.1);
	});
});

describe('pulseTone', () => {
	it('keeps missing as its own state, never a score', () => {
		expect(pulseTone(null)).toBe('missing');
	});

	it('buckets scores', () => {
		expect(pulseTone(1)).toBe('low');
		expect(pulseTone(2.4)).toBe('low');
		expect(pulseTone(2.5)).toBe('mid');
		expect(pulseTone(3.9)).toBe('mid');
		expect(pulseTone(4)).toBe('high');
		expect(pulseTone(5)).toBe('high');
	});
});
