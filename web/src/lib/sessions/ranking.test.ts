import { describe, expect, it } from 'vitest';
import { buildRanking } from './ranking';

const dim = (dimension: string, score: number) => ({ dimension, score, note: '' });

describe('buildRanking', () => {
	it('averages the LATEST analysis per call, per attendee', () => {
		const out = buildRanking({
			calls: [
				{ id: 'c1', attendee_user_ids: ['u1'] },
				{ id: 'c2', attendee_user_ids: ['u1', 'u2'] },
			],
			analyses: [
				{ call_id: 'c1', overall_score: 4, dimensions: [dim('Next steps', 4)], created_at: '2026-08-01T00:00:00Z' },
				{ call_id: 'c1', overall_score: 8, dimensions: [dim('Next steps', 8)], created_at: '2026-08-02T00:00:00Z' },
				{ call_id: 'c2', overall_score: 6, dimensions: [dim('Next steps', 6)], created_at: '2026-08-01T00:00:00Z' },
			],
			pendingByCall: new Map([['c2', 2]]),
		});
		const u1 = out.find((r) => r.userId === 'u1')!;
		expect(u1.calls).toBe(2);
		expect(u1.avgScore).toBe(7); // (8+6)/2 — the superseded 4 must NOT count
		expect(u1.pendingSuggestions).toBe(2);
		const u2 = out.find((r) => r.userId === 'u2')!;
		expect(u2.calls).toBe(1);
		expect(u2.avgScore).toBe(6);
	});
	it('names the worst dimension by average', () => {
		const out = buildRanking({
			calls: [{ id: 'c1', attendee_user_ids: ['u1'] }, { id: 'c2', attendee_user_ids: ['u1'] }],
			analyses: [
				{ call_id: 'c1', overall_score: 7, dimensions: [dim('Agenda', 9), dim('Next steps', 3)], created_at: '2026-08-01T00:00:00Z' },
				{ call_id: 'c2', overall_score: 7, dimensions: [dim('Agenda', 8), dim('Next steps', 5)], created_at: '2026-08-01T00:00:00Z' },
			],
			pendingByCall: new Map(),
		});
		expect(out[0].worstDimension).toEqual({ dimension: 'Next steps', avgScore: 4 });
	});
	it('sorts by average score descending and skips calls with no analysis', () => {
		const out = buildRanking({
			calls: [
				{ id: 'c1', attendee_user_ids: ['u1'] },
				{ id: 'c2', attendee_user_ids: ['u2'] },
				{ id: 'c3', attendee_user_ids: ['u2'] }, // no analysis — not counted
			],
			analyses: [
				{ call_id: 'c1', overall_score: 5, dimensions: [dim('A', 5)], created_at: '2026-08-01T00:00:00Z' },
				{ call_id: 'c2', overall_score: 9, dimensions: [dim('A', 9)], created_at: '2026-08-01T00:00:00Z' },
			],
			pendingByCall: new Map(),
		});
		expect(out.map((r) => r.userId)).toEqual(['u2', 'u1']);
		expect(out.find((r) => r.userId === 'u2')!.calls).toBe(1);
	});
});
