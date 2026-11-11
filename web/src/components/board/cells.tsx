'use client';

// Board cells (spec §6). Each cell renders one value and, when editable,
// opens a Popover to change it. Edits go through `onEdit`, which the table
// wires to an optimistic server action — cells never call the server.
//
// Colours come from the data (status / department / dropdown hexes in the
// DB), so they are inline styles; text colour is picked for contrast.

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, CalendarPlus, Check, Square, CheckSquare, UserPlus, ExternalLink } from 'lucide-react';
import Popover from '@/components/ui/Popover';
import { controlFocus } from '@/components/ui/focus';
import { statusDef, statusesFor, isLate, progressOf, KIND_LABELS, NEUTRAL_COLOR } from '@/lib/work/boards/groups';
import { statusTone, TONE_BADGE, TONE_DOT, URGENCY_TONE, SEVERITY_TONE, type Tone } from '@/lib/work/hub/rows';
import { vizFor } from '@/lib/colors';
import type { ColumnDef } from '@/lib/work/boards/columns';
import type { BoardContext, CustomValue, WorkRow } from '@/lib/work/boards/types';
import { formatShortDate } from './format';

export type CellEdit =
	| { kind: 'field'; field: 'status' | 'owner_id' | 'ends_at' | 'starts_at' | 'department_tag_id' | 'quarter_id' | 'priority' | 'project_lead_id' | 'sub_team_tag_id' | 'severity' | 'discipline_id' | 'client_id'; value: string | null }
	| { kind: 'custom'; columnId: string; columnKey: string; value: CustomValue };

// Style guide decision 8: avatar colours are token-backed (lib/colors VIZ),
// never a hard-coded hex list.
export function avatarColor(id: string): string {
	return vizFor(id);
}

export function Avatar({ id, ctx, size = 24 }: { id: string; ctx: Pick<BoardContext, 'people'>; size?: number }) {
	const p = ctx.people[id];
	return (
		<span
			title={p?.name ?? 'Former member'}
			className="inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-800 shrink-0"
			style={{ width: size, height: size, fontSize: size <= 24 ? 10.5 : 12, background: avatarColor(id) }}
		>
			{p?.initials ?? '?'}
		</span>
	);
}

/** "Sam Carter" → "Sam M.": initials alone didn't tell ~30 owners apart. */
export function shortName(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2 || name.includes('@')) return name;
	return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Owner as avatar + short name (full name on hover). */
export function OwnerChip({ id, ctx, size = 22, className }: { id: string; ctx: Pick<BoardContext, 'people'>; size?: number; className?: string }) {
	const name = ctx.people[id]?.name;
	return (
		<span className={clsx('inline-flex min-w-0 items-center gap-1.5', className)} title={name ?? 'Former member'}>
			<Avatar id={id} ctx={ctx} size={size} />
			<span className="truncate text-slate-700 dark:text-slate-200">{name ? shortName(name) : 'Former member'}</span>
		</span>
	);
}

/** The clickable surface of a cell: fills the td, shows a focus ring. */
function CellButton({ children, onClick, label, className, style, disabled, btnRef }: {
	children: React.ReactNode; onClick?: () => void; label: string; className?: string; style?: React.CSSProperties; disabled?: boolean;
	btnRef?: React.Ref<HTMLButtonElement>;
}) {
	return (
		<button
			ref={btnRef}
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			style={style}
			className={clsx('w-full h-full min-h-9 flex items-center justify-center px-2 text-sm', controlFocus, !disabled && 'cursor-pointer hover:bg-hover', disabled && 'cursor-default', className)}
		>
			{children}
		</button>
	);
}

function usePop() {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return { ref, open, setOpen };
}

// ------------------------------------------------------------------ status

export function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
	return (
		<span className={clsx('inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-0.5 text-xs font-medium', TONE_BADGE[tone], className)}>
			<span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true" />
			<span className="truncate">{children}</span>
		</span>
	);
}

