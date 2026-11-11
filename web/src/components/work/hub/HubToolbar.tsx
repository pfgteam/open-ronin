'use client';

// The hub toolbar (rework 5.2): search, quarter (stepper + picker with All
// quarters, D3), Filter (multi-select facets), Sort, Group by, Columns, the
// view switch and saved views. Every control edits the URL state; the
// screen decides what reloads (filters) and what stays client-side.

import { useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
	ArrowDownUp, Bookmark, CalendarDays, Check, ChevronLeft, ChevronRight, Columns3, Eye, EyeOff, Filter, GanttChart, KanbanSquare, Layers, Share2, Table2, Trash2, X, Archive,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Popover from '@/components/ui/Popover';
import SearchInput from '@/components/ui/SearchInput';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Toggle from '@/components/ui/Toggle';
import FilterChip from '@/components/ui/FilterChip';
import { controlFocus } from '@/components/ui/focus';
import { KIND_LABELS } from '@/lib/work/boards/groups';
import type { ColumnDef } from '@/lib/work/boards/columns';
import type { BoardContext } from '@/lib/work/boards/types';
import { DUE_LABELS, SORT_KEYS, dueLabel, filterCount, type HubState, type ListKey } from '@/lib/work/hub/state';
import type { HubView } from '@/lib/work/hub/tabs';
import { statusTone, TONE_DOT } from '@/lib/work/hub/rows';
import type { SavedView } from '@/app/(app)/the-work/hub/actions';

export interface QuarterOpt { id: string; name: string }

const VIEW_OPTS: { key: HubView; label: string; icon: typeof Table2 }[] = [
	{ key: 'table', label: 'Table', icon: Table2 },
	{ key: 'board', label: 'Board', icon: KanbanSquare },
	{ key: 'timeline', label: 'Timeline', icon: GanttChart },
	{ key: 'calendar', label: 'Calendar', icon: CalendarDays },
];

// ------------------------------------------------------------- quarter

export function QuarterPicker({ quarters, value, currentId, defaultMode, onChange }: {
	quarters: QuarterOpt[]; value: string | null; currentId: string | null; defaultMode: 'current' | 'all'; onChange: (q: string | null) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const effective = value ?? defaultMode;
	const resolvedId = effective === 'current' ? currentId : effective === 'all' ? null : quarters.find((q) => q.name === effective || q.id === effective)?.id ?? null;
	const idx = resolvedId ? quarters.findIndex((q) => q.id === resolvedId) : -1;
	const label = effective === 'all' ? 'All quarters' : resolvedId ? `${quarters[idx]?.name ?? ''}${resolvedId === currentId ? ' (now)' : ''}` : 'Current quarter';
	const pick = (q: string) => { setOpen(false); onChange(q === defaultMode ? null : q); };
	const step = (d: number) => {
		const base = idx >= 0 ? idx : Math.max(0, quarters.findIndex((q) => q.id === currentId));
		const next = quarters[base + d];
		if (next) onChange(next.id === currentId && defaultMode === 'current' ? null : next.id === currentId ? 'current' : next.name);
	};
	return (
		<div className="inline-flex items-center" role="group" aria-label="Quarter">
			<IconButton aria-label="Previous quarter" size="sm" className="rounded-r-none" onClick={() => step(-1)} disabled={effective === 'all' || idx === 0}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></IconButton>
			<button ref={ref} type="button" onClick={() => setOpen(true)} aria-haspopup="menu"
				className={clsx('-ml-px h-7 border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-hover dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100', controlFocus)}>
				{label}
			</button>
			<IconButton aria-label="Next quarter" size="sm" className="-ml-px rounded-l-none" onClick={() => step(1)} disabled={effective === 'all' || idx === quarters.length - 1}><ChevronRight className="h-4 w-4" aria-hidden="true" /></IconButton>
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width="w-48">
				<div className="max-h-80 overflow-y-auto p-1.5" role="menu" aria-label="Pick a quarter">
					<MenuItem on={effective === 'all'} onClick={() => pick('all')}>All quarters</MenuItem>
					<MenuItem on={effective === 'current'} onClick={() => pick('current')}>Current quarter</MenuItem>
					<div className="my-1 border-t border-slate-200 dark:border-slate-700" />
					{[...quarters].reverse().map((q) => (
						<MenuItem key={q.id} on={resolvedId === q.id && effective !== 'current'} onClick={() => pick(q.name)}>
							{q.name}{q.id === currentId ? ' (now)' : ''}
						</MenuItem>
					))}
				</div>
			</Popover>
		</div>
	);
}

function MenuItem({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button type="button" role="menuitemradio" aria-checked={!!on} onClick={onClick}
			className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, on && 'bg-selected font-medium')}>
			<span className="w-4 shrink-0">{on && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />}</span>
			<span className="truncate">{children}</span>
		</button>
	);
}

