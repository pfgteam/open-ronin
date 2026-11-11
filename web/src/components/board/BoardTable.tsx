'use client';

// The monday-style table (spec §4.2 screen 2): coloured collapsible groups,
// full-colour status cells, inline add row per group, a status battery in
// each group footer, and children as expandable subitems. Plain <table>
// (no table library — CLAUDE.md), sticky first column for wide boards.

import { useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, CornerDownRight, Maximize2, Plus } from 'lucide-react';
import { controlFocus } from '@/components/ui/focus';
import { CHILD_KINDS_FOR_PARENT } from '@/app/(app)/the-work/hierarchy';
import { statusBattery, progressOf, KIND_LABELS, type RowGroup } from '@/lib/work/boards/groups';
import type { ColumnDef } from '@/lib/work/boards/columns';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { BoardCell, StatusCell, OwnerChip, type CellEdit } from './cells';
import { formatShortDate } from './format';

export interface BoardTableProps {
	groups: RowGroup[];
	columns: ColumnDef[];
	ctx: BoardContext;
	today: string;
	itemLabel: string;
	selected: Set<string>;
	onToggleSelect: (ids: string[], on: boolean) => void;
	collapsed: Set<string>;
	onToggleCollapse: (key: string) => void;
	onEdit: (row: WorkRow, edit: CellEdit) => void;
	onAdd?: (groupKey: string, name: string) => Promise<boolean>;
	/** What to show when there are no groups at all (the screen knows whether filters are on). */
	empty?: React.ReactNode;
	onOpen: (row: WorkRow) => void;
	expanded: Set<string>;
	onToggleExpand: (row: WorkRow) => void;
	childRows: Record<string, WorkRow[] | 'loading'>;
	onAddChild?: (parent: WorkRow, name: string) => Promise<boolean>;
	onEditChild: (parent: WorkRow, row: WorkRow, edit: CellEdit) => void;
	readOnly?: boolean;
}

function Battery({ ctx, rows }: { ctx: BoardContext; rows: WorkRow[] }) {
	const slices = statusBattery(ctx, rows);
	if (!slices.length) return null;
	return (
		<span className="flex h-5 w-full overflow-hidden rounded-md" title={slices.map((s) => `${s.label}: ${s.count}`).join(' · ')} role="img" aria-label={`Status mix: ${slices.map((s) => `${s.label} ${s.count}`).join(', ')}`}>
			{slices.map((s) => <span key={s.slug} style={{ flex: s.count, background: s.color }} />)}
		</span>
	);
}

function AddRow({ colSpan, placeholder, onAdd }: { colSpan: number; placeholder: string; onAdd: (name: string) => Promise<boolean> }) {
	const [value, setValue] = useState('');
	const [busy, setBusy] = useState(false);
	return (
		<tr>
			<td className="border-b border-slate-200 dark:border-slate-700" />
			<td colSpan={colSpan} className="border-b border-slate-200 dark:border-slate-700 p-0">
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
					className="w-full h-9 px-3 text-sm bg-transparent placeholder:text-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-inset focus:ring-primary-500"
				/>
			</td>
		</tr>
	);
}

