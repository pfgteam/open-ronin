'use client';

// Every planning field for an item, by kind (rework D4, D11, 5.3): the
// drawer renders fieldsFor(kind) in order and each edit saves ONE field
// (patch semantics). Progress is a slider over the automatic rollup: drag
// to set a manual value, one click back to automatic (D14).

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Check, Plus, RotateCcw, Unlink, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Popover from '@/components/ui/Popover';
import Toggle from '@/components/ui/Toggle';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { controlFocus, fieldFocus } from '@/components/ui/focus';
import { BUILTIN_COLUMNS } from '@/lib/work/boards/columns';
import { KIND_LABELS } from '@/lib/work/boards/groups';
import type { BoardContext } from '@/lib/work/boards/types';
import { fieldsFor, type FieldDef } from '@/lib/work/fields';
import { autoProgress } from '@/lib/work/hub/rows';
import { PARENT_KIND_FOR } from '@/app/(app)/the-work/hierarchy';
import { searchParents, type EditableField } from '@/app/(app)/the-work/b/actions';
import type { PanelItem } from '@/app/(app)/the-work/b/panelActions';
import { Avatar, BoardCell, type CellEdit } from '@/components/board/cells';
import ClientSelect from './ClientSelect';

const CELL_FOR: Record<string, string> = {
	status: 'status', owner: 'owner', lead: 'lead', urgency: 'urgency', quarter: 'quarter', department: 'department',
	subdept: 'subdept', discipline: 'discipline', severity: 'severity', due: 'due', start: 'start',
};

export interface ItemFieldsProps {
	item: PanelItem;
	ctx: BoardContext;
	today: string;
	parent: { id: string; name: string; kind: string } | null;
	owners: string[];
	tags: string[];
	readOnly?: boolean;
	onEdit: (field: EditableField, value: string | null) => Promise<void> | void;
	onCoOwner: (userId: string, on: boolean) => void;
	onTag: (tagId: string, on: boolean) => void;
	onOpenItem?: (id: string) => void;
	/** Only these keys (the drawer splits short fields from long text). */
	only?: (f: FieldDef) => boolean;
}

export default function ItemFields(p: ItemFieldsProps) {
	const fields = fieldsFor(p.item.kind).filter((f) => (p.only ? p.only(f) : true));
	const short = fields.filter((f) => f.type !== 'markdown');
	const long = fields.filter((f) => f.type === 'markdown');
	return (
		<div className="space-y-3">
			{short.length > 0 && (
				<dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-slate-200 text-sm dark:border-slate-700 sm:grid-cols-[8rem_minmax(0,1fr)]">
					{short.map((f) => (
						<Row key={f.key} label={f.label} help={f.help} wide={f.type === 'progress' || f.type === 'owners' || f.type === 'tags'}>
							<Field f={f} p={p} />
						</Row>
					))}
				</dl>
			)}
			{long.map((f) => <MarkdownField key={f.key} label={f.label} value={(p.item as unknown as Record<string, string | null>)[f.column!] ?? null} readOnly={p.readOnly} onSave={(v) => p.onEdit(f.column!, v)} />)}
		</div>
	);
}

function Row({ label, help, children, wide }: { label: string; help?: string; children: React.ReactNode; wide?: boolean }) {
	return (
		<>
			<dt className="flex items-center border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 sm:min-h-10" title={help}>{label}</dt>
			<dd className={clsx('flex min-h-10 min-w-0 items-center border-b border-slate-200 dark:border-slate-700', wide && 'py-1.5')}>{children}</dd>
		</>
	);
}

