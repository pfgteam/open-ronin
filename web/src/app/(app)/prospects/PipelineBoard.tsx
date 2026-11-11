'use client';

// Pipeline → Board (spec 2026-10-15-prospects-lists-design.md §4.4): one
// pipeline, one column per stage. Each column loads 50 cards and pages with
// auto-load as it scrolls; the header count and value come from rev_pipeline_summary, so
// they are true totals (approximate "+" counts until 0157 is applied). Drag a
// card to move it: optimistic, then moveDeal() (the SQL stage guard validates,
// hands off between lanes and writes history); success shows a toast with
// Undo inside the pipeline, a hand-off removes the card. Same dnd-kit pattern
// as The Work's priorities board (6px activation so a click opens the deal).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { clsx } from 'clsx';
import { useToast } from '@/components/ui/Toast';
import type { DealQuery, StageSum } from '@/lib/revenue/lists';
import { formatCents, hoursInStage, ownerLaneFor, slaState, type DealCard, type Lane, type PipelineRow, type StageRow } from '@/lib/revenue/shared';
import { offsetsAfterMove } from '@/lib/revenue/boardOffsets';
import { HeatText } from '../SalesBits';
import { moveDeal } from './actions';
import { loadMoreStage } from './listActions';
import AutoLoad from '@/components/ui/AutoLoad';

const PAGE = 50;

interface Props {
	stages: StageRow[];
	columns: Record<string, DealCard[]>;
	/** null until 0157 is applied: counts fall back to what is loaded. */
	summary: Record<string, StageSum> | null;
	query: DealQuery;
	lane: Lane;
	staff: Record<string, string>;
	pipelines: PipelineRow[];
}

const valueOf = (d: DealCard) => (d.est_mrr_cents ?? 0) + (d.est_one_time_cents ?? 0);

