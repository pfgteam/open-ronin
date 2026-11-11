import { describe, expect, it } from 'vitest';
import { latestAnalysisPerCall, scoreBand } from './analysis';

describe('scoreBand', () => {
	it('maps 8 and above to good', () => {
		expect(scoreBand(8)).toBe('good');
		expect(scoreBand(10)).toBe('good');
	});
	it('maps 5–7.9 to ok', () => {
		expect(scoreBand(5)).toBe('ok');
		expect(scoreBand(7.9)).toBe('ok');
	});
	it('maps below 5 to low', () => {
		expect(scoreBand(4.99)).toBe('low');
		expect(scoreBand(0)).toBe('low');
	});
});

describe('latestAnalysisPerCall', () => {
	it('keeps only the newest row per call', () => {
		const rows = [
			{ call_id: 'a', created_at: '2026-08-01T00:00:00Z', id: 1 },
			{ call_id: 'a', created_at: '2026-08-02T00:00:00Z', id: 2 },
			{ call_id: 'b', created_at: '2026-08-01T00:00:00Z', id: 3 },
		];
		const m = latestAnalysisPerCall(rows);
		expect(m.get('a')?.id).toBe(2);
		expect(m.get('b')?.id).toBe(3);
		expect(m.size).toBe(2);
	});
	it('is insensitive to input order', () => {
		const rows = [
			{ call_id: 'a', created_at: '2026-08-02T00:00:00Z', id: 2 },
			{ call_id: 'a', created_at: '2026-08-01T00:00:00Z', id: 1 },
		];
		expect(latestAnalysisPerCall(rows).get('a')?.id).toBe(2);
	});
});