function Field({ f, p }: { f: FieldDef; p: ItemFieldsProps }) {
	const item = p.item;
	const v = (col: string) => (item as unknown as Record<string, unknown>)[col];
	const cellKey = CELL_FOR[f.key];
	if (cellKey) {
		const col = BUILTIN_COLUMNS.find((c) => c.key === cellKey)!;
		return (
			<div className="h-10 w-full">
				<BoardCell col={col} row={item} ctx={p.ctx} groupColor="var(--c-primary-600)" today={p.today} readOnly={p.readOnly}
					onEdit={(e: CellEdit) => { if (e.kind === 'field') void p.onEdit(e.field as EditableField, e.value); }} />
			</div>
		);
	}
	switch (f.type) {
		case 'client':
			return (
				<div className="w-full px-1">
					<ClientSelect label="" size="sm" value={item.client_id ?? ''} currentName={item.client_id ? p.ctx.clients[item.client_id]?.name : null}
						onChange={(val) => void p.onEdit('client_id', val || null)}
						className="min-w-0 border-transparent bg-transparent hover:border-slate-300 dark:border-transparent dark:bg-transparent dark:hover:border-slate-600" />
				</div>
			);
		case 'parent':
			return <ParentField kind={item.kind} parent={p.parent} readOnly={p.readOnly} onPick={(id) => void p.onEdit('parent_id', id)} onOpen={p.onOpenItem} />;
		case 'owners':
			return <OwnersField ctx={p.ctx} owners={p.owners} ownerId={item.owner_id} readOnly={p.readOnly} onToggle={p.onCoOwner} />;
		case 'tags':
			return <TagsField ctx={p.ctx} tags={p.tags} readOnly={p.readOnly} onToggle={p.onTag} />;
		case 'boolean':
			return <div className="px-3"><Toggle label={f.label} hideLabel checked={!!v(f.column!)} disabled={p.readOnly} onChange={(on) => void p.onEdit(f.column!, on ? 'true' : 'false')} /></div>;
		case 'number':
		case 'text':
			return <InlineText value={v(f.column!) as string | number | null} type={f.type} label={f.label} readOnly={p.readOnly} onSave={(val) => void p.onEdit(f.column!, val)} />;
		case 'progress':
			return <ProgressField item={item} ctx={p.ctx} readOnly={p.readOnly} onSet={(val) => void p.onEdit('manual_progress', val === null ? null : String(val))} />;
		case 'health':
			return <HealthField value={item.manual_health ?? null} readOnly={p.readOnly} onSet={(val) => void p.onEdit('manual_health', val)} />;
		case 'timeframe':
			return <TimeframeField grain={(item as PanelItem).timeframe_grain} value={(item as PanelItem).timeframe_value} readOnly={p.readOnly} onEdit={p.onEdit} />;
		default:
			return <span className="px-3 text-slate-400">—</span>;
	}
}

function InlineText({ value, type, label, readOnly, onSave }: { value: string | number | null; type: 'text' | 'number'; label: string; readOnly?: boolean; onSave: (v: string | null) => void }) {
	const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value));
	useEffect(() => { setDraft(value === null || value === undefined ? '' : String(value)); }, [value]);
	return (
		<input
			aria-label={label}
			type={type === 'number' ? 'number' : 'text'}
			inputMode={type === 'number' ? 'decimal' : undefined}
			value={draft}
			disabled={readOnly}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => { const cur = value === null || value === undefined ? '' : String(value); if (draft !== cur) onSave(draft.trim() === '' ? null : draft.trim()); }}
			onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
			placeholder="—"
			className={clsx('h-10 w-full bg-transparent px-3 text-sm placeholder:text-slate-400 hover:bg-hover focus:bg-white dark:focus:bg-slate-800', fieldFocus, 'border-0 focus:ring-inset')}
		/>
	);
}

function ProgressField({ item, ctx, readOnly, onSet }: { item: PanelItem; ctx: BoardContext; readOnly?: boolean; onSet: (v: number | null) => void }) {
	const auto = autoProgress(ctx, item);
	const manual = typeof item.manual_progress === 'number';
	const shown = manual ? Math.round(item.manual_progress as number) : auto;
	const [drag, setDrag] = useState<number | null>(null);
	const value = drag ?? shown;
	return (
		<div className="flex w-full items-center gap-3 px-3">
			<input
				type="range" min={0} max={100} step={5} value={value} disabled={readOnly}
				aria-label={`Progress, ${manual ? 'set by hand' : 'automatic'}`}
				aria-valuetext={`${value}%`}
				onChange={(e) => setDrag(Number(e.target.value))}
				onPointerUp={() => { if (drag !== null && drag !== shown) onSet(drag); setDrag(null); }}
				onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && drag !== null) { onSet(drag); setDrag(null); } }}
				className="h-2 flex-1 cursor-pointer accent-primary-600 disabled:cursor-default"
			/>
			<span className="w-10 text-right text-sm font-semibold tabular-nums">{value}%</span>
			{manual ? (
				<span className="flex shrink-0 items-center gap-1">
					<span className="rounded-md bg-amber-50 px-1.5 text-2xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title={`Automatic would be ${auto}%`}>Manual</span>
					<Button size="sm" variant="ghost" disabled={readOnly} onClick={() => onSet(null)}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Automatic ({auto}%)</Button>
				</span>
			) : <span className="shrink-0 text-2xs text-slate-500">Automatic</span>}
		</div>
	);
}