/** Rework 8.5: quieter status badges in token colours (tone from the status category). */
export function StatusCell({ row, ctx, onEdit, readOnly }: { row: WorkRow; ctx: BoardContext; onEdit: (e: CellEdit) => void; readOnly?: boolean }) {
	const pop = usePop();
	const s = statusDef(ctx, row);
	return (
		<>
			<CellButton
				btnRef={pop.ref}
				label={`Status: ${s.label}. Change status`}
				disabled={readOnly}
				onClick={() => pop.setOpen(true)}
				className="justify-start"
			>
				<ToneBadge tone={statusTone(s)}>{s.label}</ToneBadge>
			</CellButton>
			<Popover open={pop.open} onClose={() => pop.setOpen(false)} anchorRef={pop.ref} width="w-56">
				<div className="p-1.5" role="menu" aria-label="Status">
					{statusesFor(ctx, row.kind).map((o) => (
						<button
							key={o.slug}
							type="button"
							role="menuitemradio"
							aria-checked={o.slug === row.status}
							onClick={() => { pop.setOpen(false); if (o.slug !== row.status) onEdit({ kind: 'field', field: 'status', value: o.slug }); }}
							className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, o.slug === row.status && 'bg-selected')}
						>
							<span className={clsx('h-2 w-2 shrink-0 rounded-full', TONE_DOT[statusTone(o)])} aria-hidden="true" />
							<span className="flex-1 truncate">{o.label}</span>
							{o.slug === row.status && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />}
						</button>
					))}
				</div>
			</Popover>
		</>
	);
}

// ------------------------------------------------------------------ person

export function PersonCell({ value, ctx, onPick, label, readOnly }: {
	value: string | null; ctx: BoardContext; onPick: (id: string | null) => void; label: string; readOnly?: boolean;
}) {
	const pop = usePop();
	const [q, setQ] = useState('');
	const people = Object.entries(ctx.people)
		.filter(([, p]) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
		.sort((a, b) => a[1].name.localeCompare(b[1].name))
		.slice(0, 40);
	return (
		<>
			<CellButton btnRef={pop.ref} label={value ? `${label}: ${ctx.people[value]?.name ?? 'Former member'}. Change` : `Set ${label.toLowerCase()}`} disabled={readOnly} onClick={() => pop.setOpen(true)}>
				{value ? <span className="flex w-full min-w-0"><OwnerChip id={value} ctx={ctx} /></span> : <UserPlus className="w-4 h-4 text-slate-400" aria-hidden="true" />}
			</CellButton>
			<Popover open={pop.open} onClose={() => pop.setOpen(false)} anchorRef={pop.ref} width="w-64">
				<div className="p-2">
					<input
						autoFocus
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Search people"
						aria-label="Search people"
						className="w-full mb-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
					/>
					<div className="max-h-64 overflow-y-auto">
						{value && (
							<button type="button" onClick={() => { pop.setOpen(false); onPick(null); }} className={clsx('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-hover', controlFocus)}>
								Clear
							</button>
						)}
						{people.map(([id, p]) => (
							<button key={id} type="button" onClick={() => { pop.setOpen(false); setQ(''); if (id !== value) onPick(id); }}
								className={clsx('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-hover', controlFocus, id === value && 'bg-selected')}>
								<Avatar id={id} ctx={ctx} size={22} />
								<span className="truncate">{p.name}</span>
								{id === value && <Check className="w-4 h-4 ml-auto text-primary-600" aria-hidden="true" />}
							</button>
						))}
					</div>
				</div>
			</Popover>
		</>
	);
}

// -------------------------------------------------------------------- date

export function DateCell({ value, late, onPick, label, readOnly }: { value: string | null; late?: boolean; onPick: (v: string | null) => void; label: string; readOnly?: boolean }) {
	const pop = usePop();
	const [draft, setDraft] = useState(value ?? '');
	return (
		<>
			<CellButton
				btnRef={pop.ref}
				label={value ? `${label}: ${formatShortDate(value)}${late ? ', overdue' : ''}. Change` : `Set ${label.toLowerCase()}`}
				disabled={readOnly}
				onClick={() => { setDraft(value ?? ''); pop.setOpen(true); }}
				className={clsx(late ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300', 'gap-1 tabular-nums')}
			>
				{value ? formatShortDate(value) : <CalendarPlus className="w-4 h-4 text-slate-400" aria-hidden="true" />}
				{late && <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}
			</CellButton>
			<Popover open={pop.open} onClose={() => pop.setOpen(false)} anchorRef={pop.ref} width="w-60">
				<form className="p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); pop.setOpen(false); onPick(draft || null); }}>
					<label className="block text-2xs font-medium uppercase tracking-wide text-slate-500" htmlFor="cell-date">{label}</label>
					<input id="cell-date" type="date" value={draft} onChange={(e) => setDraft(e.target.value)}
						className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500" />
					<div className="flex justify-between gap-2">
						<button type="button" className={clsx('text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200', controlFocus)} onClick={() => { pop.setOpen(false); onPick(null); }}>Clear</button>
						<button type="submit" className={clsx('rounded-md bg-primary-700 px-3 py-1 text-xs font-medium text-white hover:bg-primary-800', controlFocus)}>Save</button>
					</div>
				</form>
			</Popover>
		</>
	);
}

// ----------------------------------------------------------------- options

function OptionCell({ value, options, onPick, label, readOnly, emptyLabel = '—' }: {
	value: string | null;
	options: { id: string; label: string; color?: string | null; tone?: Tone }[];
	onPick: (id: string | null) => void;
	label: string;
	readOnly?: boolean;
	emptyLabel?: string;
}) {
	const pop = usePop();
	const cur = options.find((o) => o.id === value);
	const dot = (o: { color?: string | null; tone?: Tone }) =>
		o.tone ? <span className={clsx('h-2 w-2 shrink-0 rounded-full', TONE_DOT[o.tone])} aria-hidden="true" />
			: <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.color ?? NEUTRAL_COLOR }} aria-hidden="true" />;
	return (
		<>
			<CellButton btnRef={pop.ref} label={cur ? `${label}: ${cur.label}. Change` : `Set ${label.toLowerCase()}`} disabled={readOnly} onClick={() => pop.setOpen(true)} className="justify-start">
				{cur ? (
					cur.tone ? <ToneBadge tone={cur.tone}>{cur.label}</ToneBadge> : (
						<span className="inline-flex min-w-0 items-center gap-1.5 text-13 text-slate-700 dark:text-slate-200">{dot(cur)}<span className="truncate">{cur.label}</span></span>
					)
				) : <span className="text-slate-400">{emptyLabel}</span>}
			</CellButton>
			<Popover open={pop.open} onClose={() => pop.setOpen(false)} anchorRef={pop.ref} width="w-56">
				<div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5" role="menu" aria-label={label}>
					{options.map((o) => (
						<button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === value} onClick={() => { pop.setOpen(false); if (o.id !== value) onPick(o.id); }}
							className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, o.id === value && 'bg-selected')}>
							{dot(o)}
							<span className="truncate">{o.label}</span>
						</button>
					))}
					{value && (
						<button type="button" onClick={() => { pop.setOpen(false); onPick(null); }} className={clsx('w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-hover', controlFocus)}>Clear</button>
					)}
				</div>
			</Popover>
		</>
	);
}