// --------------------------------------------------------------- filter

export interface FacetOptions {
	statuses: { slug: string; label: string; category?: string; is_terminal?: boolean; is_initial?: boolean }[];
	clients: { id: string; name: string }[];
}

type Facet = ListKey | 'due';
const FACETS: { key: Facet; label: string }[] = [
	{ key: 'owner', label: 'Owner' },
	{ key: 'lead', label: 'Lead' },
	{ key: 'status', label: 'Status' },
	{ key: 'dept', label: 'Department' },
	{ key: 'subdept', label: 'Sub-department' },
	{ key: 'tag', label: 'Tag' },
	{ key: 'client', label: 'Client' },
	{ key: 'discipline', label: 'Discipline' },
	{ key: 'due', label: 'Due date' },
];

export function facetOptions(facet: ListKey, ctx: BoardContext, extra: FacetOptions): { id: string; label: string; dot?: string }[] {
	const people = Object.entries(ctx.people).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, x]) => ({ id, label: x.name }));
	switch (facet) {
		case 'owner': return [{ id: 'none', label: 'Unassigned' }, ...people];
		case 'lead': return [{ id: 'none', label: 'No lead' }, ...people];
		case 'status': return extra.statuses.map((s) => ({ id: s.slug, label: s.label, dot: TONE_DOT[statusTone(s as Parameters<typeof statusTone>[0])] }));
		case 'dept': return Object.entries(ctx.departments).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([id, d]) => ({ id, label: d.label }));
		case 'subdept': return Object.entries(ctx.subdepts ?? {}).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([id, d]) => ({ id, label: `${d.label}${d.parent && ctx.departments[d.parent] ? ` (${ctx.departments[d.parent].label})` : ''}` }));
		case 'tag': return Object.entries(ctx.tags ?? {}).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([id, x]) => ({ id, label: `${x.label}${x.category ? ` · ${x.category.replace('_', ' ')}` : ''}` }));
		case 'client': return [{ id: 'none', label: 'No client' }, ...extra.clients.map((c) => ({ id: c.id, label: c.name }))];
		case 'discipline': return [{ id: 'none', label: 'No discipline' }, ...Object.entries(ctx.disciplines ?? {}).sort((a, b) => a[1].position - b[1].position).map(([id, d]) => ({ id, label: d.label }))];
	}
}