const HEALTH: { key: 'on_track' | 'at_risk' | 'off_track'; label: string; tone: string }[] = [
	{ key: 'on_track', label: 'On track', tone: 'bg-green-50 text-green-800 border-green-600 dark:bg-green-950/40 dark:text-green-300' },
	{ key: 'at_risk', label: 'At risk', tone: 'bg-amber-50 text-amber-800 border-amber-500 dark:bg-amber-950/40 dark:text-amber-300' },
	{ key: 'off_track', label: 'Off track', tone: 'bg-red-50 text-red-700 border-red-600 dark:bg-red-950/40 dark:text-red-300' },
];

function HealthField({ value, readOnly, onSet }: { value: string | null; readOnly?: boolean; onSet: (v: string | null) => void }) {
	return (
		<div className="flex flex-wrap items-center gap-1 px-3 py-1.5" role="radiogroup" aria-label="Health">
			<button type="button" role="radio" aria-checked={!value} disabled={readOnly} onClick={() => onSet(null)}
				className={clsx('rounded-md border px-2 py-0.5 text-xs', controlFocus, !value ? 'border-primary-600 bg-selected font-medium' : 'border-slate-300 dark:border-slate-600')}>Automatic</button>
			{HEALTH.map((h) => (
				<button key={h.key} type="button" role="radio" aria-checked={value === h.key} disabled={readOnly} onClick={() => onSet(h.key)}
					className={clsx('rounded-md border px-2 py-0.5 text-xs', controlFocus, value === h.key ? `${h.tone} font-medium` : 'border-slate-300 dark:border-slate-600')}>{h.label}</button>
			))}
		</div>
	);
}

function TimeframeField({ grain, value, readOnly, onEdit }: { grain: string | null; value: string | null; readOnly?: boolean; onEdit: ItemFieldsProps['onEdit'] }) {
	return (
		<div className="flex w-full items-center gap-2 px-2 py-1">
			<select aria-label="Timeframe grain" value={grain ?? ''} disabled={readOnly} onChange={(e) => void onEdit('timeframe_grain', e.target.value || null)}
				className={clsx('h-8 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800', fieldFocus)}>
				<option value="">—</option>
				{['year', 'quarter', 'month', 'week'].map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
			</select>
			<InlineText value={value} type="text" label="Timeframe value (2026, 26-4, 2026-11, 26-4:W3)" readOnly={readOnly || !grain} onSave={(v) => void onEdit('timeframe_value', v)} />
		</div>
	);
}

function ParentField({ kind, parent, readOnly, onPick, onOpen }: { kind: string; parent: { id: string; name: string } | null; readOnly?: boolean; onPick: (id: string | null) => void; onOpen?: (id: string) => void }) {
	const parentKind = PARENT_KIND_FOR[kind];
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState('');
	const [opts, setOpts] = useState<{ id: string; name: string }[]>([]);
	useEffect(() => {
		if (!open || !parentKind) return;
		const t = setTimeout(() => { void searchParents(parentKind, q).then((r) => setOpts(r.ok ? r.data : [])); }, 200);
		return () => clearTimeout(t);
	}, [open, q, parentKind]);
	if (!parentKind) return <span className="px-3 text-slate-400">—</span>;
	return (
		<div className="flex w-full min-w-0 items-center gap-1 px-1">
			<button ref={ref} type="button" disabled={readOnly} onClick={() => setOpen(true)}
				className={clsx('flex h-8 min-w-0 flex-1 items-center rounded-md px-2 text-left text-sm hover:bg-hover', controlFocus)}>
				{parent ? <span className="truncate">{parent.name}</span> : <span className="text-slate-400">No {KIND_LABELS[parentKind]?.toLowerCase() ?? parentKind}</span>}
			</button>
			{parent && onOpen && <Button size="sm" variant="ghost" onClick={() => onOpen(parent.id)}>Open</Button>}
			{parent && !readOnly && <IconButton aria-label="Detach from parent" size="sm" onClick={() => onPick(null)}><Unlink className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>}
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width="w-72">
				<div className="p-2">
					<Input aria-label={`Search ${KIND_LABELS[parentKind]?.toLowerCase() ?? parentKind}s`} placeholder={`Find a ${KIND_LABELS[parentKind]?.toLowerCase() ?? parentKind}`} value={q} onChange={(e) => setQ(e.target.value)} />
					<ul className="mt-1 max-h-64 overflow-y-auto" role="listbox" aria-label="Parents">
						{opts.map((o) => (
							<li key={o.id}>
								<button type="button" role="option" aria-selected={o.id === parent?.id} onClick={() => { setOpen(false); if (o.id !== parent?.id) onPick(o.id); }}
									className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, o.id === parent?.id && 'bg-selected')}>
									<span className="truncate">{o.name}</span>{o.id === parent?.id && <Check className="ml-auto h-4 w-4 text-primary-600" aria-hidden="true" />}
								</button>
							</li>
						))}
						{!opts.length && <li className="px-2 py-2 text-xs text-slate-500">Nothing found.</li>}
					</ul>
				</div>
			</Popover>
		</div>
	);
}

