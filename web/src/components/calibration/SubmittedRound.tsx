// Read-only views of a submitted round (0118): the total and the three group
// subtotals, never the weights. Server markup.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import {
	GROUP_LABELS,
	GROUP_MAX,
	GROUPS,
	OUTCOME_META,
	ROUND_SHORT,
	fmtTotal,
	type AnswerRow,
	type CycleQuestion,
	type ScoreRow,
} from '@/lib/calibration/shared';

export function TotalsStrip({ score, compact = false }: { score: ScoreRow; compact?: boolean }) {
	if (score.model === 'ninebox') {
		return (
			<p className="text-sm text-slate-700 dark:text-slate-300">
				Performance <b>{score.performance}</b> · Potential <b>{score.potential}</b>
				<span className="text-2xs text-slate-500 dark:text-slate-400 ml-2">(earlier 1–3 model)</span>
			</p>
		);
	}
	const groups: Record<(typeof GROUPS)[number], number | null> = {
		core: score.core_total,
		performance: score.performance_total,
		professional: score.professional_total,
	};
	return (
		<div className={`flex items-end gap-4 flex-wrap ${compact ? '' : 'py-1'}`}>
			<div>
				<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Total</p>
				<p className={`font-semibold tabular-nums text-slate-900 dark:text-slate-100 ${compact ? 'text-xl' : 'text-3xl'}`}>
					{fmtTotal(score.total)}<span className="text-sm font-normal text-slate-500 dark:text-slate-400"> / 100</span>
				</p>
			</div>
			{GROUPS.map((g) => (
				<div key={g}>
					<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">{GROUP_LABELS[g]}</p>
					<p className={`tabular-nums text-slate-800 dark:text-slate-200 ${compact ? 'text-sm' : 'text-lg'}`}>
						{fmtTotal(groups[g])}<span className="text-2xs text-slate-500 dark:text-slate-400"> / {GROUP_MAX[g]}</span>
					</p>
				</div>
			))}
		</div>
	);
}

/** A submitted round, in full: totals, per-category ratings + notes, priorities, outcome. */
export default function SubmittedRound({
	score,
	questions,
	answers,
	scorerName,
	title,
}: {
	score: ScoreRow;
	questions: CycleQuestion[];
	answers: AnswerRow[];
	scorerName?: string | null;
	title?: string;
}) {
	const byQ = new Map(answers.map((a) => [a.cycle_question_id, a]));
	return (
		<Card className="space-y-3">
			<div className="flex items-center justify-between gap-2 flex-wrap">
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title ?? `${ROUND_SHORT[score.round]} round`}</h3>
				<Badge color="success">
					Submitted {score.submitted_at ? new Date(score.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}{scorerName ? ` by ${scorerName}` : ''}
				</Badge>
			</div>
			<TotalsStrip score={score} />
			{score.model === 'scorecard' && questions.length > 0 && (
				<details className="group">
					<summary className="text-xs text-primary-600 dark:text-primary-400 cursor-pointer select-none">Show ratings by category</summary>
					<ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
						{questions.map((q) => {
							const a = byQ.get(q.id);
							return (
								<li key={q.id} className="py-1.5 flex items-start gap-3 text-xs">
									<span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold tabular-nums">{a?.rating ?? '–'}</span>
									<span className="min-w-0">
										<span className="text-slate-800 dark:text-slate-200 font-medium">{q.label}</span>
										{a?.rating != null && <span className="text-slate-600 dark:text-slate-400"> — {q.rubric[a.rating]}</span>}
										{a?.notes && <span className="block text-slate-500 dark:text-slate-400 whitespace-pre-wrap mt-0.5">{a.notes}</span>}
									</span>
								</li>
							);
						})}
					</ul>
				</details>
			)}
			{score.priorities_md && (
				<div>
					<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Top 3 priorities for next quarter</p>
					<p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap mt-0.5">{score.priorities_md}</p>
				</div>
			)}
			{score.round === 'exec' && score.outcome && (
				<div>
					<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Outcome</p>
					<p className="text-sm text-slate-800 dark:text-slate-200 mt-0.5">{OUTCOME_META[score.outcome].label} → {OUTCOME_META[score.outcome].action}</p>
				</div>
			)}
			{score.notes_md && (
				<p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{score.notes_md}</p>
			)}
		</Card>
	);
}
