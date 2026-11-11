'use client';

// Self → My work (/?tab=work): ONE queue of the viewer's open work on the
// same engine as The Work boards — the board table (inline status / owner /
// due cells), the item panel, the bulk bar and the "+ New" modal. Groups are
// section (Tasks = what you execute, Projects = what you steer) → date bucket
// (Overdue → Today → This week → No date → Later). Tabs: Mine · Created ·
// Delegated · Following · Sales (viewers with a lane, 2026-10-15 — the rep
// queue that was Prospects → My Day). Nothing else lives here; the cockpit
// is Self → Overview.
//
// Timezone rule: projects.ends_at is a bare `date`; it is bucketed in the
// viewer's LOCAL day (parseDueLocal), never new Date('YYYY-MM-DD').

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, UserPlus, X } from 'lucide-react';
import { clsx } from 'clsx';
import { controlFocus } from '@/components/ui/focus';
import Button from '@/components/ui/Button';
import AddProspectButton from './prospects/AddProspectButton';
import Card from '@/components/ui/Card';
import FilterChip from '@/components/ui/FilterChip';
import PageHeader from '@/components/ui/PageHeader';
import SearchInput from '@/components/ui/SearchInput';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import BoardTable from '@/components/board/BoardTable';
import { BulkBar } from '@/components/board/BulkBar';
import NewItemModal from '@/components/board/NewItemModal';
import WorkItemPanel from '@/components/work/WorkItemPanel';
import type { CellEdit } from '@/components/board/cells';
import { resolveColumns } from '@/lib/work/boards/columns';
import { GROUP_COLORS, NEUTRAL_COLOR, localToday, statusDef, statusesFor, type RowGroup } from '@/lib/work/boards/groups';
import { formatShortDate } from '@/components/board/format';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import {
	archiveItems, bulkUpdateItems, loadChildRows, unarchiveItems, updateItemField, type EditableField,
} from '@/app/(app)/the-work/b/actions';
import { completeLegacyTask, reopenLegacyTask } from '@/app/(app)/the-work/homeActions';
import { DUE_BUCKET_LABELS, DUE_BUCKET_ORDER, dueBucket, parseDueLocal, startOfDay, type DueBucket } from '@/lib/home/dueLabel';
import { QuickActionsPicker, TabButton, type LegacyTaskRow } from './HomeView';
import type { SalesData } from '@/lib/home/salesData';
import SalesQueue from './SalesQueue';
import MultiSelectFilter from './the-work/MultiSelectFilter';

export type MyWorkTab = 'work' | 'created' | 'delegated' | 'following' | 'sales';

export interface MyWorkViewProps {
	viewerId: string;
	ownedWork: WorkRow[];
	createdWork: WorkRow[];
	/** Open items I follow that someone else owns (spec §4.3). */
	followingWork: WorkRow[];
	/** Rows from the pre-revamp `tasks` table still assigned to the viewer. */
	legacyTasks: LegacyTaskRow[];
	legacyProjectNames: Record<string, string>;
	ctx: BoardContext;
	terminalStatuses: string[];
	serverToday: string;
	quickActionKeys: string[] | null;
	canUseRestricted: boolean;
	quickActionsOpen: boolean;
	initialTab?: MyWorkTab;
	/** Self → Sales: the rep queue, null for viewers without a lane. */
	sales?: SalesData | null;
}

type Section = 'tasks' | 'projects';
const LEAF_KINDS = new Set(['task', 'assignment', 'recurring', 'process', 'bug']);
const sectionOf = (w: WorkRow): Section => (LEAF_KINDS.has(w.kind) ? 'tasks' : 'projects');
const SECTIONS: { key: Section; label: string }[] = [
	{ key: 'tasks', label: 'Tasks' },
	{ key: 'projects', label: 'Projects & priorities' },
];
const BUCKET_COLOR: Record<DueBucket, string> = {
	overdue: GROUP_COLORS[4], today: GROUP_COLORS[2], week: GROUP_COLORS[0], next: GROUP_COLORS[3], later: GROUP_COLORS[7], none: NEUTRAL_COLOR,
};
const STORAGE_KEY = 'or-mywork:collapsed';
const HIDDEN_STATUS_KEY = 'or-mywork:hidden-statuses';
const COLUMNS = resolveColumns(
	[{ key: 'status', visible: true }, { key: 'parent', visible: true }, { key: 'due', visible: true }, { key: 'owner', visible: true }],
	[],
);


