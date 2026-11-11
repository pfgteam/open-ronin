'use client';

// Board view (rework 5.2, D13): one column per group, cards drag between
// columns with the pointer-based dnd-kit library (mouse, touch and keyboard;
// the old hub's library). A drop writes the group's field (status by
// default). Each column renders its cards lazily as you scroll it (D8: no
// Load more), and the column headers carry the true filtered counts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
	DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors,
	type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { AlertCircle, GripVertical } from 'lucide-react';
import { controlFocus } from '@/components/ui/focus';
import { isLate } from '@/lib/work/boards/groups';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { URGENCY_TONE, TONE_BADGE, type RenderGroup } from '@/lib/work/hub/rows';
import { Avatar } from '@/components/board/cells';
import { formatShortDate } from '@/components/board/format';

const STEP = 50;

export default function HubKanban({ groups, ctx, today, onOpen, onMove, readOnly, canDrop }: {
	groups: RenderGroup[];
	ctx: BoardContext;
	today: string;
	onOpen: (row: WorkRow) => void;
	onMove: (row: WorkRow, groupKey: string) => void;
	readOnly?: boolean;
	/** False when the grouping is not a writable field (parent, kind): cards don't drag. */
	canDrop: boolean;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
		useSensor(KeyboardSensor),
	);
	const [active, setActive] = useState<WorkRow | null>(null);
	const byId = useMemo(() => new Map(groups.flatMap((g) => g.rows.map((r) => [r.id, r] as const))), [groups]);
	const dragOn = canDrop && !readOnly;

	const onStart = (e: DragStartEvent) => setActive(byId.get(String(e.active.id)) ?? null);
	const onEnd = (e: DragEndEvent) => {
		setActive(null);
		const row = byId.get(String(e.active.id));
		const to = e.over ? String(e.over.id) : null;
		if (!row || !to) return;
		const from = groups.find((g) => g.rows.some((r) => r.id === row.id))?.key;
		if (to !== from) onMove(row, to);
	};

	return (
		<DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
			<div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-2" role="list" aria-label="Board columns">
				{groups.map((g) => <Column key={g.key} g={g} ctx={ctx} today={today} onOpen={onOpen} dragOn={dragOn} />)}
			</div>
			<DragOverlay>{active ? <Card row={active} ctx={ctx} today={today} overlay /> : null}</DragOverlay>
		</DndContext>
	);
}

function Column({ g, ctx, today, onOpen, dragOn }: { g: RenderGroup; ctx: BoardContext; today: string; onOpen: (r: WorkRow) => void; dragOn: boolean }) {
	const { setNodeRef, isOver } = useDroppable({ id: g.key, disabled: !dragOn });
	const [shown, setShown] = useState(STEP);
	const sentinel = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = sentinel.current;
		if (!el) return;
		const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setShown((n) => n + STEP); }, { rootMargin: '400px' });
		io.observe(el);
		return () => io.disconnect();
	}, [g.rows.length, shown]);
	return (
		<section
			ref={setNodeRef}
			role="listitem"
			aria-label={`${g.label}, ${g.count}`}
			className={clsx('flex h-full w-72 shrink-0 flex-col rounded-lg border bg-slate-50 dark:bg-slate-900', isOver ? 'border-primary-500' : 'border-slate-200 dark:border-slate-700')}
		>
			<header className="sticky top-0 flex items-center gap-2 rounded-t-lg border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" style={{ boxShadow: `inset 0 3px 0 ${g.color}` }}>
				<span className="truncate text-sm font-semibold">{g.label}</span>
				<span className="ml-auto rounded-full bg-white px-1.5 text-2xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{g.count.toLocaleString()}</span>
			</header>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
				{g.rows.slice(0, shown).map((r) => <DraggableCard key={r.id} row={r} ctx={ctx} today={today} onOpen={onOpen} dragOn={dragOn} />)}
				{shown < g.rows.length && <div ref={sentinel} className="h-6" aria-hidden="true" />}
				{g.rows.length < g.count && <p className="px-1 text-2xs text-slate-500">Loading {(g.count - g.rows.length).toLocaleString()} more…</p>}
				{!g.count && <p className="px-1 py-3 text-center text-2xs text-slate-500">Nothing here</p>}
			</div>
		</section>
	);
}

function DraggableCard({ row, ctx, today, onOpen, dragOn }: { row: WorkRow; ctx: BoardContext; today: string; onOpen: (r: WorkRow) => void; dragOn: boolean }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled: !dragOn });
	return (
		<div ref={setNodeRef} className={clsx(isDragging && 'opacity-40')}>
			<Card row={row} ctx={ctx} today={today} onOpen={onOpen} handle={dragOn ? { ...attributes, ...listeners } : undefined} />
		</div>
	);
}

function Card({ row, ctx, today, onOpen, handle, overlay }: {
	row: WorkRow; ctx: BoardContext; today: string; onOpen?: (r: WorkRow) => void; handle?: Record<string, unknown>; overlay?: boolean;
}) {
	const late = isLate(ctx, row, today);
	const parent = row.parent_id ? ctx.parents[row.parent_id]?.name : null;
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onOpen?.(row)}
			onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(row); }}
			className={clsx('group cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 text-13 transition-colors duration-150 hover:border-primary-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-700', controlFocus, overlay && 'rotate-1 shadow-panel')}
		>
			<div className="flex items-start gap-1.5">
				<span className="min-w-0 flex-1 font-medium text-slate-900 dark:text-slate-100">{row.name}</span>
				{handle && (
					<span {...handle} onClick={(e) => e.stopPropagation()} aria-label={`Move ${row.name}`} className="-mr-1 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
						<GripVertical className="h-4 w-4" aria-hidden="true" />
					</span>
				)}
			</div>
			{parent && <p className="mt-0.5 truncate text-2xs text-slate-500 dark:text-slate-400">{parent}</p>}
			<div className="mt-2 flex items-center gap-2">
				{row.owner_id ? <Avatar id={row.owner_id} ctx={ctx} size={20} /> : <span className="text-2xs text-slate-400">No owner</span>}
				{row.priority && <span className={clsx('rounded-md px-1.5 text-2xs font-medium', TONE_BADGE[URGENCY_TONE[row.priority] ?? 'neutral'])}>{row.priority}</span>}
				{row.ends_at && (
					<span className={clsx('ml-auto inline-flex items-center gap-1 text-2xs tabular-nums', late ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400')}>
						{late && <AlertCircle className="h-3 w-3" aria-hidden="true" />}{formatShortDate(row.ends_at)}
					</span>
				)}
			</div>
		</div>
	);
}