export function FilterMenu({ state, ctx, extra, onChange }: { state: HubState; ctx: BoardContext; extra: FacetOptions; onChange: (s: HubState) => void }) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [facet, setFacet] = useState<Facet>('owner');
	const [q, setQ] = useState('');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');
	const n = filterCount(state) - (state.search.trim() ? 1 : 0);
	const options = facet === 'due' ? [] : facetOptions(facet, ctx, extra).filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
	const toggle = (key: ListKey, id: string) => {
		const cur = state[key];
		onChange({ ...state, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
	};
	return (
		<>
			<Button ref={ref} variant={n ? 'secondary' : 'outline'} size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
				<Filter className="h-3.5 w-3.5" aria-hidden="true" />Filter{n ? <span className="rounded-full bg-primary-700 px-1.5 text-2xs text-white">{n}</span> : null}
			</Button>
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width="w-[30rem]">
				<div className="flex max-h-[26rem]">
					<ul className="w-40 shrink-0 space-y-0.5 overflow-y-auto border-r border-slate-200 p-1.5 dark:border-slate-700" role="tablist" aria-label="Filter by">
						{FACETS.map((f) => {
							const count = f.key === 'due' ? (state.due ? 1 : 0) : state[f.key].length;
							return (
								<li key={f.key}>
									<button type="button" role="tab" aria-selected={facet === f.key} onClick={() => { setFacet(f.key); setQ(''); }}
										className={clsx('flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, facet === f.key && 'bg-selected font-medium')}>
										<span className="flex-1 truncate">{f.label}</span>
										{count > 0 && <span className="rounded-full bg-primary-100 px-1.5 text-2xs text-primary-900 dark:bg-primary-950 dark:text-primary-300">{count}</span>}
									</button>
								</li>
							);
						})}
					</ul>
					<div className="flex min-w-0 flex-1 flex-col">
						{facet === 'due' ? (
							<div className="space-y-1 p-2">
								{Object.entries(DUE_LABELS).map(([k, label]) => (
									<MenuItem key={k} on={state.due === k} onClick={() => onChange({ ...state, due: state.due === k ? null : k })}>{label}</MenuItem>
								))}
								<div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
									<Input type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
									<Input type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
									<Button size="sm" variant="outline" className="col-span-2" disabled={!from && !to} onClick={() => onChange({ ...state, due: `${from}..${to}` })}>Apply range</Button>
								</div>
							</div>
						) : (
							<>
								<div className="border-b border-slate-200 p-2 dark:border-slate-700">
									<SearchInput aria-label={`Search ${facet}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
								</div>
								<ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
									{options.map((o) => {
										const on = state[facet as ListKey].includes(o.id);
										return (
											<li key={o.id}>
												<label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
													<Checkbox checked={on} onChange={() => toggle(facet as ListKey, o.id)} />
													{o.dot && <span className={clsx('h-2 w-2 shrink-0 rounded-full', o.dot)} aria-hidden="true" />}
													<span className="truncate">{o.label}</span>
												</label>
											</li>
										);
									})}
									{!options.length && <li className="px-2 py-3 text-xs text-slate-500">Nothing to pick.</li>}
								</ul>
							</>
						)}
					</div>
				</div>
			</Popover>
		</>
	);
}

/** One chip per active filter, each removable; shown under the toolbar. */
export function FilterChips({ state, ctx, extra, onChange }: { state: HubState; ctx: BoardContext; extra: FacetOptions; onChange: (s: HubState) => void }) {
	const chips: { key: string; label: string; clear: () => void }[] = [];
	for (const f of FACETS) {
		if (f.key === 'due') {
			if (state.due) chips.push({ key: 'due', label: dueLabel(state.due), clear: () => onChange({ ...state, due: null }) });
			continue;
		}
		const vals = state[f.key];
		if (!vals.length) continue;
		const opts = facetOptions(f.key, ctx, extra);
		const names = vals.map((v) => opts.find((o) => o.id === v)?.label ?? ctx.tags?.[v]?.label ?? v);
		chips.push({ key: f.key, label: `${f.label}: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`, clear: () => onChange({ ...state, [f.key]: [] }) });
	}
	if (!chips.length) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
			{chips.map((c) => (
				<span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-primary-300 bg-primary-50 py-0.5 pl-2.5 pr-1 text-xs text-primary-900 dark:border-primary-700 dark:bg-primary-950 dark:text-primary-300">
					{c.label}
					<button type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`} className={clsx('rounded-full p-0.5 hover:bg-primary-100 dark:hover:bg-primary-900', controlFocus)}><X className="h-3 w-3" aria-hidden="true" /></button>
				</span>
			))}
			<Button size="sm" variant="ghost" onClick={() => onChange({ ...state, owner: [], lead: [], status: [], dept: [], subdept: [], tag: [], client: [], discipline: [], due: null })}>Clear filters</Button>
		</div>
	);
}

// ----------------------------------------------------- sort, group, columns

function MenuButton({ icon: Icon, label, value, children, width = 'w-56' }: { icon: typeof Table2; label: string; value?: string; children: (close: () => void) => React.ReactNode; width?: string }) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<>
			<button ref={ref} type="button" onClick={() => setOpen(true)} aria-haspopup="menu" aria-expanded={open}
				className={clsx('inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-hover dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200', controlFocus)}>
				<Icon className="h-3.5 w-3.5" aria-hidden="true" /><span>{label}{value && <span className="font-normal text-slate-500 dark:text-slate-400">: {value}</span>}</span>
			</button>
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={width}>
				<div className="max-h-96 overflow-y-auto p-1.5">{children(() => setOpen(false))}</div>
			</Popover>
		</>
	);
}

