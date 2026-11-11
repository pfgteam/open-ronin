// Pipeline → Table (spec 2026-10-15-prospects-lists-design.md §4.3): 8
// columns, sortable headers as links, whole row clickable (every cell links
// to the deal; only the Deal cell is a tab stop). Server component — sort and
// paging are URL state.

import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { pipelineHref, SORT_DEFAULT_DIR, type DealSort, type PipelineFilters } from '@/lib/revenue/listParams';
import { formatCents, hoursInStage, ownerLaneFor, slaState, SOURCE_LABELS, type DealCard, type PipelineRow, type Source, type StageRow } from '@/lib/revenue/shared';
import { HeatText } from '../SalesBits';

const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';

function age(iso: string | null): string {
	if (!iso) return '—';
	const h = hoursInStage(iso);
	return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

export default function DealsTable({ deals, f, pipelines, stages, staff }: {
	deals: DealCard[];
	f: PipelineFilters;
	pipelines: PipelineRow[];
	stages: StageRow[];
	staff: Record<string, string>;
}) {
	const pipeBy = new Map(pipelines.map((p) => [p.id, p]));
	const stageBy = new Map(stages.map((s) => [s.id, s]));
	const now = Date.now();
	const sortHead = (key: DealSort, label: string, right = false) => {
		const active = f.sort === key;
		const nextDir = active ? (f.dir === 'asc' ? 'desc' : 'asc') : SORT_DEFAULT_DIR[key];
		return (
			<th className={clsx(th, right && 'text-right')} aria-sort={active ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
				<Link
					href={pipelineHref(f, { sort: key, dir: nextDir })}
					className={clsx('inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100', active && 'font-semibold text-primary-800 dark:text-primary-300')}
				>
					{label}
					{active && (f.dir === 'asc' ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />)}
				</Link>
			</th>
		);
	};
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b border-slate-200 dark:border-slate-700">
					{sortHead('title', 'Deal')}
					<th className={th}>Pipeline · Stage</th>
					<th className={th}>Owner</th>
					{sortHead('next', 'Next action')}
					{sortHead('heat', 'Heat')}
					{sortHead('value', 'Value', true)}
					{sortHead('recent', 'In stage', true)}
					{sortHead('touch', 'Last touch', true)}
				</tr>
			</thead>
			<tbody>
				{deals.map((d) => {
					const pipe = pipeBy.get(d.pipeline_id);
					const stage = stageBy.get(d.stage_id);
					const sla = stage ? slaState(stage, d) : null;
					const owner = pipe ? d[ownerLaneFor(pipe.lane)] : null;
					const value = (d.est_mrr_cents ?? 0) + (d.est_one_time_cents ?? 0);
					const late = d.next_action_at ? Date.parse(d.next_action_at) < now : false;
					const source = d.source ? (SOURCE_LABELS[d.source as Source] ?? null) : null;
					const href = `/prospects/deals/${d.id}`;
					const cell = (children: React.ReactNode, first = false) => (
						<td className="p-0">
							<Link href={href} tabIndex={first ? undefined : -1} className="block px-3 py-2">
								{children}
							</Link>
						</td>
					);
					return (
						<tr key={d.id} className="border-b border-slate-200 dark:border-slate-700 transition-colors hover:bg-hover">
							{cell(
								<>
									<span className="block max-w-72 truncate font-semibold text-slate-900 dark:text-slate-100">{d.title}</span>
									<span className="block max-w-72 truncate text-xs text-slate-500">{[d.person_name, source].filter(Boolean).join(' · ') || '—'}</span>
								</>,
								true,
							)}
							{cell(
								<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
									<span className={clsx('h-2 w-2 rounded-full', sla === 'breach' ? 'bg-amber-500' : 'bg-primary-500')} aria-hidden="true" />
									{pipe?.name ?? '—'} · {stage?.name ?? '—'}
								</span>,
							)}
							{cell(owner ? <span className="whitespace-nowrap">{staff[owner] ?? '—'}</span> : <span className="whitespace-nowrap font-semibold text-amber-700 dark:text-amber-300">No owner yet</span>)}
							{cell(
								<span className="block max-w-56 truncate">
									{d.next_action ?? '—'}
									{d.next_action_at && <span className={clsx('text-xs', late ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500')}> · {formatRelative(d.next_action_at)}</span>}
								</span>,
							)}
							{cell(<HeatText row={d} />)}
							{cell(<span className="block text-right tabular-nums">{value ? formatCents(value) : '—'}</span>)}
							{cell(<span className={clsx('block text-right tabular-nums', sla === 'breach' && 'font-semibold text-red-600 dark:text-red-400')}>{age(d.stage_entered_at)}</span>)}
							{cell(<span className="block text-right tabular-nums text-slate-600 dark:text-slate-400">{age(d.last_touch_at)}</span>)}
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
