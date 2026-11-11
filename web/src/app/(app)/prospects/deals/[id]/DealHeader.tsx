// The deal page header (spec 2026-10-20 §3), shared by every tab. It replaces
// the old PageHeader, stage strip and "Deal" card. Line 1: breadcrumb, title,
// Edit. Line 2: the facts that exist. Line 3: stage, time in stage + SLA, next
// action, Quality and Heat as a word.

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import { formatRelative } from '@/lib/format';
import type { HeaderFact, DealTab } from '@/lib/revenue/dealPage';
import { BUDGET_BAND_LABELS, HEAT_LABELS, TIMING_LABELS, heatLevel, hoursInStage, type DealCard, type PipelineRow, type StageRow } from '@/lib/revenue/shared';
import DealStageSelect from './DealStageSelect';

export default function DealHeader({ deal, pipeline, stage, stages, allStages, pipelines, sla, facts, tab }: {
	deal: DealCard;
	pipeline: PipelineRow | null;
	stage: StageRow | null;
	stages: StageRow[];
	allStages: StageRow[];
	pipelines: PipelineRow[];
	sla: 'ok' | 'warn' | 'breach' | null;
	facts: HeaderFact[];
	tab: DealTab;
}) {
	const editing = tab === 'edit';
	return (
		<Card className="mb-4 space-y-2">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<nav aria-label="Breadcrumb" className="text-2xs text-slate-500">
						<Link href="/prospects" className="hover:underline">Prospects</Link>
						{' › '}
						<Link href={`/prospects?pipeline=${pipeline?.slug ?? ''}`} className="hover:underline">{pipeline?.name ?? 'Pipeline'}</Link>
					</nav>
					<h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
						{deal.title}
						<Badge color={deal.status === 'won' ? 'success' : deal.status === 'lost' ? 'danger' : 'primary'}>{deal.status}</Badge>
					</h1>
				</div>
				<Link href={editing ? `/prospects/deals/${deal.id}` : `/prospects/deals/${deal.id}?tab=edit`}>
					<Button variant="outline" size="sm">{editing ? 'Cancel' : 'Edit'}</Button>
				</Link>
			</div>

			{facts.length > 0 && (
				<p className="text-xs text-slate-600 dark:text-slate-400">
					{facts.map((f, i) => (
						<span key={f.label}>
							{i > 0 && <span className="text-slate-400"> · </span>}
							{f.href ? (
								<a href={f.href} className="hover:underline" title={f.label}>{f.value}</a>
							) : (
								<span title={f.label}>{f.label === 'Closer' || f.label === 'Setter' || f.label === 'Lead gen' ? `${f.label} ${f.value}` : f.value}</span>
							)}
						</span>
					))}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<DealStageSelect dealId={deal.id} stageId={deal.stage_id} stages={stages} allStages={allStages} pipelines={pipelines} />
				<span className="text-xs tabular-nums text-slate-500">
					In stage {Math.round(hoursInStage(deal.stage_entered_at))}h
					{stage?.sla_hours ? <span className={sla === 'breach' ? ' text-red-600 dark:text-red-400' : sla === 'warn' ? ' text-amber-600 dark:text-amber-400' : ''}> · SLA {stage.sla_hours}h{sla === 'breach' ? ' breached' : ''}</span> : null}
				</span>
				{deal.next_action && (
					<span className="text-xs text-slate-500">
						Next: <span className="font-medium text-slate-900 dark:text-slate-100">{deal.next_action}</span>
						{deal.next_action_at && ` · ${formatRelative(deal.next_action_at)}`}
					</span>
				)}
				<span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-500">
					<span>
						Quality <b className="tabular-nums text-slate-900 dark:text-slate-100">{deal.quality_score ?? '–'}</b>/25 · Heat <b className="text-slate-900 dark:text-slate-100">{HEAT_LABELS[heatLevel(deal.heat_score)]}</b>
					</span>
					{deal.qualification && <Badge>{deal.qualification.replace('_', ' ')}</Badge>}
					{deal.budget_band && <span>{BUDGET_BAND_LABELS[deal.budget_band]}</span>}
					{deal.timing && <span>{TIMING_LABELS[deal.timing]}</span>}
				</span>
			</div>

			{deal.no_show_count > 0 && (
				<Callout tone="warning">
					{deal.no_show_count} no-show{deal.no_show_count > 1 ? 's' : ''}.{deal.delay_until && new Date(deal.delay_until) > new Date() ? ` On a 90-day delay until ${new Date(deal.delay_until).toLocaleDateString()}.` : ' Three put the prospect on a 90-day delay.'}
				</Callout>
			)}
		</Card>
	);
}