export function SortMenu({ state, onChange }: { state: HubState; onChange: (s: HubState) => void }) {
	const cur = state.sort ?? { key: 'manual', dir: 'asc' as const };
	const label = SORT_KEYS.find((k) => k.key === cur.key)?.label ?? 'Manual order';
	return (
		<MenuButton icon={ArrowDownUp} label="Sort" value={cur.key === 'manual' ? undefined : `${label} ${cur.dir === 'desc' ? '↓' : '↑'}`}>
			{(close) => (
				<div role="menu" aria-label="Sort by">
					{SORT_KEYS.map((k) => (
						<MenuItem key={k.key} on={cur.key === k.key} onClick={() => { close(); onChange({ ...state, sort: k.key === 'manual' ? null : { key: k.key, dir: cur.key === k.key ? cur.dir : 'asc' } }); }}>{k.label}</MenuItem>
					))}
					{cur.key !== 'manual' && (
						<>
							<div className="my-1 border-t border-slate-200 dark:border-slate-700" />
							<MenuItem on={cur.dir === 'asc'} onClick={() => { close(); onChange({ ...state, sort: { key: cur.key, dir: 'asc' } }); }}>Ascending</MenuItem>
							<MenuItem on={cur.dir === 'desc'} onClick={() => { close(); onChange({ ...state, sort: { key: cur.key, dir: 'desc' } }); }}>Descending</MenuItem>
						</>
					)}
				</div>
			)}
		</MenuButton>
	);
}

export function GroupMenu({ options, value, defaultValue, onChange }: { options: { key: string; label: string }[]; value: string; defaultValue: string; onChange: (g: string | null) => void }) {
	return (
		<MenuButton icon={Layers} label="Group" value={options.find((o) => o.key === value)?.label}>
			{(close) => (
				<div role="menu" aria-label="Group by">
					{options.map((o) => <MenuItem key={o.key} on={o.key === value} onClick={() => { close(); onChange(o.key === defaultValue ? null : o.key); }}>{o.label}</MenuItem>)}
				</div>
			)}
		</MenuButton>
	);
}

export function ColumnsMenu({ all, visible, onChange }: { all: ColumnDef[]; visible: string[]; onChange: (keys: string[]) => void }) {
	return (
		<MenuButton icon={Columns3} label="Columns" width="w-60">
			{() => (
				<ul aria-label="Columns">
					{all.map((c) => {
						const on = visible.includes(c.key);
						return (
							<li key={c.key}>
								<label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
									<Checkbox checked={on} onChange={() => onChange(on ? visible.filter((k) => k !== c.key) : [...visible, c.key])} />
									<span className="truncate">{c.label}</span>
								</label>
							</li>
						);
					})}
				</ul>
			)}
		</MenuButton>
	);
}

