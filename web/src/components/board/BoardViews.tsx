'use client';

// Kanban, Timeline and Calendar over the same rows as the table (spec §4.2).
// Kanban columns are the kind's canonical statuses; the card stripe is the
// row's group colour so the board's grouping still reads.

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { controlFocus } from '@/components/ui/focus';
import { isLate, progressOf, readableText, statusesFor, NEUTRAL_COLOR, type RowGroup } from '@/lib/work/boards/groups';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { OwnerChip } from './cells';
import { formatShortDate } from './format';

function groupColorOf(groups: RowGroup[]): Map<string, string> {
	const m = new Map<string, string>();
	for (const g of groups) for (const r of g.rows) m.set(r.id, g.color);
	return m;
}

// ------------------------------------------------------------------ kanban

export function BoardKanban({ groups, ctx, kind, today, onMove, onOpen, readOnly }: {
	groups: RowGroup[]; ctx: BoardContext; kind: string; today: string;
	onMove: (row: WorkRow, status: string) => void; onOpen: (row: WorkRow) => void; readOnly?: boolean;
}) {
	const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
	const color = useMemo(() => groupColorOf(groups), [groups]);
	const [dragId, setDragId] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const statuses = statusesFor(ctx, kind);
	return (
		<div className="flex gap-3 overflow-x-auto pb-3">
			{statuses.map((s) => {
				const col = rows.filter((r) => r.status === s.slug);
				const bg = s.color ?? NEUTRAL_COLOR;
				return (
					<section
						key={s.slug}
						aria-label={`${s.label}, ${col.length}`}
						onDragOver={(e) => { if (dragId && !readOnly) { e.preventDefault(); setOver(s.slug); } }}
						onDragLeave={() => setOver((o) => (o === s.slug ? null : o))}
						onDrop={(e) => {
							e.preventDefault();
							const r = rows.find((x) => x.id === dragId);
							setDragId(null); setOver(null);
							if (r && r.status !== s.slug) onMove(r, s.slug);
						}}
						className={clsx('flex w-64 shrink-0 flex-col rounded-lg bg-slate-100 dark:bg-slate-900 min-h-96', over === s.slug && 'outline-2 outline-dashed outline-primary-500 -outline-offset-2')}
					>
						<header className="flex items-center justify-between rounded-t-lg px-3 py-2 text-sm font-semibold" style={{ background: bg, color: readableText(bg) }}>
							<span className="truncate">{s.label}</span><span className="tabular-nums">{col.length}</span>
						</header>
						<div className="flex flex-1 flex-col gap-2 p-2">
							{col.map((r) => {
								const late = isLate(ctx, r, today);
								const p = ctx.progress[r.id];
								return (
									<article
										key={r.id}
										draggable={!readOnly}
										onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; }}
										onDragEnd={() => { setDragId(null); setOver(null); }}
										className="relative overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-3.5 pr-2.5 shadow-none cursor-grab active:cursor-grabbing"
									>
										<span className="absolute inset-y-0 left-0 w-1" style={{ background: color.get(r.id) }} aria-hidden="true" />
										<button type="button" onClick={() => onOpen(r)} className={clsx('mb-2 block text-left text-sm font-medium hover:underline', controlFocus)}>{r.name}</button>
										<div className="flex items-center gap-2 text-2xs text-slate-500">
											{r.owner_id && <OwnerChip id={r.owner_id} ctx={ctx} size={20} className="text-xs" />}
											{r.ends_at && <span className={clsx('tabular-nums', late && 'font-semibold text-red-600 dark:text-red-400')}>{formatShortDate(r.ends_at)}</span>}
											{p && p.total > 0 && <span className="ml-auto tabular-nums">{p.done}/{p.total}</span>}
										</div>
									</article>
								);
							})}
						</div>
					</section>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------- timeline

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function BoardTimeline({ groups, ctx, today, onOpen }: { groups: RowGroup[]; ctx: BoardContext; today: string; onOpen: (row: WorkRow) => void }) {
	const dated = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => r.starts_at || r.ends_at) })).filter((g) => g.rows.length);
	if (!dated.length) {
		return <p className="mt-6 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center text-sm text-slate-600 dark:text-slate-400">No item here has a start or due date yet. Set them in the table and they show up on the timeline.</p>;
	}
	const all = dated.flatMap((g) => g.rows.flatMap((r) => [r.starts_at, r.ends_at])).filter((d): d is string => !!d).concat(today).sort();
	const [y0, m0] = all[0].split('-').map(Number);
	const [y1, m1] = all[all.length - 1].split('-').map(Number);
	const months: { y: number; m: number }[] = [];
	for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) months.push({ y, m });
	const start = Date.UTC(y0, m0 - 1, 1), end = Date.UTC(y1, m1, 1), span = end - start;
	const pos = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Math.max(0, Math.min(100, ((Date.UTC(y, m - 1, d) - start) / span) * 100)); };
	const minWidth = Math.max(720, months.length * 120);
	return (
		<div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
			<div style={{ minWidth: minWidth + 280 }}>
				<div className="grid grid-cols-[280px_1fr] border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-2xs text-slate-500">
					<div className="px-3 py-2 font-medium">Item</div>
					<div className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
						{months.map((mo) => <div key={`${mo.y}-${mo.m}`} className="border-l border-slate-200 dark:border-slate-700 py-2 text-center">{MON[mo.m - 1]} {mo.y}</div>)}
					</div>
				</div>
				{dated.map((g) => (
					<div key={g.key}>
						<div className="grid grid-cols-[280px_1fr] border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
							<div className="px-3 py-1.5 text-sm font-semibold truncate" style={{ color: g.color }}>{g.label}</div><div />
						</div>
						{g.rows.map((r) => {
							const s = r.starts_at ?? r.ends_at!, e = r.ends_at ?? r.starts_at!;
							const left = pos(s), width = Math.max(1.5, pos(e) - left);
							const late = isLate(ctx, r, today);
							return (
								<div key={r.id} className="grid grid-cols-[280px_1fr] border-b border-slate-200 dark:border-slate-700 hover:bg-hover">
									<div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
										<span className="truncate text-sm">{r.name}</span>
										{r.owner_id && <OwnerChip id={r.owner_id} ctx={ctx} size={18} className="ml-auto max-w-28 shrink-0 text-xs" />}
									</div>
									<div className="relative h-9">
										<span className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${pos(today)}%` }} aria-hidden="true" />
										<button type="button" onClick={() => onOpen(r)} title={`${formatShortDate(s)} – ${formatShortDate(e)}${late ? ' · late' : ''}`} aria-label={`${r.name}, ${formatShortDate(s)} to ${formatShortDate(e)}${late ? ', late' : ''}`}
											className={clsx('absolute top-2 h-5 rounded-full px-2 text-left text-2xs font-medium truncate', controlFocus)}
											style={{ left: `${left}%`, width: `${width}%`, background: late ? 'var(--c-danger)' : g.color, color: readableText(late ? '#d83a52' : g.color) }}>
											{progressOf(ctx, r)}% · {r.name}
										</button>
									</div>
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- calendar

export function BoardCalendar({ groups, today, onOpen }: { groups: RowGroup[]; today: string; onOpen: (row: WorkRow) => void }) {
	const [ym, setYm] = useState(() => today.slice(0, 7));
	const color = useMemo(() => groupColorOf(groups), [groups]);
	const rows = useMemo(() => groups.flatMap((g) => g.rows).filter((r) => r.ends_at), [groups]);
	const [y, m] = ym.split('-').map(Number);
	const first = new Date(y, m - 1, 1);
	const lead = (first.getDay() + 6) % 7; // Monday-first
	const days = new Date(y, m, 0).getDate();
	const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => i - lead + 1);
	const shift = (d: number) => { const dt = new Date(y, m - 1 + d, 1); setYm(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`); };
	return (
		<div>
			<div className="mb-2 flex items-center gap-2">
				<button type="button" onClick={() => shift(-1)} aria-label="Previous month" className={clsx('rounded-md border border-slate-300 dark:border-slate-600 p-1', controlFocus)}><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
				<span className="text-sm font-semibold w-36 text-center">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
				<button type="button" onClick={() => shift(1)} aria-label="Next month" className={clsx('rounded-md border border-slate-300 dark:border-slate-600 p-1', controlFocus)}><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
				<span className="ml-2 text-xs text-slate-500">Items by due date. The Calendar page (agenda + Google) stays separate.</span>
			</div>
			<div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
				<div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400">
					{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
				</div>
				<div className="grid grid-cols-7">
					{cells.map((d, i) => {
						const inMonth = d >= 1 && d <= days;
						const iso = inMonth ? `${ym}-${String(d).padStart(2, '0')}` : '';
						const items = inMonth ? rows.filter((r) => r.ends_at === iso) : [];
						return (
							<div key={i} className={clsx('min-h-24 border-b border-r border-slate-200 dark:border-slate-700 p-1.5 flex flex-col gap-1', !inMonth && 'bg-slate-50 dark:bg-slate-900')}>
								{inMonth && <span className={clsx('self-start rounded-full px-1.5 text-2xs tabular-nums', iso === today ? 'bg-primary-700 text-white' : 'text-slate-500')}>{d}</span>}
								{items.slice(0, 4).map((r) => (
									<button key={r.id} type="button" onClick={() => onOpen(r)} className={clsx('truncate rounded-md px-1.5 py-0.5 text-left text-2xs font-medium', controlFocus)}
										style={{ background: color.get(r.id), color: readableText(color.get(r.id)) }}>{r.name}</button>
								))}
								{items.length > 4 && <span className="text-2xs text-slate-500">+{items.length - 4} more</span>}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
