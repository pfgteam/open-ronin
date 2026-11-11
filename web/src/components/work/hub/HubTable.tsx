'use client';

// The Work hub table (rework 5.2, 5.10; style guide phase 2). One scroll
// container for the list (both axes), so the header row and the first two
// columns stay put while you scroll (D13). Rows are windowed (D8): only what
// is on screen renders, the spacers keep the scrollbar honest. The whole row
// opens the item (style guide decision 11); cells, the checkbox and the
// expand toggle stop propagation so they keep their own click.

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, CornerDownRight, Maximize2, Plus } from 'lucide-react';
import Checkbox from '@/components/ui/Checkbox';
import TriCheckbox from '@/components/ui/TriCheckbox';
import { controlFocus } from '@/components/ui/focus';
import { CHILD_KINDS_FOR_PARENT } from '@/app/(app)/the-work/hierarchy';
import { statusBattery, KIND_LABELS } from '@/lib/work/boards/groups';
import type { ColumnDef } from '@/lib/work/boards/columns';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { progressValue, statusTone, TONE_COLOR, type RenderGroup } from '@/lib/work/hub/rows';
import { BoardCell, type CellEdit } from '@/components/board/cells';
import { useVirtualRows } from './useVirtualRows';

export type TableItem =
	| { type: 'group'; group: RenderGroup; collapsed: boolean }
	| { type: 'row'; row: WorkRow; group: RenderGroup; depth: number; parentId?: string }
	| { type: 'add'; group: RenderGroup }
	| { type: 'childAdd'; parent: WorkRow; group: RenderGroup }
	| { type: 'loading'; group: RenderGroup; label: string }
	| { type: 'footer'; group: RenderGroup };

const H = { group: 40, row: 36, add: 36, childAdd: 32, loading: 32, footer: 32 } as const;
const heightOf = (it: TableItem) => H[it.type];
const CHECK_W = 40;
const NAME_W = 360;

export interface HubTableProps {
	items: TableItem[];
	columns: ColumnDef[];
	ctx: BoardContext;
	today: string;
	noun: string;
	selected: Set<string>;
	onToggleSelect: (ids: string[], on: boolean) => void;
	/** Header checkbox: every row in the filtered set (not just what is rendered). */
	allState: 'none' | 'some' | 'all';
	onToggleAll: () => void;
	onToggleGroup: (key: string) => void;
	onEdit: (row: WorkRow, e: CellEdit) => void;
	onOpen: (row: WorkRow) => void;
	onAdd?: (groupKey: string, name: string) => Promise<boolean>;
	expanded: Set<string>;
	onToggleExpand: (row: WorkRow) => void;
	onAddChild?: (parent: WorkRow, name: string) => Promise<boolean>;
	readOnly?: boolean;
	empty: React.ReactNode;
	onHoverRow?: (id: string | null) => void;
	focusedId?: string | null;
}