// --------------------------------------------------------------- read-only

function Timeline({ row, color, today }: { row: WorkRow; color: string; today: string }) {
	if (!row.starts_at && !row.ends_at) return <span className="text-slate-400">—</span>;
	const start = row.starts_at ?? row.ends_at!, end = row.ends_at ?? row.starts_at!;
	const s = Date.parse(start), e = Date.parse(end), t = Date.parse(today);
	const pct = e > s ? Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100)) : t >= e ? 100 : 0;
	return (
		<span className="relative w-full h-5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-2xs font-medium">
			{/* Elapsed share of the range, in the group colour at ~40% so the
			    dates stay readable on top in both themes. */}
			<span className="absolute inset-y-0 left-0 opacity-40" style={{ width: `${pct}%`, background: color }} aria-hidden="true" />
			<span className="relative tabular-nums text-slate-900 dark:text-slate-100">{formatShortDate(start)} – {formatShortDate(end)}</span>
		</span>
	);
}

function Progress({ value }: { value: number }) {
	return (
		<span className="w-full flex items-center gap-1.5" aria-label={`${value}% done`}>
			<span className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
				<span className="block h-full bg-green-500" style={{ width: `${value}%` }} />
			</span>
			<span className="w-8 text-right text-2xs tabular-nums text-slate-600 dark:text-slate-400">{value}%</span>
		</span>
	);
}

// ------------------------------------------------------------------ router