function OwnersField({ ctx, owners, ownerId, readOnly, onToggle }: { ctx: BoardContext; owners: string[]; ownerId: string | null; readOnly?: boolean; onToggle: (id: string, on: boolean) => void }) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState('');
	const people = Object.entries(ctx.people).filter(([id, x]) => id !== ownerId && (!q || x.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a[1].name.localeCompare(b[1].name));
	return (
		<div className="flex w-full flex-wrap items-center gap-1.5 px-3">
			{owners.map((id) => (
				<span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-1 text-xs dark:bg-slate-700">
					<Avatar id={id} ctx={ctx} size={18} />{ctx.people[id]?.name ?? 'Former member'}
					{!readOnly && <button type="button" onClick={() => onToggle(id, false)} aria-label={`Remove ${ctx.people[id]?.name ?? 'co-owner'}`} className={clsx('rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600', controlFocus)}><X className="h-3 w-3" aria-hidden="true" /></button>}
				</span>
			))}
			{!readOnly && <Button ref={ref} size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add</Button>}
			{!owners.length && readOnly && <span className="text-slate-400">—</span>}
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width="w-64">
				<div className="p-2">
					<Input aria-label="Search people" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
					<div className="mt-1 max-h-64 overflow-y-auto">
						{people.map(([id, x]) => {
							const on = owners.includes(id);
							return (
								<button key={id} type="button" onClick={() => onToggle(id, !on)} className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, on && 'bg-selected')}>
									<Avatar id={id} ctx={ctx} size={20} />{x.name}{on && <Check className="ml-auto h-4 w-4 text-primary-600" aria-hidden="true" />}
								</button>
							);
						})}
					</div>
				</div>
			</Popover>
		</div>
	);
}

function TagsField({ ctx, tags, readOnly, onToggle }: { ctx: BoardContext; tags: string[]; readOnly?: boolean; onToggle: (id: string, on: boolean) => void }) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const all = Object.entries(ctx.tags ?? {}).sort((a, b) => a[1].label.localeCompare(b[1].label));
	return (
		<div className="flex w-full flex-wrap items-center gap-1.5 px-3">
			{tags.map((id) => (
				<span key={id} className="inline-flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pl-2 pr-1 text-xs dark:bg-slate-700">
					{ctx.tags?.[id]?.label ?? 'Tag'}
					{!readOnly && <button type="button" onClick={() => onToggle(id, false)} aria-label={`Remove tag ${ctx.tags?.[id]?.label ?? ''}`} className={clsx('rounded-md p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600', controlFocus)}><X className="h-3 w-3" aria-hidden="true" /></button>}
				</span>
			))}
			{!readOnly && <Button ref={ref} size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" aria-hidden="true" />Tag</Button>}
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width="w-64">
				<div className="max-h-72 overflow-y-auto p-1.5">
					{all.map(([id, x]) => {
						const on = tags.includes(id);
						return (
							<button key={id} type="button" onClick={() => onToggle(id, !on)} className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, on && 'bg-selected')}>
								<span className="truncate">{x.label}</span><span className="ml-auto text-2xs text-slate-500">{x.category?.replace('_', ' ')}</span>{on && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />}
							</button>
						);
					})}
				</div>
			</Popover>
		</div>
	);
}

function MarkdownField({ label, value, readOnly, onSave }: { label: string; value: string | null; readOnly?: boolean; onSave: (v: string | null) => void | Promise<void> }) {
	const [draft, setDraft] = useState(value ?? '');
	useEffect(() => { setDraft(value ?? ''); }, [value]);
	const dirty = draft !== (value ?? '');
	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
				{dirty && !readOnly && <span className="text-2xs text-slate-500">Saves when you leave the box</span>}
			</div>
			<Textarea aria-label={label} value={draft} disabled={readOnly} rows={label === 'Description' ? 4 : 3}
				onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (dirty) void onSave(draft.trim() ? draft : null); }} placeholder={`Add ${label.toLowerCase()}`} />
		</div>
	);
}