export function ViewSwitch({ value, onChange }: { value: HubView; onChange: (v: HubView) => void }) {
	return (
		<div role="radiogroup" aria-label="View" className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
			{VIEW_OPTS.map((v) => {
				const Icon = v.icon;
				const on = v.key === value;
				return (
					<button key={v.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(v.key)} title={v.label}
						className={clsx('inline-flex h-7 items-center gap-1 border-r border-slate-300 px-2 text-xs last:border-r-0 dark:border-slate-600', controlFocus,
							on ? 'bg-selected font-semibold text-primary-900 dark:text-primary-300' : 'bg-white text-slate-600 hover:bg-hover dark:bg-slate-800 dark:text-slate-300')}>
						<Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden lg:inline">{v.label}</span>
					</button>
				);
			})}
		</div>
	);
}

export function DoneArchivedChips({ state, onChange }: { state: HubState; onChange: (s: HubState) => void }) {
	const showDone = state.closed === true;
	return (
		<>
			{!state.archived && (
				<FilterChip active={showDone} onClick={() => onChange({ ...state, closed: showDone ? null : true })}>
					<span className="inline-flex items-center gap-1">{showDone ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}Show done</span>
				</FilterChip>
			)}
			<FilterChip active={state.archived} onClick={() => onChange({ ...state, archived: !state.archived })}>
				<span className="inline-flex items-center gap-1"><Archive className="h-3.5 w-3.5" aria-hidden="true" />Archived</span>
			</FilterChip>
		</>
	);
}

// ---------------------------------------------------------------- views

export function ViewsMenu({ views, people, current, onApply, onSave, onDelete }: {
	views: SavedView[] | null;
	people: BoardContext['people'];
	current: string;
	onApply: (v: SavedView) => void;
	onSave: (name: string, shared: boolean, id?: string) => Promise<void>;
	onDelete: (v: SavedView) => Promise<void>;
}) {
	const [name, setName] = useState('');
	const [shared, setShared] = useState(false);
	const active = useMemo(() => views?.find((v) => v.query === current), [views, current]);
	return (
		<MenuButton icon={Bookmark} label="Views" value={active?.name} width="w-72">
			{(close) => (
				<div className="space-y-2">
					<ul aria-label="Saved views" className="space-y-0.5">
						{views === null && <li className="px-2 py-1.5 text-xs text-slate-500">Loading views…</li>}
						{views?.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-500">No saved views on this board yet.</li>}
						{views?.map((v) => (
							<li key={v.id} className="flex items-center gap-1">
								<button type="button" onClick={() => { close(); onApply(v); }}
									className={clsx('flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus, active?.id === v.id && 'bg-selected font-medium')}>
									<span className="truncate">{v.name}</span>
									{v.shared && <Share2 className="h-3 w-3 shrink-0 text-slate-400" aria-label="Shared" />}
									{!v.mine && <span className="ml-auto shrink-0 truncate text-2xs text-slate-500">{people[v.ownerId]?.name ?? 'Shared'}</span>}
								</button>
								{v.mine && <IconButton aria-label={`Delete view ${v.name}`} size="sm" bordered={false} onClick={() => void onDelete(v)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>}
							</li>
						))}
					</ul>
					<form className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await onSave(name, shared); setName(''); close(); }}>
						<Input aria-label="View name" placeholder="Save this view as…" value={name} onChange={(e) => setName(e.target.value)} />
						<div className="flex items-center justify-between gap-2">
							<Toggle label="Shared with the team" checked={shared} onChange={setShared} />
							<Button size="sm" type="submit" disabled={!name.trim()}>Save</Button>
						</div>
						{active?.mine && (
							<Button size="sm" variant="outline" full onClick={async () => { await onSave(active.name, active.shared, active.id); close(); }}>Update “{active.name}”</Button>
						)}
					</form>
				</div>
			)}
		</MenuButton>
	);
}

export function kindNoun(kinds: string[]): string {
	return (KIND_LABELS[kinds[0]] ?? kinds[0] ?? 'item').toLowerCase();
}