export function BoardCell({ col, row, ctx, groupColor, today, onEdit, readOnly }: {
	col: ColumnDef; row: WorkRow; ctx: BoardContext; groupColor: string; today: string; onEdit: (e: CellEdit) => void; readOnly?: boolean;
}) {
	const late = isLate(ctx, row, today);
	switch (col.cell) {
		case 'status':
			return <StatusCell row={row} ctx={ctx} onEdit={onEdit} readOnly={readOnly} />;
		case 'person':
			return <PersonCell value={row.owner_id} ctx={ctx} label="Owner" readOnly={readOnly} onPick={(v) => onEdit({ kind: 'field', field: 'owner_id', value: v })} />;
		case 'date':
			return <DateCell value={row.ends_at} late={late} label="Due" readOnly={readOnly} onPick={(v) => onEdit({ kind: 'field', field: 'ends_at', value: v })} />;
		case 'timeline':
			return <span className="flex h-full items-center px-2"><Timeline row={row} color={groupColor} today={today} /></span>;
		case 'progress':
			return <span className="flex h-full items-center px-2"><Progress value={progressOf(ctx, row)} /></span>;
		case 'department':
			return <OptionCell value={row.department_tag_id} label="Department" readOnly={readOnly}
				options={Object.entries(ctx.departments).map(([id, d]) => ({ id, label: d.label, color: d.color }))}
				onPick={(v) => onEdit({ kind: 'field', field: 'department_tag_id', value: v })} />;
		case 'quarter':
			return <OptionCell value={row.quarter_id} label="Quarter" readOnly={readOnly}
				options={Object.entries(ctx.quarters).map(([id, q]) => ({ id, label: q.name, color: null }))}
				onPick={(v) => onEdit({ kind: 'field', field: 'quarter_id', value: v })} />;
		case 'urgency':
			return <OptionCell value={row.priority} label="Urgency" readOnly={readOnly}
				options={['urgent', 'high', 'medium', 'low'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), tone: URGENCY_TONE[id] }))}
				onPick={(v) => onEdit({ kind: 'field', field: 'priority', value: v })} />;
		case 'severity':
			return <OptionCell value={row.severity ?? null} label="Severity" readOnly={readOnly}
				options={['critical', 'high', 'medium', 'low'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), tone: SEVERITY_TONE[id] }))}
				onPick={(v) => onEdit({ kind: 'field', field: 'severity', value: v })} />;
		case 'lead':
			return <PersonCell value={row.project_lead_id ?? null} ctx={ctx} label="Lead" readOnly={readOnly} onPick={(v) => onEdit({ kind: 'field', field: 'project_lead_id', value: v })} />;
		case 'start':
			return <DateCell value={row.starts_at} label="Start" readOnly={readOnly} onPick={(v) => onEdit({ kind: 'field', field: 'starts_at', value: v })} />;
		case 'subdept':
			return <OptionCell value={row.sub_team_tag_id ?? null} label="Sub-department" readOnly={readOnly}
				options={Object.entries(ctx.subdepts ?? {}).filter(([, s]) => !row.department_tag_id || !s.parent || s.parent === row.department_tag_id).map(([id, s]) => ({ id, label: s.label, color: null }))}
				onPick={(v) => onEdit({ kind: 'field', field: 'sub_team_tag_id', value: v })} />;
		case 'discipline':
			return <OptionCell value={row.discipline_id ?? null} label="Discipline" readOnly={readOnly}
				options={Object.entries(ctx.disciplines ?? {}).sort((a, b) => a[1].position - b[1].position).map(([id, d], i) => ({ id, label: d.label, color: null, tone: (['primary', 'success', 'warning', 'neutral', 'danger'] as Tone[])[i % 5] }))}
				onPick={(v) => onEdit({ kind: 'field', field: 'discipline_id', value: v })} />;
		case 'updated':
			return <span className="flex h-full items-center justify-center px-2 text-xs tabular-nums text-slate-600 dark:text-slate-300">{row.updated_at ? formatShortDate(row.updated_at.slice(0, 10)) : '—'}</span>;
		case 'followers': {
			const f = ctx.followers[row.id] ?? [];
			return (
				<span className="flex h-full items-center justify-center px-2" title={f.map((id) => ctx.people[id]?.name ?? '').join(', ')}>
					{f.slice(0, 3).map((id, i) => <span key={id} className={i ? '-ml-1.5' : ''}><Avatar id={id} ctx={ctx} size={22} /></span>)}
					{f.length > 3 && <span className="ml-1 text-2xs text-slate-500">+{f.length - 3}</span>}
					{!f.length && <span className="text-slate-400">—</span>}
				</span>
			);
		}
		case 'client':
			return <span className="flex h-full items-center px-2 text-sm truncate">{row.client_id ? ctx.clients[row.client_id]?.name ?? '—' : <span className="text-slate-400">—</span>}</span>;
		case 'parent':
			return <span className="flex h-full items-center px-2 text-sm truncate text-slate-600 dark:text-slate-300">{row.parent_id ? ctx.parents[row.parent_id]?.name ?? '—' : <span className="text-slate-400">—</span>}</span>;
		case 'kind':
			return <span className="flex h-full items-center justify-center px-2 text-xs text-slate-600 dark:text-slate-300">{KIND_LABELS[row.kind] ?? row.kind}</span>;
		case 'custom':
			return <CustomCell col={col} row={row} ctx={ctx} onEdit={onEdit} readOnly={readOnly} />;
		default:
			return null;
	}
}