export default function HubTable(p: HubTableProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const v = useVirtualRows({ items: p.items, height: heightOf, scrollRef, headerOffset: 36 });
	const width = CHECK_W + NAME_W + p.columns.reduce((a, c) => a + c.width, 0);
	const colCount = 2 + p.columns.length;

	const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		const tr = target.closest<HTMLElement>('tr[data-row]');
		if (!tr) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const names = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row-name]'));
			const cur = tr.querySelector<HTMLElement>('[data-row-name]');
			const i = cur ? names.indexOf(cur) : -1;
			const next = names[i + (e.key === 'ArrowDown' ? 1 : -1)];
			if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
		} else if (e.key === ' ' && target.hasAttribute('data-row-name')) {
			e.preventDefault();
			const id = tr.dataset.row;
			if (id) p.onToggleSelect([id], !p.selected.has(id));
		}
	}, [p]);

	if (!p.items.length) {
		return <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-400">{p.empty}</div>;
	}

	const visible = p.items.slice(v.start, v.end);
	return (
		<div
			ref={scrollRef}
			onKeyDown={onKey}
			onKeyUp={(e) => { if (e.key === ' ' && (e.target as HTMLElement).hasAttribute('data-row-name')) e.preventDefault(); }}
			className="relative h-full min-h-0 overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
			role="region"
			aria-label="Work items"
			tabIndex={-1}
		>
			<table className="table-fixed border-separate border-spacing-0 text-13" style={{ width, minWidth: '100%' }}>
				<colgroup>
					<col style={{ width: CHECK_W }} />
					<col style={{ width: NAME_W }} />
					{p.columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
				</colgroup>
				<thead>
					<tr className="h-9">
						<th scope="col" className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
							<span className="flex items-center justify-center">
								<TriCheckbox state={p.allState} onToggle={p.onToggleAll} label={p.allState === 'all' ? 'Clear selection' : 'Select every item in this list'} />
							</span>
						</th>
						<th scope="col" className="sticky top-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 text-left text-2xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400" style={{ left: CHECK_W }}>
							{p.noun}
						</th>
						{p.columns.map((c) => (
							<th key={c.key} scope="col" className="sticky top-0 z-10 truncate border-b border-r border-slate-200 bg-slate-50 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
								{c.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{v.padTop > 0 && <tr aria-hidden="true" style={{ height: v.padTop }}><td colSpan={colCount} /></tr>}
					{visible.map((it) => <Item key={itemKey(it)} it={it} p={p} colCount={colCount} />)}
					{v.padBottom > 0 && <tr aria-hidden="true" style={{ height: v.padBottom }}><td colSpan={colCount} /></tr>}
				</tbody>
			</table>
		</div>
	);
}

function itemKey(it: TableItem): string {
	switch (it.type) {
		case 'group': return `g:${it.group.key}`;
		case 'row': return `r:${it.parentId ?? ''}:${it.row.id}`;
		case 'add': return `a:${it.group.key}`;
		case 'childAdd': return `ca:${it.parent.id}`;
		case 'loading': return `l:${it.group.key}:${it.label}`;
		case 'footer': return `f:${it.group.key}`;
	}
}

function Item({ it, p, colCount }: { it: TableItem; p: HubTableProps; colCount: number }) {
	if (it.type === 'group') {
		const g = it.group;
		const ids = g.rows.map((r) => r.id);
		const allOn = ids.length > 0 && ids.every((id) => p.selected.has(id));
		return (
			<tr className="h-10">
				<td className="sticky left-0 z-10 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" style={{ boxShadow: `inset 4px 0 0 ${g.color}` }}>
					<span className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
						<Checkbox checked={allOn} onChange={(e) => p.onToggleSelect(ids, e.target.checked)} aria-label={`Select the ${g.rows.length} loaded in ${g.label}`} />
					</span>
				</td>
				<td colSpan={colCount - 1} className="border-b border-slate-200 bg-white p-0 dark:border-slate-700 dark:bg-slate-800">
					<button type="button" onClick={() => p.onToggleGroup(g.key)} aria-expanded={!it.collapsed}
						className={clsx('sticky flex h-10 max-w-[90vw] items-center gap-2 px-2 text-sm font-semibold text-slate-900 dark:text-slate-100', controlFocus)} style={{ left: CHECK_W }}>
						{it.collapsed ? <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />}
						<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} aria-hidden="true" />
						<span className="truncate">{g.label}</span>
						<span className="rounded-full bg-slate-100 px-1.5 text-2xs font-medium tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">{g.count.toLocaleString()}</span>
					</button>
				</td>
			</tr>
		);
	}
	if (it.type === 'row') return <Row it={it} p={p} />;
	if (it.type === 'add') {
		if (!p.onAdd) return <tr className="h-9"><td colSpan={colCount} className="border-b border-slate-200 dark:border-slate-700" /></tr>;
		return <AddLine colCount={colCount} placeholder={`Add ${p.noun.toLowerCase()}`} onAdd={(name) => p.onAdd!(it.group.key, name)} />;
	}
	if (it.type === 'childAdd') {
		const childKind = CHILD_KINDS_FOR_PARENT[it.parent.kind]?.[0] ?? 'item';
		return <AddLine colCount={colCount} indent placeholder={`Add ${(KIND_LABELS[childKind] ?? childKind).toLowerCase()} to ${it.parent.name}`} onAdd={(name) => p.onAddChild?.(it.parent, name) ?? Promise.resolve(false)} />;
	}
	if (it.type === 'loading') {
		return <tr className="h-8"><td className="sticky left-0 z-10 bg-white dark:bg-slate-800" /><td colSpan={colCount - 1} className="border-b border-slate-200 px-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{it.label}</td></tr>;
	}
	// footer: status mix + progress average for the group
	const g = it.group;
	const slices = statusBattery(p.ctx, g.rows);
	return (
		<tr className="h-8" aria-hidden="true">
			<td className="sticky left-0 z-10 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
			<td className="sticky z-10 border-b border-slate-200 bg-white px-3 text-2xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400" style={{ left: CHECK_W }}>
				{g.rows.length < g.count ? `${g.rows.length.toLocaleString()} of ${g.count.toLocaleString()} loaded` : ''}
			</td>
			{p.columns.map((c) => (
				<td key={c.key} className="border-b border-slate-200 px-2 dark:border-slate-700">
					{c.cell === 'status' && slices.length > 0 ? (
						<span className="flex h-2 w-full overflow-hidden rounded-full" title={slices.map((s) => `${s.label}: ${s.count}`).join(' · ')}>
							{slices.map((s) => {
								const st = (p.ctx.statusesByKind[g.rows[0]?.kind ?? ''] ?? []).find((x) => x.slug === s.slug) ?? { slug: s.slug };
								return <span key={s.slug} style={{ flex: s.count, background: TONE_COLOR[statusTone(st)] }} />;
							})}
						</span>
					) : c.cell === 'progress' && g.rows.length ? (
						<span className="block text-center text-2xs tabular-nums text-slate-500">{Math.round(g.rows.reduce((a, r) => a + progressValue(p.ctx, r), 0) / g.rows.length)}% avg</span>
					) : null}
				</td>
			))}
		</tr>
	);
}

function Row({ it, p }: { it: Extract<TableItem, { type: 'row' }>; p: HubTableProps }) {
	const { row, depth } = it;
	const isSel = p.selected.has(row.id);
	const canHaveChildren = !!CHILD_KINDS_FOR_PARENT[row.kind] && depth === 0;
	const isOpen = p.expanded.has(row.id);
	const prog = p.ctx.progress[row.id];
	const cellBg = isSel ? 'bg-selected' : 'bg-white group-hover:bg-hover dark:bg-slate-800 dark:group-hover:bg-hover';
	return (
		<tr
			data-row={row.id}
			className={clsx('group h-9 cursor-pointer whitespace-nowrap', isSel ? 'bg-selected' : 'hover:bg-hover', p.focusedId === row.id && 'outline outline-2 -outline-offset-2 outline-primary-500')}
			onClick={() => p.onOpen(row)}
			onMouseEnter={() => p.onHoverRow?.(row.id)}
			onMouseLeave={() => p.onHoverRow?.(null)}
		>
			<td className={clsx('sticky left-0 z-10 border-b border-r border-slate-200 dark:border-slate-700', cellBg)} style={{ boxShadow: `inset 4px 0 0 ${it.group.color}` }} onClick={(e) => e.stopPropagation()}>
				<span className="flex items-center justify-center">
					<Checkbox checked={isSel} onChange={(e) => p.onToggleSelect([row.id], e.target.checked)} aria-label={`Select ${row.name}`} />
				</span>
			</td>
			<td className={clsx('sticky z-10 border-b border-r border-slate-200 px-2 dark:border-slate-700', cellBg)} style={{ left: CHECK_W }}>
				<div className={clsx('flex min-w-0 items-center gap-1.5', depth > 0 && 'pl-5')}>
					{depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
					{canHaveChildren ? (
						<button type="button" onClick={(e) => { e.stopPropagation(); p.onToggleExpand(row); }} aria-expanded={isOpen}
							aria-label={`${isOpen ? 'Hide' : 'Show'} what sits under ${row.name}`}
							className={clsx('shrink-0 rounded-md p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200', controlFocus)}>
							{isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
						</button>
					) : depth === 0 ? <span className="w-4.5 shrink-0" aria-hidden="true" /> : null}
					<button type="button" data-row-name onClick={(e) => { e.stopPropagation(); p.onOpen(row); }}
						className={clsx('min-w-0 flex-1 truncate text-left text-slate-900 dark:text-slate-100', controlFocus)}>
						{row.name}
					</button>
					{prog && prog.total > 0 && (
						<span className="shrink-0 rounded-md bg-slate-100 px-1.5 text-2xs tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">{prog.done}/{prog.total}</span>
					)}
					<Link href={`/the-work/${row.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Open ${row.name} as a page`}
						className={clsx('shrink-0 rounded-md p-0.5 text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:text-slate-200', controlFocus)}>
						<Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				</div>
			</td>
			{p.columns.map((c) => (
				<td key={c.key} className="h-9 max-h-9 overflow-hidden border-b border-r border-slate-200 p-0 dark:border-slate-700" onClick={(e) => { if (c.field || c.cell === 'custom') e.stopPropagation(); }}>
					<BoardCell col={c} row={row} ctx={p.ctx} groupColor={it.group.color} today={p.today} readOnly={p.readOnly} onEdit={(e) => p.onEdit(row, e)} />
				</td>
			))}
		</tr>
	);
}

function AddLine({ colCount, placeholder, onAdd, indent }: { colCount: number; placeholder: string; onAdd: (name: string) => Promise<boolean>; indent?: boolean }) {
	const [value, setValue] = useState('');
	const [busy, setBusy] = useState(false);
	return (
		<tr className={indent ? 'h-8' : 'h-9'}>
			<td className="sticky left-0 z-10 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
			<td colSpan={colCount - 1} className="border-b border-slate-200 p-0 dark:border-slate-700">
				<span className={clsx('sticky flex items-center gap-1', indent ? 'pl-9' : 'pl-3')} style={{ left: CHECK_W, width: NAME_W }}>
					<Plus className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
					<input
						value={value}
						disabled={busy}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={async (e) => {
							if (e.key !== 'Enter' || !value.trim()) return;
							setBusy(true);
							const ok = await onAdd(value.trim());
							setBusy(false);
							if (ok) setValue('');
						}}
						placeholder={placeholder}
						aria-label={placeholder}
						className="h-8 w-full bg-transparent text-13 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
					/>
				</span>
			</td>
		</tr>
	);
}
