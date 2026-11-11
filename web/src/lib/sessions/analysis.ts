// Pure helpers for Sessions. NO Date.now(), no I/O — everything derives from
// arguments so it is testable and the list/detail/ranking pages agree.

export type CallAnalysisDimension = { dimension: string; score: number; note: string };
export type AttentionPoint = { severity: 'info' | 'warning' | 'critical'; point: string };

export type ScoreBand = 'good' | 'ok' | 'low';

/** ≥8 good · 5–7.9 ok · <5 low — the one banding used everywhere. */
export function scoreBand(score: number): ScoreBand {
	if (score >= 8) return 'good';
	if (score >= 5) return 'ok';
	return 'low';
}

export const SCORE_BAND_BADGE: Record<ScoreBand, 'success' | 'default' | 'danger'> = {
	good: 'success',
	ok: 'default',
	low: 'danger',
};

/** Newest analysis per call, regardless of input order. */
export function latestAnalysisPerCall<T extends { call_id: string; created_at: string }>(
	rows: T[],
): Map<string, T> {
	const m = new Map<string, T>();
	for (const r of rows) {
		const seen = m.get(r.call_id);
		if (!seen || r.created_at > seen.created_at) m.set(r.call_id, r);
	}
	return m;
}
