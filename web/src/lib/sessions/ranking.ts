// Pure ranking builder for the Sessions "Ranking" tab. NO Date.now(), no I/O
// — everything derives from arguments, same discipline as analysis.ts.

import { latestAnalysisPerCall, type CallAnalysisDimension } from './analysis';

export interface PersonRanking {
	userId: string;
	calls: number;
	avgScore: number;
	worstDimension: { dimension: string; avgScore: number } | null;
	pendingSuggestions: number;
}

interface RankingCall {
	id: string;
	attendee_user_ids: string[];
}

interface RankingAnalysis {
	call_id: string;
	overall_score: number;
	dimensions: CallAnalysisDimension[];
	created_at: string;
}

/** Rounds to 1 decimal without the classic floating-point drift (e.g. 6.999999). */
function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

export function buildRanking(input: {
	calls: RankingCall[];
	analyses: RankingAnalysis[];
	pendingByCall: Map<string, number>;
}): PersonRanking[] {
	const latestByCall = latestAnalysisPerCall(input.analyses);

	// Per-user accumulators, built only from calls that HAVE a latest analysis
	// — a call with no analysis contributes nothing, not even to the count.
	const byUser = new Map<
		string,
		{ scores: number[]; dimensionTotals: Map<string, { sum: number; count: number }>; pending: number }
	>();

	for (const call of input.calls) {
		const analysis = latestByCall.get(call.id);
		if (!analysis) continue;
		const pending = input.pendingByCall.get(call.id) ?? 0;

		for (const userId of call.attendee_user_ids) {
			let acc = byUser.get(userId);
			if (!acc) {
				acc = { scores: [], dimensionTotals: new Map(), pending: 0 };
				byUser.set(userId, acc);
			}
			acc.scores.push(analysis.overall_score);
			acc.pending += pending;
			for (const d of analysis.dimensions) {
				const dt = acc.dimensionTotals.get(d.dimension) ?? { sum: 0, count: 0 };
				dt.sum += d.score;
				dt.count += 1;
				acc.dimensionTotals.set(d.dimension, dt);
			}
		}
	}

	const rankings: PersonRanking[] = [];
	for (const [userId, acc] of byUser) {
		const avgScore = round1(acc.scores.reduce((s, v) => s + v, 0) / acc.scores.length);

		let worstDimension: PersonRanking['worstDimension'] = null;
		for (const [dimension, { sum, count }] of acc.dimensionTotals) {
			const avg = round1(sum / count);
			if (!worstDimension || avg < worstDimension.avgScore) {
				worstDimension = { dimension, avgScore: avg };
			}
		}

		rankings.push({
			userId,
			calls: acc.scores.length,
			avgScore,
			worstDimension,
			pendingSuggestions: acc.pending,
		});
	}

	rankings.sort((a, b) => b.avgScore - a.avgScore);
	return rankings;
}