export default function MyWorkView(p: MyWorkViewProps) {
	const router = useRouter();
	const { toast, undoWindow } = useToast();
	const terminal = useMemo(() => new Set(p.terminalStatuses), [p.terminalStatuses]);

	const [tab, setTabState] = useState<MyWorkTab>(p.initialTab ?? 'work');
	// Tabs live in the URL (?queue=) so Overview links and reloads land on the right one.
	const setTab = useCallback((t: MyWorkTab) => {
		setTabState(t);
		// history.replaceState, not router.replace: the URL follows the tab without a server round trip (BoardScreen ?item= idiom).
		window.history.replaceState(null, '', t === 'work' ? '/?tab=work' : `/?tab=work&queue=${t}`);
	}, []);
	const [lists, setLists] = useState({ work: p.ownedWork, created: p.createdWork, following: p.followingWork });
	const [ctx, setCtx] = useState(p.ctx);
	const [today, setToday] = useState(p.serverToday);
	const [overdueOnly, setOverdueOnly] = useState(false);
	const [query, setQuery] = useState('');
	const [typeFilter, setTypeFilter] = useState<Section | null>(null);
	// Exclusion filter: every status shows until you uncheck it. Remembered per browser.
	const [hiddenStatuses, setHiddenStatusesState] = useState<Set<string>>(new Set());
	const setHiddenStatuses = useCallback((next: Set<string>) => {
		setHiddenStatusesState(next);
		try { localStorage.setItem(HIDDEN_STATUS_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
	}, []);
	const [clientFilter, setClientFilter] = useState('');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['tasks:later', 'projects:later']));
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [children, setChildren] = useState<Record<string, WorkRow[] | 'loading'>>({});
	const [panelId, setPanelId] = useState<string | null>(null);
	const [newOpen, setNewOpen] = useState(false);
	const [hiddenLegacy, setHiddenLegacy] = useState<Set<string>>(new Set());

	useEffect(() => { setLists({ work: p.ownedWork, created: p.createdWork, following: p.followingWork }); setCtx(p.ctx); }, [p.ownedWork, p.createdWork, p.followingWork, p.ctx]);
	useEffect(() => { setToday(localToday()); }, []);
	useEffect(() => {
		try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setCollapsed(new Set(JSON.parse(raw) as string[])); } catch { /* private mode */ }
		try { const raw = localStorage.getItem(HIDDEN_STATUS_KEY); if (raw) setHiddenStatusesState(new Set(JSON.parse(raw) as string[])); } catch { /* private mode */ }
	}, []);
	useEffect(() => { setSelected(new Set()); }, [tab, overdueOnly, query, typeFilter, hiddenStatuses, clientFilter]);

	const todayDate = useMemo(() => startOfDay(parseDueLocal(today)), [today]);

	const open = useMemo(() => {
		const notDone = (w: WorkRow) => !terminal.has(w.status);
		if (tab === 'created') return lists.created.filter(notDone);
		if (tab === 'delegated') return lists.created.filter((w) => notDone(w) && !!w.owner_id && w.owner_id !== p.viewerId);
		if (tab === 'following') return lists.following.filter(notDone);
		return lists.work.filter(notDone);
	}, [tab, lists, terminal, p.viewerId]);

	// Filter options come from the open rows of the current tab, so every choice matches something.
	const statusOptions = useMemo(() => {
		const m = new Map<string, string>();
		for (const w of open) if (!m.has(w.status)) m.set(w.status, statusDef(ctx, w).label);
		return [...m].sort((a, b) => a[1].localeCompare(b[1]));
	}, [open, ctx]);
	const clientOptions = useMemo(() => {
		const m = new Map<string, string>();
		for (const w of open) if (w.client_id && !m.has(w.client_id)) m.set(w.client_id, ctx.clients[w.client_id]?.name ?? 'Unknown client');
		return [...m].sort((a, b) => a[1].localeCompare(b[1]));
	}, [open, ctx]);

	// Only exclusions that hit a status in this tab count as an active filter.
	const hiddenHere = useMemo(() => statusOptions.filter(([slug]) => hiddenStatuses.has(slug)).length, [statusOptions, hiddenStatuses]);
	const filtersOn = !!query.trim() || !!typeFilter || hiddenHere > 0 || !!clientFilter;
	const clearFilters = useCallback(() => { setQuery(''); setTypeFilter(null); setHiddenStatuses(new Set()); setClientFilter(''); }, [setHiddenStatuses]);
	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		return open.filter((w) => {
			if (typeFilter && sectionOf(w) !== typeFilter) return false;
			if (hiddenStatuses.has(w.status)) return false;
			if (clientFilter && w.client_id !== clientFilter) return false;
			if (q && !w.name.toLowerCase().includes(q) && !(w.parent_id && ctx.parents[w.parent_id]?.name.toLowerCase().includes(q))) return false;
			return true;
		});
	}, [open, query, typeFilter, hiddenStatuses, clientFilter, ctx]);

	const counts = useMemo(() => {
		const notDone = (w: WorkRow) => !terminal.has(w.status);
		return {
			work: lists.work.filter(notDone).length,
			created: lists.created.filter(notDone).length,
			delegated: lists.created.filter((w) => notDone(w) && !!w.owner_id && w.owner_id !== p.viewerId).length,
			following: lists.following.filter(notDone).length,
		};
	}, [lists, terminal, p.viewerId]);

	const overdueCount = useMemo(() => visible.filter((w) => dueBucket(w.ends_at, todayDate) === 'overdue').length, [visible, todayDate]);

	// Section → bucket groups, in the order the eye reads them. Empty groups are dropped.
	const groups: RowGroup[] = useMemo(() => {
		const out: RowGroup[] = [];
		for (const s of SECTIONS) {
			for (const b of DUE_BUCKET_ORDER) {
				if (overdueOnly && b !== 'overdue') continue;
				const rows = visible
					.filter((w) => sectionOf(w) === s.key && dueBucket(w.ends_at, todayDate) === b)
					.sort((a, c) => (a.ends_at ?? '9999').localeCompare(c.ends_at ?? '9999') || a.name.localeCompare(c.name));
				if (rows.length) out.push({ key: `${s.key}:${b}`, label: `${s.label} · ${DUE_BUCKET_LABELS[b]}`, color: BUCKET_COLOR[b], rows });
			}
		}
		return out;
	}, [visible, overdueOnly, todayDate]);

	// ------------------------------------------------------------- edits

	const patchRow = useCallback((id: string, patch: Partial<WorkRow>) => {
		const apply = (rs: WorkRow[]) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r));
		setLists((l) => ({ work: apply(l.work), created: apply(l.created), following: apply(l.following) }));
	}, []);
	// Which lists a removed row sat in, so Undo puts it back exactly there (a
	// followed or co-owned row would otherwise not match the "owner = me" rule).
	const origins = useRef(new Map<string, { work: boolean; created: boolean; following: boolean }>());
	// Mine = primary owner. Handing an item to someone else takes it out of Mine
	// at once (it stays in Created/Delegated if you made it).
	const leaveMineIfReassigned = useCallback((ids: string[], ownerId: string | null | undefined) => {
		if (ownerId === undefined || ownerId === p.viewerId) return;
		const gone = new Set(ids);
		setLists((l) => ({ ...l, work: l.work.filter((r) => !gone.has(r.id)) }));
	}, [p.viewerId]);
	const removeRow = useCallback((id: string) => {
		setLists((l) => {
			origins.current.set(id, { work: l.work.some((r) => r.id === id), created: l.created.some((r) => r.id === id), following: l.following.some((r) => r.id === id) });
			const drop = (rs: WorkRow[]) => rs.filter((r) => r.id !== id);
			return { work: drop(l.work), created: drop(l.created), following: drop(l.following) };
		});
	}, []);
	const addRow = useCallback((row: WorkRow) => {
		const o = origins.current.get(row.id) ?? { work: row.owner_id === p.viewerId, created: row.created_by === p.viewerId, following: false };
		origins.current.delete(row.id);
		const put = (rs: WorkRow[], yes: boolean) => (yes && !rs.some((r) => r.id === row.id) ? [...rs, row] : rs);
		setLists((l) => ({ work: put(l.work, o.work), created: put(l.created, o.created), following: put(l.following, o.following) }));
	}, [p.viewerId]);

	const applyEdit = useCallback(async (row: WorkRow, e: CellEdit) => {
		if (e.kind !== 'field') return;
		const field = e.field as EditableField;
		const prev = row[field as keyof WorkRow] as string | null;
		patchRow(row.id, { [field]: e.value } as Partial<WorkRow>);
		const res = await updateItemField(row.id, field, e.value);
		if (!res.ok) { patchRow(row.id, { [field]: prev } as Partial<WorkRow>); toast({ message: res.error, variant: 'error' }); return; }
		patchRow(row.id, res.data);
		if (field === 'owner_id') leaveMineIfReassigned([row.id], res.data.owner_id);
		if (field === 'status') {
			const label = statusesFor(ctx, row.kind).find((s) => s.slug === e.value)?.label ?? e.value;
			toast({ message: `${row.name} → ${label}`, undo: async () => { patchRow(row.id, { status: prev ?? row.status }); await updateItemField(row.id, 'status', prev); } });
		}
	}, [ctx, patchRow, leaveMineIfReassigned, toast]);

	const editChild = useCallback(async (parent: WorkRow, child: WorkRow, e: CellEdit) => {
		if (e.kind !== 'field' || e.field !== 'status') return;
		const set = (status: string) => setChildren((c) => ({ ...c, [parent.id]: Array.isArray(c[parent.id]) ? (c[parent.id] as WorkRow[]).map((r) => (r.id === child.id ? { ...r, status } : r)) : c[parent.id] }));
		set(e.value as string);
		const res = await updateItemField(child.id, 'status', e.value);
		if (!res.ok) { set(child.status); toast({ message: res.error, variant: 'error' }); }
	}, [toast]);

	const toggleExpand = useCallback(async (row: WorkRow) => {
		setExpanded((s) => { const n = new Set(s); if (n.has(row.id)) n.delete(row.id); else n.add(row.id); return n; });
		if (children[row.id]) return;
		setChildren((c) => ({ ...c, [row.id]: 'loading' }));
		const res = await loadChildRows(row.id);
		setChildren((c) => ({ ...c, [row.id]: res.ok ? res.data : [] }));
		if (!res.ok) toast({ message: res.error, variant: 'error' });
	}, [children, toast]);

	const toggleCollapse = useCallback((key: string) => {
		setCollapsed((s) => {
			const n = new Set(s);
			if (n.has(key)) n.delete(key); else n.add(key);
			try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
			return n;
		});
	}, []);

	const toggleSelect = useCallback((ids: string[], on: boolean) => {
		setSelected((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
	}, []);

	const bulk = useCallback(async (field: EditableField, value: string | null, label: string) => {
		const ids = [...selected];
		const res = await bulkUpdateItems(ids, field, value);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
		for (const id of ids) patchRow(id, { [field]: value } as Partial<WorkRow>);
		if (field === 'owner_id') leaveMineIfReassigned(ids, value);
		setSelected(new Set());
		toast({ message: `${res.data.updated} ${res.data.updated === 1 ? 'item' : 'items'} → ${label}`, variant: 'success' });
	}, [selected, toast, patchRow, leaveMineIfReassigned]);

	const archiveSelected = useCallback(async () => {
		const ids = [...selected];
		const removed = open.filter((r) => selected.has(r.id));
		for (const id of ids) removeRow(id);
		setSelected(new Set());
		const res = await archiveItems(ids);
		if (!res.ok) { for (const r of removed) addRow(r); toast({ message: res.error, variant: 'error' }); return; }
		undoWindow({
			message: `Archiving ${res.data.archived} ${res.data.archived === 1 ? 'item' : 'items'}`,
			committedMessage: `${res.data.archived} archived. Find them on their board under the "Archived" filter.`,
			undoneMessage: 'Restored',
			undo: async () => {
				const back = await unarchiveItems(ids);
				if (back.ok) for (const r of removed) addRow(r);
				else toast({ message: back.error, variant: 'error' });
			},
		});
	}, [selected, open, removeRow, addRow, toast, undoWindow]);

	const doneLegacy = useCallback(async (t: LegacyTaskRow) => {
		setHiddenLegacy((s) => new Set(s).add(t.id));
		const res = await completeLegacyTask(t.id);
		if (!res.ok) { setHiddenLegacy((s) => { const n = new Set(s); n.delete(t.id); return n; }); toast({ message: res.error, variant: 'error' }); return; }
		undoWindow({
			message: `Done: ${t.title}`,
			committedMessage: `${t.title} done`,
			undoneMessage: 'Reopened',
			undo: async () => { await reopenLegacyTask(t.id); setHiddenLegacy((s) => { const n = new Set(s); n.delete(t.id); return n; }); },
		});
	}, [toast, undoWindow]);

	const legacyOpen = p.legacyTasks.filter((t) => !t.completed_at && t.status !== 'done' && !hiddenLegacy.has(t.id));
	const openPanel = useCallback((row: WorkRow) => setPanelId(row.id), []);
	const closePanel = useCallback(() => setPanelId(null), []);
	const openItem = useCallback((id: string) => setPanelId(id), []);
	const selectedKinds = useMemo(() => [...new Set(open.filter((r) => selected.has(r.id)).map((r) => r.kind))], [open, selected]);

	return (
		<div className="space-y-4 pb-24">
			<PageHeader
				flush
				title="My work"
				description={tab === 'sales' && p.sales
					? `${p.sales.rows.length} deals in your queue · ${p.sales.laneLabel} lane · speed-to-lead goal ${p.sales.goalMinutes} min`
					: `${counts.work} open item${counts.work === 1 ? '' : 's'} · by due date`}
				actions={tab === 'sales' ? (
					<AddProspectButton className={clsx('inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-hover', controlFocus)}>
						<UserPlus className="w-4 h-4" aria-hidden="true" /> Add prospect
					</AddProspectButton>
				) : (
					<Button onClick={() => setNewOpen(true)} className="gap-1.5">
						<Plus className="w-4 h-4" aria-hidden="true" /> New task
					</Button>
				)}
			/>

			<div role="tablist" aria-label="Queues" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{([
					['work', 'Mine', counts.work], ['created', 'Created', counts.created], ['delegated', 'Delegated', counts.delegated], ['following', 'Following', counts.following],
					...(p.sales ? [['sales', 'Sales', p.sales.rows.length] as [MyWorkTab, string, number]] : []),
				] as [MyWorkTab, string, number][]).map(([key, label, n]) => (
					<TabButton key={key} active={tab === key} onClick={() => setTab(key)}>
						{label} <span className="text-2xs rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 tabular-nums">{n}</span>
					</TabButton>
				))}
				{tab !== 'sales' && <span className="ml-auto flex items-center gap-2 pb-1">
					{(overdueCount > 0 || overdueOnly) && (
						<FilterChip tone="danger" active={overdueOnly} aria-pressed={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
							<b>{overdueCount}</b> overdue
						</FilterChip>
					)}
					<span className="hidden text-2xs text-slate-500 sm:inline">
						{tab === 'delegated' ? 'you created it, someone else owns it' : tab === 'created' ? 'any owner' : tab === 'following' ? 'someone else owns it, you get its updates' : 'assigned to you'}
					</span>
				</span>}
			</div>

			{tab === 'sales' && p.sales ? (
				<SalesQueue sales={p.sales} />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<SearchInput aria-label="Search items" placeholder="Search by name or parent" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full sm:w-64" />
						<div className="flex items-center gap-1" role="group" aria-label="Type">
							<FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>All</FilterChip>
							{SECTIONS.map((s) => (
								<FilterChip key={s.key} active={typeFilter === s.key} onClick={() => setTypeFilter((t) => (t === s.key ? null : s.key))}>
									{s.key === 'tasks' ? 'Tasks' : 'Projects'}
								</FilterChip>
							))}
						</div>
						<MultiSelectFilter
							label="Status"
							options={statusOptions.map(([value, label]) => ({ value, label }))}
							selected={statusOptions.filter(([slug]) => !hiddenStatuses.has(slug)).map(([slug]) => slug)}
							onChange={(shown) => {
								// Keep exclusions for statuses not present in this tab; rewrite the ones that are.
								const next = new Set([...hiddenStatuses].filter((slug) => !statusOptions.some(([o]) => o === slug)));
								for (const [slug] of statusOptions) if (!shown.includes(slug)) next.add(slug);
								setHiddenStatuses(next);
							}}
							summary={hiddenHere === 0 ? 'All' : hiddenHere === statusOptions.length ? 'None' : `${statusOptions.length - hiddenHere} of ${statusOptions.length}`}
							minWidth="130px"
							emptyText="No open items"
						/>
						{(clientOptions.length > 0 || clientFilter) && (
							<Select size="sm" aria-label="Client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
								<option value="">All clients</option>
								{clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
							</Select>
						)}
						{filtersOn && (
							<Button size="sm" variant="ghost" onClick={clearFilters} className="gap-1">
								<X className="w-3.5 h-3.5" aria-hidden="true" /> Clear
							</Button>
						)}
						{filtersOn && <span className="text-2xs text-slate-500 tabular-nums">{visible.length} of {open.length}</span>}
					</div>

					<BoardTable
						groups={groups} columns={COLUMNS} ctx={ctx} today={today} itemLabel="item"
						selected={selected} onToggleSelect={toggleSelect}
						collapsed={collapsed} onToggleCollapse={toggleCollapse}
						onEdit={applyEdit} onOpen={openPanel}
						expanded={expanded} onToggleExpand={toggleExpand} childRows={children}
						onEditChild={editChild}
						empty={
							<div className="space-y-3">
								<p>
									{filtersOn && open.length > 0 ? 'Nothing matches these filters.'
										: overdueOnly ? 'Nothing overdue here. Nice.'
										: tab === 'created' ? 'Nothing you created is open.'
											: tab === 'delegated' ? 'Nothing you created is with someone else.'
												: tab === 'following' ? 'Nothing you follow is open. Follow an item from its panel (the bell) and it shows up here.'
													: 'Nothing assigned to you is open.'}
								</p>
								{filtersOn && open.length > 0 && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>}
								{tab === 'work' && !overdueOnly && !filtersOn && <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" aria-hidden="true" />New task</Button>}
							</div>
						}
					/>

					{tab === 'work' && legacyOpen.length > 0 && (
						<Card padding="none">
							<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Older tasks</h2>
								<p className="text-2xs text-slate-500">From the previous tracker, outside the date groups above. Tick to complete; they cannot be edited here.</p>
							</div>
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{legacyOpen.map((t) => (
									<li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
										<button type="button" onClick={() => void doneLegacy(t)} aria-label={`Mark ${t.title} done`}
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-300 dark:border-slate-600 text-transparent hover:border-primary-500 hover:text-primary-600">
											<Check className="w-3.5 h-3.5" aria-hidden="true" />
										</button>
										<span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200">{t.title}</span>
										{t.project_id && p.legacyProjectNames[t.project_id] && <span className="truncate text-xs text-slate-500">{p.legacyProjectNames[t.project_id]}</span>}
										{t.due_at && <span className={`shrink-0 text-xs tabular-nums ${t.due_at.slice(0, 10) < today ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500'}`} title={t.due_at.slice(0, 10)}>{formatShortDate(t.due_at.slice(0, 10))}</span>}
									</li>
								))}
							</ul>
						</Card>
					)}
				</>
			)}

			<NewItemModal
				open={newOpen}
				onClose={() => setNewOpen(false)}
				kinds={['task']}
				ctx={ctx}
				viewerId={p.viewerId}
				boardName="My work"
				defaults={{ quarter_id: null, department_tag_id: null, client_id: null }}
				onCreated={(row, openIt) => {
					if (row.parent_id && !ctx.parents[row.parent_id]) router.refresh();
					addRow(row);
					toast({ message: `Created ${row.name}`, variant: 'success' });
					if (openIt) setPanelId(row.id);
				}}
			/>

			{panelId && (
				<WorkItemPanel itemId={panelId} ctx={ctx} today={today} onClose={closePanel}
					onRowChange={(row) => { patchRow(row.id, row); leaveMineIfReassigned([row.id], row.owner_id); }} onRemoved={removeRow} onUndone={addRow}
					onOpenItem={openItem} />
			)}

			{selected.size > 0 && (
				<BulkBar count={selected.size} itemLabel="item" ctx={ctx} kind={selectedKinds[0] ?? 'task'} kinds={selectedKinds} mode="live"
					onStatus={(slug, label) => bulk('status', slug, label)}
					onOwner={(id) => bulk('owner_id', id, ctx.people[id]?.name ?? 'owner')}
					onArchive={archiveSelected} onRestore={() => undefined} onDelete={() => undefined} onClear={() => setSelected(new Set())} />
			)}

			{p.quickActionsOpen && <QuickActionsPicker selected={p.quickActionKeys} canUseRestricted={p.canUseRestricted} />}
		</div>
	);
}
