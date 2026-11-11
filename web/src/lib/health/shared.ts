// Health score vocabulary — pure (no server imports) so the /clients/[id]
// header, the health tab, the MCP mapper and tests can all share it.
//
// health_scores (0002/0042) keys on airtable_contract_id; the UI keys on
// clients_v2.id, so a client's score is read THROUGH its contracts
// (client_id -> airtable_contract_id[]) and the primary contract's row is the
// one shown. factor_breakdown is the jsonb compute_health_scores() writes.

export type FactorKey =
	| 'engagement'
	| 'opps_vs_goal'
	| 'payment_timeliness'
	| 'package_adherence'
	| 'satisfaction'
	| 'quality_of_opp';

export const FACTOR_KEYS: FactorKey[] = [
	'engagement',
	'opps_vs_goal',
	'payment_timeliness',
	'package_adherence',
	'satisfaction',
	'quality_of_opp',
];

export interface FactorCell {
	measured: boolean;
	value: number | null;
	weight_pct: number;
	note?: string | null;
}

export interface FactorBreakdown {
	factors: Partial<Record<FactorKey, FactorCell>>;
	coverage: { measured_count: number; total_count: number; weight_measured_pct: number };
}

export interface HealthScoreRow {
	airtable_contract_id: string;
	period_month: string; // YYYY-MM-01
	total_score: number | string | null; // numeric comes back as string from PostgREST
	computed_at: string;
	factor_breakdown: FactorBreakdown | null;
}

/** Where each factor's signal comes from and what still blocks it (Sept 2026). */
export interface FactorMeta {
	key: FactorKey;
	label: string;
	description: string;
	/** Why an unmeasured cell is unmeasured today, when the engine's own note is generic. */
	pending: string | null;
	future?: boolean;
	defaultWeight: number;
}

export const FACTOR_META: FactorMeta[] = [
	{
		key: 'engagement',
		label: 'Client engagement',
		description: 'Call attendance and response cadence from client_engagement.',
		pending: 'Waiting on a caller for POST /api/ingest/health/engagement — nothing feeds client_engagement yet.',
		defaultWeight: 25,
	},
	{
		key: 'opps_vs_goal',
		label: 'Opps vs goal',
		description: 'Media opps secured this month against the package quota or the goal row.',
		pending: 'Fed daily by /api/cron/opp-months (client_opp_months); unmeasured until the first sync lands for this month.',
		defaultWeight: 25,
	},
	{
		key: 'payment_timeliness',
		label: 'Payment timeliness',
		description: 'On-time rate over the trailing six months of payments (late = due + 10 days).',
		pending: 'No payments in the trailing six months for this contract.',
		defaultWeight: 15,
	},
	{
		key: 'package_adherence',
		label: 'Package adherence',
		description: 'Did we deliver everything the package commits to this month?',
		pending: 'Waiting on deliverables normalization (client_meta / deliverables mirror).',
		defaultWeight: 15,
	},
	{
		key: 'satisfaction',
		label: 'Client satisfaction',
		description: 'NPS and rated-call sentiment from client_satisfaction.',
		pending: 'Waiting on a caller for POST /api/ingest/health/satisfaction — no rated calls in period.',
		defaultWeight: 15,
	},
	{
		key: 'quality_of_opp',
		label: 'Quality of media opp',
		description: 'AI-scored coverage quality (tier, reach, sentiment).',
		pending: 'ai:future — not scheduled.',
		future: true,
		defaultWeight: 5,
	},
];

export function scoreNumber(v: number | string | null | undefined): number | null {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

export function currentMonthKey(now: Date = new Date()): string {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Rendered row per factor: engine cell merged with the static meta. */
export interface FactorView extends FactorMeta {
	measured: boolean;
	value: number | null;
	weight_pct: number;
	note: string | null;
}

export function factorViews(breakdown: FactorBreakdown | null | undefined): FactorView[] {
	return FACTOR_META.map((meta) => {
		const cell = breakdown?.factors?.[meta.key];
		return {
			...meta,
			measured: !!cell?.measured && cell.value != null,
			value: cell?.value ?? null,
			weight_pct: cell?.weight_pct ?? meta.defaultWeight,
			note: cell?.note ?? null,
		};
	});
}

export interface ClientHealth {
	/** Contract whose score is shown (the primary one). */
	airtable_contract_id: string;
	period_month: string;
	is_current_month: boolean;
	total_score: number | null;
	computed_at: string;
	coverage: FactorBreakdown['coverage'] | null;
	factors: FactorView[];
}

/**
 * Pick the score to show for a client from its health_scores rows across all
 * of its contracts. Preference: the primary contract's row for the current
 * month; else the primary's latest; else any contract's latest.
 */
export function pickClientHealth(
	rows: HealthScoreRow[],
	primaryAirtableId: string | null,
	now: Date = new Date(),
): ClientHealth | null {
	if (rows.length === 0) return null;
	const month = currentMonthKey(now);
	const sorted = [...rows].sort((a, b) => b.period_month.localeCompare(a.period_month));
	const primaryRows = primaryAirtableId ? sorted.filter((r) => r.airtable_contract_id === primaryAirtableId) : [];
	const chosen = primaryRows.find((r) => r.period_month === month) ?? primaryRows[0] ?? sorted[0];
	return {
		airtable_contract_id: chosen.airtable_contract_id,
		period_month: chosen.period_month,
		is_current_month: chosen.period_month === month,
		total_score: scoreNumber(chosen.total_score),
		computed_at: chosen.computed_at,
		coverage: chosen.factor_breakdown?.coverage ?? null,
		factors: factorViews(chosen.factor_breakdown),
	};
}

export function healthTone(score: number | null): 'success' | 'warning' | 'danger' | 'default' {
	if (score == null) return 'default';
	if (score >= 75) return 'success';
	if (score >= 50) return 'warning';
	return 'danger';
}