export default function BoardTable(p: BoardTableProps) {
	const { columns, ctx } = p;
	const nameWidth = 340;
	const colgroup = (
		<colgroup>
			<col style={{ width: 40 }} />
			<col style={{ width: nameWidth }} />
			{columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
		</colgroup>
	);
	const tableWidth = 40 + nameWidth + columns.reduce((a, c) => a + c.width, 0);

	if (!p.groups.length) {
		return <div className="mt-6 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center text-sm text-slate-600 dark:text-slate-400">{p.empty ?? 'Nothing here with these filters.'}</div>;
	}

	// Keyboard: ↓ / ↑ move between rows (focus lands on the name, Enter opens
	// the panel), Space on a name toggles its checkbox. Lets a daily user clear
	// a list without the mouse, the way the old queue's popover did. Expanded
	// sub-rows are not in the ↓ / ↑ order (v1). Space is cancelled on keyup as
	// well: Firefox / Safari fire a button's click from keyup even when keydown
	// was cancelled, which would open the panel on top of selecting.
	const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		const tr = target.closest<HTMLElement>('tr[data-row]');
		if (!tr) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const names = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row-name]'));
			const cur = tr.querySelector<HTMLElement>('[data-row-name]');
			const i = cur ? names.indexOf(cur) : -1;
			const next = names[i + (e.key === 'ArrowDown' ? 1 : -1)];
			if (next) { e.preventDefault(); next.focus(); }
		} else if (e.key === ' ' && target.hasAttribute('data-row-name')) {
			e.preventDefault();
			const id = tr.dataset.row;
			if (id) p.onToggleSelect([id], !p.selected.has(id));
		}
	};

	return (
		<div className="space-y-6 overflow-x-auto pb-2" onKeyDown={onKey} onKeyUp={(e) => { if (e.key === ' ' && (e.target as HTMLElement).hasAttribute('data-row-name')) e.preventDefault(); }}>
			{p.groups.map((g) => {
				const isCollapsed = p.collapsed.has(g.key);
				const ids = g.rows.map((r) => r.id);
				const allOn = ids.length > 0 && ids.every((id) => p.selected.has(id));
				return (
					<section key={g.key} style={{ ['--gc' as string]: g.color, minWidth: tableWidth }} aria-label={g.label}>
						<button
							type="button"
							onClick={() => p.onToggleCollapse(g.key)}
							aria-expanded={!isCollapsed}
							className={clsx('mb-1.5 flex items-center gap-2 rounded-md px-1 text-sm font-semibold', controlFocus)}
							style={{ color: g.color }}
						>
							{isCollapsed ? <ChevronRight className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
							<span>{g.label}</span>
							<span className="text-xs font-normal text-slate-500 dark:text-slate-400">{g.rows.length} {g.rows.length === 1 ? p.itemLabel : `${p.itemLabel}s`}</span>
						</button>
						<table className="w-full table-fixed border-separate border-spacing-0 bg-white dark:bg-slate-800 text-sm">
							{colgroup}
							{!isCollapsed && (
								<thead>
									<tr>
										<th className="sticky left-0 z-10 bg-white dark:bg-slate-800 border-y border-r border-slate-200 dark:border-slate-700 border-l-4 rounded-tl-md" style={{ borderLeftColor: g.color }}>
											<input type="checkbox" checked={allOn} onChange={(e) => p.onToggleSelect(ids, e.target.checked)} aria-label={`Select all in ${g.label}`} className="accent-primary-600" />
										</th>
										<th className="sticky left-10 z-10 bg-white dark:bg-slate-800 border-y border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-left text-xs font-medium text-slate-600 dark:text-slate-400">
											{p.itemLabel[0].toUpperCase() + p.itemLabel.slice(1)}
										</th>
										{columns.map((c) => (
											<th key={c.key} className="border-y border-r border-slate-200 dark:border-slate-700 px-2 py-2 text-center text-xs font-medium text-slate-600 dark:text-slate-400 truncate">{c.label}</th>
										))}
									</tr>
								</thead>
							)}
							<tbody>
								{isCollapsed ? (
									<tr>
										<td className="border border-l-4 border-slate-200 dark:border-slate-700 rounded-md" style={{ borderLeftColor: g.color }} />
										<td className="border-y border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500">{g.rows.length} collapsed</td>
										{columns.map((c) => (
											<td key={c.key} className="border-y border-r border-slate-200 dark:border-slate-700 px-2">
												{c.cell === 'status' ? <Battery ctx={ctx} rows={g.rows} /> : null}
											</td>
										))}
									</tr>
								) : (
									<>
										{g.rows.map((row) => {
											const canHaveChildren = !!CHILD_KINDS_FOR_PARENT[row.kind];
											const isOpen = p.expanded.has(row.id);
											const kids = p.childRows[row.id];
											const prog = ctx.progress[row.id];
											const isSel = p.selected.has(row.id);
											return (
												<RowFragment key={row.id}>
													<tr data-row={row.id} className={clsx('group', isSel ? 'bg-selected' : 'hover:bg-hover')}>
														<td className={clsx('sticky left-0 z-10 border-b border-r border-slate-200 dark:border-slate-700 border-l-4 text-center', isSel ? 'bg-selected' : 'bg-white dark:bg-slate-800 group-hover:bg-hover')} style={{ borderLeftColor: g.color }}>
															<input type="checkbox" checked={isSel} onChange={(e) => p.onToggleSelect([row.id], e.target.checked)} aria-label={`Select ${row.name}`} className="accent-primary-600" />
														</td>
														<td className={clsx('sticky left-10 z-10 border-b border-r border-slate-200 dark:border-slate-700 px-2', isSel ? 'bg-selected' : 'bg-white dark:bg-slate-800 group-hover:bg-hover')}>
															<div className="flex min-w-0 items-center gap-1.5">
																{canHaveChildren ? (
																	<button type="button" onClick={() => p.onToggleExpand(row)} aria-expanded={isOpen}
																		aria-label={`${isOpen ? 'Hide' : 'Show'} ${CHILD_KINDS_FOR_PARENT[row.kind][0]}s of ${row.name}`}
																		className={clsx('rounded-md p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200', controlFocus)}>
																		{isOpen ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
																	</button>
																) : <span className="w-4.5 shrink-0" />}
																<button type="button" data-row-name onClick={() => p.onOpen(row)} className={clsx('min-w-0 truncate text-left hover:text-primary-700 hover:underline dark:hover:text-primary-400', controlFocus)}>
																	{row.name}
																</button>
																{prog && prog.total > 0 && (
																	<span className="shrink-0 rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 text-2xs tabular-nums text-slate-600 dark:text-slate-300">{prog.done}/{prog.total}</span>
																)}
																<Link href={`/the-work/${row.id}`} aria-label={`Open ${row.name} page`} className={clsx('ml-auto shrink-0 rounded-md p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-slate-600 dark:text-slate-500', controlFocus)}>
																	<Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
																</Link>
															</div>
														</td>
														{columns.map((c) => (
															<td key={c.key} className="border-b border-r border-slate-200 dark:border-slate-700 p-0 h-9">
																<BoardCell col={c} row={row} ctx={ctx} groupColor={g.color} today={p.today} readOnly={p.readOnly}
																	onEdit={(e) => p.onEdit(row, e)} />
															</td>
														))}
													</tr>
													{isOpen && (
														<SubRows parent={row} rows={kids} colCount={columns.length} ctx={ctx} today={p.today}
															onEdit={(child, e) => p.onEditChild(row, child, e)}
															onAdd={p.onAddChild ? (name) => p.onAddChild!(row, name) : undefined}
															onOpen={p.onOpen} />
													)}
												</RowFragment>
											);
										})}
										{p.onAdd && (
											<AddRow colSpan={columns.length + 1} placeholder={`+ Add ${p.itemLabel}`} onAdd={(name) => p.onAdd!(g.key, name)} />
										)}
										<tr aria-hidden="true">
											<td />
											<td />
											{columns.map((c) => (
												<td key={c.key} className="px-2 py-1.5">
													{c.cell === 'status' ? <Battery ctx={ctx} rows={g.rows} /> : c.cell === 'progress' ? (
														<span className="block text-center text-2xs tabular-nums text-slate-500">
															{Math.round(g.rows.reduce((a, r) => a + progressOf(ctx, r), 0) / (g.rows.length || 1))}% avg
														</span>
													) : c.cell === 'custom' && c.custom?.type === 'number' ? (
														<span className="block text-right text-xs font-semibold tabular-nums">
															{g.rows.reduce((a, r) => a + Number(ctx.customValues[r.id]?.[c.key] ?? 0), 0).toLocaleString('en-US')}
															<span className="block text-2xs font-normal text-slate-500">sum</span>
														</span>
													) : null}
												</td>
											))}
										</tr>
									</>
								)}
							</tbody>
						</table>
					</section>
				);
			})}
		</div>
	);
}

function RowFragment({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}

function SubRows({ parent, rows, colCount, ctx, today, onEdit, onAdd, onOpen }: {
	parent: WorkRow; rows: WorkRow[] | 'loading' | undefined; colCount: number; ctx: BoardContext; today: string;
	onEdit: (row: WorkRow, e: CellEdit) => void; onAdd?: (name: string) => Promise<boolean>; onOpen: (row: WorkRow) => void;
}) {
	const childKind = CHILD_KINDS_FOR_PARENT[parent.kind]?.[0] ?? 'item';
	const label = KIND_LABELS[childKind] ?? childKind;
	if (rows === 'loading' || rows === undefined) {
		return <tr><td /><td colSpan={colCount + 1} className="bg-slate-50 dark:bg-slate-900 px-10 py-2 text-xs text-slate-500">Loading {label.toLowerCase()}s…</td></tr>;
	}
	return (
		<>
			<tr>
				<td className="bg-slate-50 dark:bg-slate-900" />
				<td className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 pl-10 pr-2 py-1 text-2xs font-medium uppercase tracking-wide text-slate-500">{label}</td>
				<td colSpan={colCount} className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-2 py-1 text-2xs text-slate-500">Owner · Status · Due</td>
			</tr>
			{rows.map((r) => (
				<tr key={r.id} className="bg-slate-50 dark:bg-slate-900">
					<td />
					<td className="border-b border-r border-slate-200 dark:border-slate-700 pl-8 pr-2">
						<span className="flex min-w-0 items-center gap-1.5 text-slate-700 dark:text-slate-300">
							<CornerDownRight className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden="true" />
							<button type="button" onClick={() => onOpen(r)} className={clsx('min-w-0 truncate text-left hover:underline', controlFocus)}>{r.name}</button>
						</span>
					</td>
					<td colSpan={colCount} className="border-b border-slate-200 dark:border-slate-700 p-0">
						<span className="flex h-9 items-stretch">
							<span className="flex w-32 min-w-0 items-center px-2">{r.owner_id ? <OwnerChip id={r.owner_id} ctx={ctx} className="text-sm" /> : <span className="text-slate-400">—</span>}</span>
							<span className="w-32"><StatusCell row={r} ctx={ctx} onEdit={(e) => onEdit(r, e)} /></span>
							<span className={clsx('flex w-24 items-center justify-center text-xs tabular-nums', r.ends_at && r.ends_at < today ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300')}>
								{r.ends_at ? formatShortDate(r.ends_at) : '—'}
							</span>
						</span>
					</td>
				</tr>
			))}
			{!rows.length && (
				<tr className="bg-slate-50 dark:bg-slate-900"><td /><td colSpan={colCount + 1} className="border-b border-slate-200 dark:border-slate-700 pl-10 py-2 text-xs text-slate-500">No {label.toLowerCase()}s yet.</td></tr>
			)}
			{onAdd && (
				<tr className="bg-slate-50 dark:bg-slate-900">
					<td />
					<td colSpan={colCount + 1} className="border-b border-slate-200 dark:border-slate-700 p-0">
						<SubAdd label={label} onAdd={onAdd} />
					</td>
				</tr>
			)}
		</>
	);
}

function SubAdd({ label, onAdd }: { label: string; onAdd: (name: string) => Promise<boolean> }) {
	const [v, setV] = useState('');
	return (
		<span className="flex items-center gap-1 pl-10">
			<Plus className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
			<input value={v} onChange={(e) => setV(e.target.value)} placeholder={`+ Add ${label.toLowerCase()}`} aria-label={`Add ${label.toLowerCase()}`}
				onKeyDown={async (e) => { if (e.key === 'Enter' && v.trim()) { if (await onAdd(v.trim())) setV(''); } }}
				className="h-8 flex-1 bg-transparent text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500" />
		</span>
	);
}