function CustomCell({ col, row, ctx, onEdit, readOnly }: { col: ColumnDef; row: WorkRow; ctx: BoardContext; onEdit: (e: CellEdit) => void; readOnly?: boolean }) {
	const c = col.custom!;
	const value = ctx.customValues[row.id]?.[c.key] ?? null;
	const set = (v: CustomValue) => onEdit({ kind: 'custom', columnId: c.id, columnKey: c.key, value: v });
	if (c.type === 'checkbox') {
		return (
			<CellButton label={`${c.label}: ${value ? 'checked' : 'unchecked'}. Toggle`} disabled={readOnly} onClick={() => set(!value)}>
				{value ? <CheckSquare className="w-4 h-4 text-green-600" aria-hidden="true" /> : <Square className="w-4 h-4 text-slate-400" aria-hidden="true" />}
			</CellButton>
		);
	}
	if (c.type === 'dropdown') {
		return <OptionCell value={(value as string) ?? null} label={c.label} readOnly={readOnly} options={c.options.options ?? []} onPick={set} />;
	}
	if (c.type === 'person') {
		return <PersonCell value={(value as string) ?? null} ctx={ctx} label={c.label} readOnly={readOnly} onPick={set} />;
	}
	if (c.type === 'date') {
		return <DateCell value={(value as string) ?? null} label={c.label} readOnly={readOnly} onPick={set} />;
	}
	return <TextCell value={value} type={c.type} label={c.label} readOnly={readOnly} onSave={set} />;
}

function TextCell({ value, type, label, onSave, readOnly }: { value: CustomValue; type: string; label: string; onSave: (v: CustomValue) => void; readOnly?: boolean }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState('');
	if (editing) {
		return (
			<input
				autoFocus
				aria-label={label}
				type={type === 'number' ? 'number' : type === 'link' ? 'url' : 'text'}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => { setEditing(false); if (draft !== String(value ?? '')) onSave(draft === '' ? null : type === 'number' ? Number(draft) : draft); }}
				onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(String(value ?? '')); setEditing(false); } }}
				className="w-full h-9 px-2 text-sm bg-white dark:bg-slate-800 border-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
			/>
		);
	}
	const display = value === null || value === '' ? null
		: type === 'number' ? Number(value).toLocaleString('en-US') : String(value);
	return (
		<CellButton label={display ? `${label}: ${display}. Edit` : `Set ${label.toLowerCase()}`} disabled={readOnly}
			onClick={() => { setDraft(String(value ?? '')); setEditing(true); }}
			className={clsx(type === 'number' ? 'justify-end tabular-nums' : 'justify-start')}>
			{display ? (
				type === 'link' ? (
					<a href={display} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 truncate text-primary-700 dark:text-primary-400 hover:underline">
						<span className="truncate">{display.replace(/^https?:\/\//, '')}</span><ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
					</a>
				) : <span className="truncate">{display}</span>
			) : <span className="text-slate-400">—</span>}
		</CellButton>
	);
}
