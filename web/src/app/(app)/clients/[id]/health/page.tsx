// /clients/[id]/health — the computed health score for this client, read
// through its contracts (client_id -> airtable_contract_id) because
// health_scores (0002/0042) still keys on the Airtable contract id.
//
// Renders: current-month score + coverage, the 6-factor breakdown with
// measured / unmeasured per factor (and WHY it is unmeasured today), the
// score history for the primary contract, and the manual Airtable value as
// a fallback while coverage is thin.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { requireClient, healthColor, healthBand, formatHealth, hasHealth } from '../_lib';
import { getClientHealth, getClientHealthHistory } from '@/lib/health/server';
import { healthTone, scoreNumber, type FactorKey } from '@/lib/health/shared';
import { formatDate, formatRelative } from '@/lib/format';
import {
	Activity,
	CreditCard,
	Target,
	Smile,
	Package,
	Sparkles,
	AlertCircle,
	type LucideIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
}

const ICONS: Record<FactorKey, LucideIcon> = {
	engagement: Activity,
	opps_vs_goal: Target,
	payment_timeliness: CreditCard,
	package_adherence: Package,
	satisfaction: Smile,
	quality_of_opp: Sparkles,
};

function monthLabel(iso: string): string {
	return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default async function HealthPage({ params }: PageProps) {
	const { id } = await params;
	const ctx = await requireClient(id, '/health');
	const f = ctx.fields;
	const [health, history] = await Promise.all([getClientHealth(ctx.clientId), getClientHealthHistory(ctx.clientId, 12)]);

	return (
		<div className="space-y-4">
			{/* Computed score — honest about coverage: unmeasured is not unhealthy */}
			<Card>
				<div className="flex items-start justify-between gap-4">
					<div>
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<Activity className="w-4 h-4 text-slate-400" />
							Computed health
						</h3>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
							{health ? (
								<>
									{health.coverage
										? `${health.coverage.measured_count} of ${health.coverage.total_count} factors measured · ${health.coverage.weight_measured_pct}% of weight`
										: 'Coverage unavailable'}
									{' · '}
									{monthLabel(health.period_month)}
									{health.is_current_month ? '' : ' (latest available; no current-month row yet)'}
									{' · computed '}
									{formatRelative(health.computed_at)}
								</>
							) : ctx.airtableId ? (
								'No score has been computed for this client yet. The daily /api/cron/health-scores run scores active, hold and 60-day contracts.'
							) : (
								'This client has no contract on file, so there is nothing to score.'
							)}
						</p>
						{ctx.contracts.length > 1 && health && (
							<p className="text-2xs text-slate-400 mt-1">
								Scored on the primary contract ({health.airtable_contract_id}); this client holds {ctx.contracts.length} contracts.
							</p>
						)}
					</div>
					{health?.total_score != null ? (
						<div className="flex items-center gap-2">
							<span className="text-3xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
								{health.total_score}
							</span>
							<Badge color={healthTone(health.total_score)}>
								{health.total_score >= 75 ? 'Healthy' : health.total_score >= 50 ? 'Watch' : 'At risk'}
							</Badge>
						</div>
					) : (
						<Badge color="default">Unmeasured</Badge>
					)}
				</div>
			</Card>

			{/* Factor breakdown */}
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						Factor breakdown
					</h3>
					<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
						Weights come from <code>health_factors</code> / <code>health_package_weights</code> (tuned at <code>/admin/health-factors</code>).
						The score is the weighted mean of the MEASURED factors only; an unmeasured factor neither helps nor hurts.
					</p>
				</div>
				<div className="divide-y divide-slate-200 dark:divide-slate-700">
					{(health?.factors ?? []).map((fac) => {
						const Icon = ICONS[fac.key];
						return (
							<div key={fac.key} className="px-4 py-3 flex items-start justify-between gap-4">
								<div className="flex gap-3 min-w-0 flex-1">
									<div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
										<Icon className="w-3.5 h-3.5 text-slate-500" />
									</div>
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<p className="text-sm font-medium text-slate-900 dark:text-slate-100">{fac.label}</p>
											{fac.measured ? (
												<Badge color="success">measured</Badge>
											) : fac.future ? (
												<Badge color="warning">later</Badge>
											) : (
												<Badge color="default">unmeasured</Badge>
											)}
										</div>
										<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{fac.description}</p>
										{!fac.measured && (
											<p className="text-2xs text-amber-700 dark:text-amber-400 mt-0.5">
												{fac.note && fac.note !== 'ai:future' ? `Engine: ${fac.note}. ` : ''}
												{fac.pending}
											</p>
										)}
									</div>
								</div>
								<div className="text-right shrink-0">
									<div className="text-xs text-slate-400">{fac.measured ? 'Score' : 'Weight'}</div>
									<div className="text-sm font-mono font-medium text-slate-900 dark:text-slate-100">
										{fac.measured ? fac.value : '—'}
										<span className="text-slate-400"> · {fac.weight_pct}%</span>
									</div>
								</div>
							</div>
						);
					})}
					{!health && (
						<div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
							No factor data until the first score is computed.
						</div>
					)}
				</div>
			</Card>

			{/* History */}
			{history.length > 1 && (
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Score history</h3>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Primary contract, newest first.</p>
					</div>
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
								<th className="px-4 py-2 font-medium">Month</th>
								<th className="px-4 py-2 font-medium text-right">Score</th>
								<th className="px-4 py-2 font-medium text-right">Measured</th>
								<th className="px-4 py-2 font-medium">Computed</th>
							</tr>
						</thead>
						<tbody>
							{history.map((h) => {
								const score = scoreNumber(h.total_score);
								const cov = h.factor_breakdown?.coverage;
								return (
									<tr key={h.period_month} className="border-b border-slate-200 dark:border-slate-700">
										<td className="px-4 py-2 text-slate-700 dark:text-slate-300">{monthLabel(h.period_month)}</td>
										<td className="px-4 py-2 text-right font-mono">
											{score != null ? <Badge color={healthTone(score)}>{score}</Badge> : <span className="text-slate-400">—</span>}
										</td>
										<td className="px-4 py-2 text-right text-slate-500">{cov ? `${cov.measured_count}/${cov.total_count}` : '—'}</td>
										<td className="px-4 py-2 text-slate-500">{formatDate(h.computed_at)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</Card>
			)}

			{/* Manual Airtable value — kept while coverage is thin */}
			<Card>
				<div className="flex items-start justify-between gap-4">
					<div>
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<Activity className="w-4 h-4 text-slate-400" />
							Manual health (Airtable)
						</h3>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
							The hand-set Client Health field on the Contract Agreement · superseded by the computed score as factors come online.
						</p>
					</div>
					{hasHealth(f['Client Health']) ? (
						<div className="flex items-center gap-2">
							<span className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
								{formatHealth(f['Client Health'])}
							</span>
							<Badge color={healthColor(f['Client Health'])}>{healthBand(f['Client Health'])}</Badge>
						</div>
					) : (
						<span className="text-sm text-slate-400">Not set</span>
					)}
				</div>
			</Card>

			{/* What is still missing */}
			<Card className="border-dashed">
				<div className="flex gap-3">
					<AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
					<div className="text-sm text-slate-600 dark:text-slate-400">
						<p className="text-slate-900 dark:text-slate-100 font-medium mb-1">Signal status (Sept 2026)</p>
						<ul className="list-disc list-inside space-y-1 text-xs">
							<li><strong>payment_timeliness</strong> — measured from the payments mirror.</li>
							<li><strong>opps_vs_goal</strong> — fed daily by <code>/api/cron/opp-months</code>; measured once the current month syncs.</li>
							<li><strong>engagement</strong> / <strong>satisfaction</strong> — ingest endpoints exist (<code>/api/ingest/health/*</code>) but nothing calls them yet.</li>
							<li><strong>package_adherence</strong> — waits on deliverables normalization.</li>
							<li><strong>quality_of_opp</strong> — AI scoring, not scheduled.</li>
						</ul>
					</div>
				</div>
			</Card>
		</div>
	);
}