export default function PipelineBoard({ stages, columns, summary, query, lane, staff, pipelines }: Props) {
	const { toast } = useToast();
	const [cols, setCols] = useState<Record<string, DealCard[]>>(columns);
	const [sums, setSums] = useState<Record<string, StageSum>>(() => {
		if (summary) return summary;
		return Object.fromEntries(stages.map((s) => [s.id, { count: (columns[s.id] ?? []).length, valueCents: (columns[s.id] ?? []).reduce((n, d) => n + valueOf(d), 0) }]));
	});
	// Without the summary, a column that came back full may hold more.
	const [maybeMore, setMaybeMore] = useState<Record<string, boolean>>(() => (summary ? {} : Object.fromEntries(stages.map((s) => [s.id, (columns[s.id] ?? []).length >= PAGE]))));
	// Server rows consumed per column (in the column's server order) — the next page starts here.
	const [offsets, setOffsets] = useState<Record<string, number>>(() => Object.fromEntries(stages.map((s) => [s.id, (columns[s.id] ?? []).length])));
	const [loading, setLoading] = useState<string | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
	const pipeName = (id: string | null) => pipelines.find((p) => p.id === id)?.name ?? 'the next lane';

	const findDeal = (id: string) => {
		for (const [stageId, list] of Object.entries(cols)) {
			const d = list.find((x) => x.id === id);
			if (d) return { deal: d, stageId };
		}
		return null;
	};

	/** Move a card between columns locally (and the header totals with it). */
	const shift = (deal: DealCard, from: string, to: string | null) => {
		setCols((c) => {
			const next = { ...c, [from]: (c[from] ?? []).filter((d) => d.id !== deal.id) };
			if (to) next[to] = [{ ...deal, stage_id: to, stage_entered_at: new Date().toISOString() }, ...(c[to] ?? [])];
			return next;
		});
		setSums((s) => {
			const v = valueOf(deal);
			const next = { ...s, [from]: { count: Math.max(0, (s[from]?.count ?? 1) - 1), valueCents: Math.max(0, (s[from]?.valueCents ?? v) - v) } };
			if (to) next[to] = { count: (s[to]?.count ?? 0) + 1, valueCents: (s[to]?.valueCents ?? 0) + v };
			return next;
		});
	};

	async function handleDragEnd(e: DragEndEvent) {
		setActiveId(null);
		const dealId = String(e.active.id);
		const to = e.over ? String(e.over.id) : null;
		const target = to ? stageById.get(to) : undefined;
		const found = findDeal(dealId);
		if (!to || !target || !found || found.stageId === to) return;
		const { deal, stageId: from } = found;
		const leaves = !!target.handoff_pipeline_id || target.outcome !== 'open';
		const before = { cols, sums, offsets };
		shift(deal, from, leaves ? null : to);
		const r = await moveDeal({ deal_id: dealId, stage_id: to });
		if (!r.ok) {
			setCols(before.cols);
			setSums(before.sums);
			setOffsets(before.offsets);
			toast({ message: r.error, variant: 'error' });
			return;
		}
		setOffsets((o) => offsetsAfterMove(o, from, leaves ? null : to));
		if (leaves) {
			toast({ message: target.handoff_pipeline_id ? `${deal.title} handed off to ${pipeName(target.handoff_pipeline_id)}` : `${deal.title} → ${target.name}`, variant: 'success' });
			return;
		}
		toast({
			message: `${deal.title} → ${target.name}`,
			undo: async () => {
				const back = await moveDeal({ deal_id: dealId, stage_id: from });
				if (back.ok) {
					shift({ ...deal, stage_id: to }, to, from);
					setOffsets((o) => offsetsAfterMove(o, to, from));
				}
				else toast({ message: back.error, variant: 'error' });
			},
		});
	}

	async function loadMore(stageId: string) {
		setLoading(stageId);
		try {
			const more = await loadMoreStage({ query, stageId, offset: offsets[stageId] ?? (cols[stageId] ?? []).length });
			setOffsets((o) => ({ ...o, [stageId]: (o[stageId] ?? 0) + more.length }));
			setCols((c) => {
				const seen = new Set((c[stageId] ?? []).map((d) => d.id));
				return { ...c, [stageId]: [...(c[stageId] ?? []), ...more.filter((d) => !seen.has(d.id))] };
			});
			if (!summary) {
				setMaybeMore((m) => ({ ...m, [stageId]: more.length >= PAGE }));
				setSums((s) => ({ ...s, [stageId]: { count: (s[stageId]?.count ?? 0) + more.length, valueCents: (s[stageId]?.valueCents ?? 0) + more.reduce((n, d) => n + valueOf(d), 0) } }));
			}
		} catch (err) {
			toast({ message: (err as Error).message || 'Could not load more deals.', variant: 'error' });
		} finally {
			setLoading(null);
		}
	}

	const active = activeId ? findDeal(activeId) : null;

	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={(e) => void handleDragEnd(e)} onDragCancel={() => setActiveId(null)}>
			<div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
				{stages.map((s) => {
					const list = cols[s.id] ?? [];
					const sum = sums[s.id] ?? { count: 0, valueCents: 0 };
					const left = summary ? Math.max(0, sum.count - list.length) : null;
					const showMore = summary ? (left ?? 0) > 0 : !!maybeMore[s.id];
					return (
						<Column key={s.id} stage={s} count={sum.count} approx={!summary && !!maybeMore[s.id]} valueCents={sum.valueCents} handoffTo={s.handoff_pipeline_id ? pipeName(s.handoff_pipeline_id) : null}>
							{list.map((d) => (
								<Draggable key={d.id} id={d.id} dragging={activeId === d.id}>
									<DealCardView deal={d} stage={s} lane={lane} staff={staff} />
								</Draggable>
							))}
							{/* Rework D8: each column loads the rest as it scrolls; no Load more button. */}
							<AutoLoad hasMore={showMore} loading={loading === s.id} onLoad={() => void loadMore(s.id)} remaining={left} />
						</Column>
					);
				})}
			</div>
			<DragOverlay>
				{active ? (
					<div className="w-64 rotate-2 shadow-panel">
						<DealCardView deal={active.deal} stage={stageById.get(active.stageId) as StageRow} lane={lane} staff={staff} />
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function Column({ stage, count, approx, valueCents, handoffTo, children }: { stage: StageRow; count: number; approx: boolean; valueCents: number; handoffTo: string | null; children: React.ReactNode }) {
	const { setNodeRef, isOver } = useDroppable({ id: stage.id });
	return (
		<div className="w-64 shrink-0 space-y-2">
			<div className="px-1">
				<div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
					<span className="inline-flex min-w-0 items-center gap-1.5 truncate">
						<span className={clsx('h-2 w-2 shrink-0 rounded-full', stage.outcome === 'won' ? 'bg-green-500' : stage.outcome === 'lost' ? 'bg-red-400' : 'bg-primary-500')} aria-hidden="true" />
						{handoffTo ? `→ Hand off to ${handoffTo}` : stage.name}
					</span>
					<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
						{count.toLocaleString()}{approx ? '+' : ''}
					</span>
				</div>
				<div className="mt-0.5 text-2xs tabular-nums text-slate-500">
					{valueCents ? formatCents(valueCents) : '—'}{stage.sla_hours ? ` · SLA ${stage.sla_hours}h` : ''}
				</div>
			</div>
			<div ref={setNodeRef} className={clsx('min-h-32 space-y-2 rounded-md p-1 transition-colors', isOver && 'bg-primary-50 ring-2 ring-primary-300 dark:bg-primary-950/20 dark:ring-primary-800')}>
				{count === 0 && !isOver && <div className="rounded-md border border-dashed border-slate-200 py-4 text-center text-2xs text-slate-500 dark:border-slate-700">Empty</div>}
				{children}
			</div>
		</div>
	);
}

function Draggable({ id, dragging, children }: { id: string; dragging: boolean; children: React.ReactNode }) {
	const { setNodeRef, listeners, attributes } = useDraggable({ id });
	return (
		<div ref={setNodeRef} {...listeners} {...attributes} className={dragging ? 'opacity-40' : undefined}>
			{children}
		</div>
	);
}

function DealCardView({ deal, stage, lane, staff }: { deal: DealCard; stage: StageRow; lane: Lane; staff: Record<string, string> }) {
	const sla = slaState(stage, deal);
	const ownerId = deal[ownerLaneFor(lane)];
	const hours = hoursInStage(deal.stage_entered_at);
	const age = hours < 1 ? `${Math.round(hours * 60)}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
	const value = valueOf(deal);
	return (
		<Link href={`/prospects/deals/${deal.id}`} className="block rounded-md border border-slate-200 bg-white p-2.5 transition-colors hover:border-primary-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-700">
			<div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{deal.title}</div>
			<div className="truncate text-2xs text-slate-500">{deal.person_name ?? deal.company_name ?? '—'}</div>
			<div className="mt-2 flex items-center justify-between gap-2 text-2xs">
				<HeatText row={deal} />
				<span className="inline-flex shrink-0 items-center gap-1 tabular-nums text-slate-500">
					{value > 0 && <span>{formatCents(value)}</span>}
					<span className={clsx(sla === 'breach' && 'font-semibold text-red-600 dark:text-red-400', sla === 'warn' && 'text-amber-700 dark:text-amber-300')}>· {age}</span>
				</span>
			</div>
			<div className={clsx('mt-1 truncate text-2xs', ownerId ? 'text-slate-500' : 'font-semibold text-amber-700 dark:text-amber-300')}>{ownerId ? (staff[ownerId] ?? 'Owner') : 'No owner yet'}</div>
		</Link>
	);
}
