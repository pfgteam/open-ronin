import { describe, expect, it } from 'vitest';
import { loadLastActivity, summarizeRep } from './repToday';
import type { MyDayRow } from './server';

const NOW = new Date('2026-10-15T15:00:00Z');
let n = 0;
const r = (p: Partial<MyDayRow>): MyDayRow => ({
	deal_id: String(n++), title: 't', stage_name: 's', pipeline_slug: 'closer', lane: 'closer', person_name: null, brand_name: null,
	heat_score: null, quality_score: null, routing: null, next_action: null, next_action_at: null, created_at: '2026-10-01T00:00:00Z',
	stage_entered_at: '2026-10-01T00:00:00Z', sla_hours: null, delay_until: null, value_cents: 0, phone: null, email: null, score: 0, reason: 'next up', ...p,
});

describe('summarizeRep', () => {
	it('counts queue, slow new leads, overdue and no next action', () => {
		const rows = [
			r({ reason: 'new lead', created_at: '2026-10-15T14:00:00Z' }),
			r({ next_action_at: '2026-10-14T00:00:00Z' }),
			r({}),
			r({ next_action_at: '2026-10-20T00:00:00Z' }),
		];
		expect(summarizeRep(rows, NOW, 5)).toEqual({ queue: 4, slowNew: 1, overdue: 1, noNext: 1 });
	});
});

describe('loadLastActivity', () => {
	// Activities newest-first per actor; a busy setter has 600 rows today, the closer one row two days ago.
	const rows: Record<string, { actor_id: string; kind: string; occurred_at: string }[]> = {
		setter: Array.from({ length: 600 }, (_, i) => ({ actor_id: 'setter', kind: 'call', occurred_at: `2026-10-15T14:${String(59 - (i % 60)).padStart(2, '0')}:00Z` })),
		closer: [{ actor_id: 'closer', kind: 'meeting', occurred_at: '2026-10-13T18:00:00Z' }],
	};
	function db() {
		return {
			from: () => {
				let actor: string | null = null;
				let actors: string[] = [];
				let lim = Infinity;
				const q = {
					select: () => q,
					eq: (_c: string, v: string) => { actor = v; return q; },
					in: (_c: string, v: string[]) => { actors = v; return q; },
					order: () => q,
					limit: (n: number) => { lim = n; return q; },
					then: (r: (v: unknown) => void) => {
						const all = actor ? rows[actor] ?? [] : actors.flatMap((a) => rows[a] ?? []).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
						r({ data: all.slice(0, lim), error: null });
					},
				};
				return q;
			},
		} as never;
	}
	it('finds every rep’s latest activity even when a busy rep floods the team feed', async () => {
		const last = await loadLastActivity(db(), ['setter', 'closer']);
		expect(last.get('closer')).toEqual({ kind: 'meeting', occurred_at: '2026-10-13T18:00:00Z' });
		expect(last.get('setter')?.kind).toBe('call');
	});
});
