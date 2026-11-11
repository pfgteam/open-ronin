'use client';

// The Work hub screen (rework 5.1–5.2, D1–D3, D8, D12, D13). One component
// for every hub tab and every custom board:
//
//   - tabs by kind with the TRUE filtered count each (D2)
//   - quarter stepper + picker with All quarters (D3)
//   - toolbar: search, Filter, Sort, Group, Columns, view switch, saved views
//   - the whole filtered set is the working set (D8): the first page arrives
//     server-rendered with the true counts and every id, the rest loads in
//     the background; nothing ends in a Load more button
//   - select all selects the whole set; bulk actions run in batches with one
//     undo
//   - edits patch the row in place; nothing reloads the board (D12)
//
// URL = state. Filters, quarter and grouping round-trip the server (counts
// and facets are computed there); view, sort and columns are client-only
// (history.replaceState) because the full set is already in the browser.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { clsx } from 'clsx';
import { HelpCircle, Plus, Settings2, Star } from 'lucide-react';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import SearchInput from '@/components/ui/SearchInput';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth';
import { groupRows, localToday, statusesFor, NO_GROUP_KEY, KIND_LABELS } from '@/lib/work/boards/groups';
import { allColumns, resolveColumns } from '@/lib/work/boards/columns';
import type { BoardContext, CustomColumn, WorkRow } from '@/lib/work/boards/types';
import { CHILD_KINDS_FOR_PARENT, PARENT_KIND_FOR } from '@/app/(app)/the-work/hierarchy';
import { type HubDef, type HubView } from '@/lib/work/hub/tabs';
import { filterCount, hubQueryString, rowSetKey, serializeHubState, type HubState } from '@/lib/work/hub/state';
import { groupColor, sortRows, type RenderGroup } from '@/lib/work/hub/rows';
import type { HubPayload } from '@/lib/work/hub/server';
import {
	archiveItems, bulkUpdateItems, createItem, deleteItems, loadChildRows, setCustomValue, toggleFavorite, unarchiveItems, updateItemField,
	type CreateItemInput, type EditableField,
} from '@/app/(app)/the-work/b/actions';
import { deleteView, listHubIds, listSavedViews, loadHubRows, saveView, type SavedView } from '@/app/(app)/the-work/hub/actions';
import type { CellEdit } from '@/components/board/cells';
import { BoardCalendar, BoardTimeline } from '@/components/board/BoardViews';
import NewItemModal from '@/components/board/NewItemModal';
import WorkItemPanel from '@/components/work/WorkItemPanel';
import ShortcutsHelpModal from '@/app/(app)/the-work/ShortcutsHelpModal';
import { useRowShortcuts } from '@/app/(app)/the-work/useRowShortcuts';
import { BOARDS_CHANGED_EVENT } from '@/components/nav/workBoards';
import HubTable, { type TableItem } from './HubTable';
import HubKanban from './HubKanban';
import BulkBar, { runBatches } from './BulkBar';
import {
	ColumnsMenu, DoneArchivedChips, FilterChips, FilterMenu, GroupMenu, QuarterPicker, SortMenu, ViewSwitch, ViewsMenu, type FacetOptions,
} from './HubToolbar';
import { TypeChangeDialog } from './TypeChangeDialog';

export interface HubScreenProps {
	def: HubDef;
	mode: 'tab' | 'board' | 'pending' | 'client';
	/** Inside another page (Planning's Pending tile): fixed height, no hub tabs. */
	embedded?: boolean;
	state: HubState;
	payload: HubPayload;
	customColumns: CustomColumn[];
	canEdit: boolean;
	groupOptions: { key: string; label: string }[];
	defaults: { quarter_id: string | null; department_tag_id: string | null; client_id: string | null };
	serverToday: string;
}

const HUB_PARAM_KEYS = new Set(['search', 'q', 'owner', 'lead', 'status', 'dept', 'subdept', 'tag', 'client', 'discipline', 'quarter', 'due', 'closed', 'archived', 'sort', 'group', 'view', 'cols']);

const GROUP_FIELD: Record<string, EditableField> = {
	status: 'status', owner: 'owner_id', department: 'department_tag_id', quarter: 'quarter_id', client: 'client_id', urgency: 'priority',
	lead: 'project_lead_id', subdept: 'sub_team_tag_id', severity: 'severity', discipline: 'discipline_id', parent: 'parent_id',
};

const SHORTCUTS = [
	{ keys: 'C', label: 'New item' },
	{ keys: 'E or Enter', label: 'Open the row under the pointer (or focused)' },
	{ keys: '↑ ↓', label: 'Move between rows' },
	{ keys: 'Space', label: 'Select the focused row' },
	{ keys: '/', label: 'Search' },
	{ keys: '?', label: 'This help' },
	{ keys: 'Ctrl K', label: 'Create or go anywhere' },
];

function mergeCtx(a: BoardContext, b: BoardContext): BoardContext {
	return {
		...a,
		parents: { ...a.parents, ...b.parents },
		clients: { ...a.clients, ...b.clients },
		progress: { ...a.progress, ...b.progress },
		followers: { ...a.followers, ...b.followers },
		customValues: { ...a.customValues, ...b.customValues },
	};
}

export default function HubScreen(p: HubScreenProps) {
	const router = useRouter();
	const pathname = usePathname();
	const { toast, undoWindow } = useToast();
	const [, startNav] = useTransition();
	const viewerId = useAuthStore((st) => st.profile?.id);

	// -------------------------------------------------------------- data
	const [rows, setRows] = useState<WorkRow[]>(p.payload.rows);
	const [ctx, setCtx] = useState<BoardContext>(p.payload.ctx);
	const [ids, setIds] = useState<string[]>(p.payload.ids);
	const [total, setTotal] = useState(p.payload.total);
	const [groupCounts, setGroupCounts] = useState(p.payload.groupCounts);
	const [today, setToday] = useState(p.serverToday);
	useEffect(() => { setToday(localToday()); }, []);

	// UI state that never round-trips the server.
	const [view, setView] = useState<HubView>(p.state.view ?? 'table');
	const [sort, setSort] = useState(p.state.sort);
	const [cols, setCols] = useState<string[] | null>(p.state.cols);
	const [search, setSearch] = useState(p.state.search);

	const key = rowSetKey(p.state) + '|' + (p.state.group ?? '');
	const lastKey = useRef(key);
	useEffect(() => {
		setTotal(p.payload.total);
		setIds(p.payload.ids);
		setGroupCounts(p.payload.groupCounts);
		if (lastKey.current !== key) {
			// A new row set: replace what is loaded and clear the selection.
			lastKey.current = key;
			setRows(p.payload.rows);
			setCtx(p.payload.ctx);
			setSelected(new Set());
			return;
		}
		// Same rows (an action revalidated the route): refresh what came back, keep the rest.
		const fresh = new Map(p.payload.rows.map((r) => [r.id, r]));
		const keep = new Set(p.payload.ids);
		setRows((rs) => {
			const have = new Set(rs.map((r) => r.id));
			return [...rs.filter((r) => keep.has(r.id)).map((r) => fresh.get(r.id) ?? r), ...p.payload.rows.filter((r) => !have.has(r.id))];
		});
		setCtx((c) => mergeCtx({ ...p.payload.ctx, parentGroups: p.payload.ctx.parentGroups ?? c.parentGroups }, mergeCtx(c, p.payload.ctx)));
	}, [p.payload, key]);
	useEffect(() => { setView(p.state.view ?? 'table'); setSort(p.state.sort); setCols(p.state.cols); }, [p.state.view, p.state.sort, p.state.cols]);

	// Background loading of the rest of the filtered set (D8).
	const query = useMemo(() => serializeHubState({ ...p.state, view: null, sort: null, cols: null }).toString(), [p.state]);
	const [loading, setLoading] = useState(false);
	useEffect(() => {
		if (p.payload.rows.length >= p.payload.total) return;
		let cancelled = false;
		setLoading(true);
		const offsets: number[] = [];
		for (let o = p.payload.rows.length; o < p.payload.total; o += 1000) offsets.push(o);
		void (async () => {
			for (let i = 0; i < offsets.length; i += 3) {
				const res = await Promise.all(offsets.slice(i, i + 3).map((o) => loadHubRows(p.def.key, p.mode, query, o)));
				if (cancelled) return;
				for (const r of res) {
					if (!r.ok) { toast({ message: r.error, variant: 'error' }); continue; }
					setRows((rs) => {
						const have = new Set(rs.map((x) => x.id));
						return [...rs, ...r.data.rows.filter((x) => !have.has(x.id))];
					});
					setCtx((c) => mergeCtx(c, r.data.ctx));
				}
			}
			if (!cancelled) setLoading(false);
		})();
		return () => { cancelled = true; };
	}, [p.payload, p.def.key, p.mode, query, toast]);

	// ------------------------------------------------------------- URL
	const pushState = useCallback((next: HubState, opts: { server: boolean }) => {
		// Keep params that are not hub state (Planning's pending=1 and kind=).
		const merged = serializeHubState(next);
		for (const [k, v] of new URLSearchParams(window.location.search)) if (!HUB_PARAM_KEYS.has(k) && k !== 'item') merged.set(k, v);
		const s = merged.toString();
		const qs = s ? `?${s}` : '';
		if (opts.server) startNav(() => router.replace(`${pathname}${qs}`, { scroll: false }));
		else window.history.replaceState(null, '', `${pathname}${qs}${window.location.hash}`);
	}, [pathname, router]);
	const current: HubState = { ...p.state, view, sort, cols, search };
	const setFilters = (next: HubState) => pushState({ ...next, view, sort, cols }, { server: true });

	const firstSearch = useRef(true);
	useEffect(() => {
		if (firstSearch.current) { firstSearch.current = false; return; }
		const t = setTimeout(() => { if (search.trim() !== p.state.search.trim()) setFilters({ ...current, search }); }, 300);
		return () => clearTimeout(t);
	}, [search]); // eslint-disable-line react-hooks/exhaustive-deps

	// -------------------------------------------------------- derived
	const groupBy = p.state.group ?? p.def.group;
	const allLoaded = rows.length >= total;
	const columnsAll = useMemo(() => allColumns(p.customColumns), [p.customColumns]);
	const visibleKeys = cols ?? p.def.columns;
	const columns = useMemo(() => resolveColumns(visibleKeys.map((k) => ({ key: k, visible: true })), p.customColumns).filter((c) => visibleKeys.includes(c.key)), [visibleKeys, p.customColumns]);
	const sorted = useMemo(() => sortRows(rows, sort, ctx), [rows, sort, ctx]);
	const groups: RenderGroup[] = useMemo(() => {
		if (groupBy === 'none') return [{ key: 'all', label: 'All', color: 'var(--c-primary-600)', rows: sorted, count: total }];
		const base = groupRows(ctx, sorted, groupBy, p.def.kinds);
		const out: RenderGroup[] = base.map((g, i) => ({
			key: g.key, label: g.label, rows: g.rows,
			color: groupColor(groupBy, g.key, i, ctx, p.def.kinds),
			count: allLoaded ? g.rows.length : Math.max(g.rows.length, groupCounts[g.key === NO_GROUP_KEY ? '__none__' : g.key] ?? 0),
		}));
		if (!allLoaded) {
			// Groups the server counted but whose rows have not arrived yet.
			for (const [k, n] of Object.entries(groupCounts)) {
				const gk = k === '__none__' ? NO_GROUP_KEY : k;
				if (out.some((g) => g.key === gk)) continue;
				out.push({ key: gk, label: groupBy === 'status' ? (statusesFor(ctx, p.def.kinds[0]).find((s) => s.slug === k)?.label ?? k) : 'Loading…', rows: [], count: n, color: groupColor(groupBy, gk, out.length, ctx, p.def.kinds) });
			}
		}
		return out;
	}, [sorted, groupBy, ctx, p.def.kinds, allLoaded, groupCounts, total]);

	// --------------------------------------------------------- selection
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const toggleSelect = useCallback((list: string[], on: boolean) => {
		setSelected((s) => { const n = new Set(s); for (const id of list) { if (on) n.add(id); else n.delete(id); } return n; });
	}, []);
	const allState: 'none' | 'some' | 'all' = selected.size === 0 ? 'none' : selected.size >= ids.length ? 'all' : 'some';
	const toggleAll = useCallback(async () => {
		if (allState === 'all') { setSelected(new Set()); return; }
		// The server handed every id with the first paint; refresh if it may be stale.
		let all = ids;
		if (all.length < total) {
			const res = await listHubIds(p.def.key, p.mode, query);
			if (res.ok) all = res.data;
		}
		setSelected(new Set(all));
	}, [allState, ids, total, p.def.key, p.mode, query]);

	// ---------------------------------------------------- collapse/expand
	const storageKey = `or-hub:${p.def.key}:collapsed:${groupBy}`;
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	useEffect(() => {
		try { const raw = localStorage.getItem(storageKey); setCollapsed(new Set(raw ? (JSON.parse(raw) as string[]) : [])); } catch { /* private mode */ }
	}, [storageKey]);
	const toggleGroup = useCallback((k: string) => setCollapsed((s) => {
		const n = new Set(s);
		if (n.has(k)) n.delete(k); else n.add(k);
		try { localStorage.setItem(storageKey, JSON.stringify([...n])); } catch { /* ignore */ }
		return n;
	}), [storageKey]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [children, setChildren] = useState<Record<string, WorkRow[] | 'loading'>>({});
	const toggleExpand = useCallback(async (row: WorkRow) => {
		setExpanded((s) => { const n = new Set(s); if (n.has(row.id)) n.delete(row.id); else n.add(row.id); return n; });
		if (children[row.id]) return;
		setChildren((c) => ({ ...c, [row.id]: 'loading' }));
		const res = await loadChildRows(row.id);
		setChildren((c) => ({ ...c, [row.id]: res.ok ? res.data : [] }));
		if (!res.ok) toast({ message: res.error, variant: 'error' });
	}, [children, toast]);

	const archivedView = p.state.archived;
	const items: TableItem[] = useMemo(() => {
		const out: TableItem[] = [];
		const grouped = groupBy !== 'none';
		for (const g of groups) {
			if (grouped) out.push({ type: 'group', group: g, collapsed: collapsed.has(g.key) });
			if (grouped && collapsed.has(g.key)) continue;
			for (const row of g.rows) {
				out.push({ type: 'row', row, group: g, depth: 0 });
				if (expanded.has(row.id)) {
					const kids = children[row.id];
					if (kids === 'loading' || kids === undefined) out.push({ type: 'loading', group: g, label: 'Loading…' });
					else for (const k of kids) out.push({ type: 'row', row: k, group: g, depth: 1, parentId: row.id });
					if (!archivedView && CHILD_KINDS_FOR_PARENT[row.kind]) out.push({ type: 'childAdd', parent: row, group: g });
				}
			}
			if (g.rows.length < g.count) out.push({ type: 'loading', group: g, label: `Loading ${(g.count - g.rows.length).toLocaleString()} more…` });
			if (!archivedView) out.push({ type: 'add', group: g });
			if (grouped) out.push({ type: 'footer', group: g });
		}
		return out;
	}, [groups, collapsed, expanded, children, groupBy, archivedView]);

	// ------------------------------------------------------------- edits
	const patchRow = useCallback((id: string, patch: Partial<WorkRow>) => {
		setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
		setChildren((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Array.isArray(v) ? v.map((r) => (r.id === id ? { ...r, ...patch } : r)) : v])));
	}, []);

	const applyEdit = useCallback(async (row: WorkRow, e: CellEdit) => {
		if (e.kind === 'custom') {
			const prev = ctx.customValues[row.id]?.[e.columnKey] ?? null;
			setCtx((c) => ({ ...c, customValues: { ...c.customValues, [row.id]: { ...(c.customValues[row.id] ?? {}), [e.columnKey]: e.value } } }));
			const res = await setCustomValue(e.columnId, row.id, e.value as string | number | boolean | null);
			if (!res.ok) {
				setCtx((c) => ({ ...c, customValues: { ...c.customValues, [row.id]: { ...(c.customValues[row.id] ?? {}), [e.columnKey]: prev } } }));
				toast({ message: res.error, variant: 'error' });
			}
			return;
		}
		const field = e.field as EditableField;
		const prev = (row as unknown as Record<string, string | null>)[field] ?? null;
		patchRow(row.id, { [field]: e.value } as Partial<WorkRow>);
		const res = await updateItemField(row.id, field, e.value);
		if (!res.ok) { patchRow(row.id, { [field]: prev } as Partial<WorkRow>); toast({ message: res.error, variant: 'error' }); return; }
		patchRow(row.id, res.data);
		if (field === 'status') {
			const label = statusesFor(ctx, row.kind).find((s) => s.slug === e.value)?.label ?? e.value;
			toast({ message: `${row.name} → ${label}`, undo: async () => { patchRow(row.id, { status: prev ?? row.status }); await updateItemField(row.id, 'status', prev); } });
		}
	}, [ctx, toast, patchRow]);

	// ------------------------------------------------------------ create
	const parentKind = useMemo(() => p.def.kinds.map((k) => PARENT_KIND_FOR[k]).find(Boolean), [p.def.kinds]);
	const creatableKinds = useMemo(() => (groupBy === 'parent' && parentKind && ctx.parentGroups ? [...p.def.kinds, parentKind] : p.def.kinds), [groupBy, parentKind, ctx.parentGroups, p.def.kinds]);
	const [newOpen, setNewOpen] = useState(false);

	const addInGroup = useCallback(async (groupKey: string, name: string) => {
		const input: CreateItemInput = { name, kind: p.def.kinds[0] };
		if (p.defaults.quarter_id) input.quarter_id = p.defaults.quarter_id;
		if (p.defaults.department_tag_id) input.department_tag_id = p.defaults.department_tag_id;
		if (p.defaults.client_id) input.client_id = p.defaults.client_id;
		const v = groupKey === NO_GROUP_KEY || groupKey === 'all' ? null : groupKey;
		const f = GROUP_FIELD[groupBy];
		if (v && f && (['parent_id', 'status', 'owner_id', 'department_tag_id', 'quarter_id', 'client_id'] as string[]).includes(f)) (input as unknown as Record<string, string>)[f] = v;
		if (groupBy === 'kind' && v) input.kind = v;
		const res = await createItem(input);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return false; }
		setRows((rs) => [...rs, res.data]);
		setIds((xs) => [...xs, res.data.id]);
		setTotal((t) => t + 1);
		return true;
	}, [p.def.kinds, p.defaults, groupBy, toast]);

	const addChild = useCallback(async (parent: WorkRow, name: string) => {
		const childKind = CHILD_KINDS_FOR_PARENT[parent.kind]?.[0];
		if (!childKind) return false;
		const res = await createItem({ name, kind: childKind, parent_id: parent.id, quarter_id: parent.quarter_id ?? undefined });
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return false; }
		setChildren((c) => ({ ...c, [parent.id]: [...(Array.isArray(c[parent.id]) ? (c[parent.id] as WorkRow[]) : []), res.data] }));
		setCtx((c) => { const cur = c.progress[parent.id] ?? { done: 0, total: 0 }; return { ...c, progress: { ...c.progress, [parent.id]: { done: cur.done, total: cur.total + 1 } } }; });
		return true;
	}, [toast]);

	// -------------------------------------------------------------- bulk
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const noun = p.def.noun;
	const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? noun : p.def.plural}`;
	const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
	const selectedKinds = useMemo(() => [...new Set(selectedRows.map((r) => r.kind))], [selectedRows]);

	const bulkField = useCallback(async (field: EditableField, value: string | null, label: string) => {
		const list = [...selected];
		const prev = new Map(rows.filter((r) => selected.has(r.id)).map((r) => [r.id, (r as unknown as Record<string, string | null>)[field] ?? null]));
		setProgress({ done: 0, total: list.length });
		const out = await runBatches(list, (chunk) => bulkUpdateItems(chunk, field, value), (done, t) => setProgress({ done, total: t }));
		setProgress(null);
		const doneIds = new Set(list.slice(0, out.done));
		setRows((rs) => rs.map((r) => (doneIds.has(r.id) ? { ...r, [field]: value } : r)));
		if (out.error) { toast({ message: `${plural(out.done)} updated, then: ${out.error}`, variant: 'error' }); return; }
		setSelected(new Set());
		toast({
			message: `${plural(out.done)} → ${label}`,
			undo: async () => {
				const byPrev = new Map<string | null, string[]>();
				for (const id of doneIds) { const v = prev.has(id) ? prev.get(id)! : undefined; if (v === undefined) continue; byPrev.set(v, [...(byPrev.get(v) ?? []), id]); }
				for (const [v, group] of byPrev) await runBatches(group, (chunk) => bulkUpdateItems(chunk, field, v));
				setRows((rs) => rs.map((r) => (prev.has(r.id) && doneIds.has(r.id) ? { ...r, [field]: prev.get(r.id) } : r)));
			},
		});
	}, [selected, rows, toast]); // eslint-disable-line react-hooks/exhaustive-deps

	const removeRows = (list: Set<string>) => {
		setRows((rs) => rs.filter((r) => !list.has(r.id)));
		setIds((xs) => xs.filter((x) => !list.has(x)));
		setTotal((t) => Math.max(0, t - list.size));
	};

	const bulkArchive = useCallback(async () => {
		const list = [...selected];
		setProgress({ done: 0, total: list.length });
		const out = await runBatches(list, (c) => archiveItems(c), (d, t) => setProgress({ done: d, total: t }));
		setProgress(null);
		const gone = new Set(list.slice(0, out.done));
		removeRows(gone);
		setSelected(new Set());
		if (out.error) { toast({ message: `${plural(out.done)} archived, then: ${out.error}`, variant: 'error' }); return; }
		undoWindow({
			message: `Archiving ${plural(out.done)}`,
			committedMessage: `${plural(out.done)} archived. They are under the Archived filter.`,
			undoneMessage: 'Restored',
			undo: async () => { await runBatches([...gone], (c) => unarchiveItems(c)); router.refresh(); },
		});
	}, [selected, toast, undoWindow, router]); // eslint-disable-line react-hooks/exhaustive-deps

	const bulkRestore = useCallback(async () => {
		const list = [...selected];
		setProgress({ done: 0, total: list.length });
		const out = await runBatches(list, (c) => unarchiveItems(c), (d, t) => setProgress({ done: d, total: t }));
		setProgress(null);
		removeRows(new Set(list.slice(0, out.done)));
		setSelected(new Set());
		toast({ message: out.error ? `${plural(out.done)} restored, then: ${out.error}` : `${plural(out.done)} restored`, variant: out.error ? 'error' : 'success' });
	}, [selected, toast]); // eslint-disable-line react-hooks/exhaustive-deps

	const bulkDelete = useCallback(async () => {
		const list = [...selected];
		setProgress({ done: 0, total: list.length });
		let deleted = 0;
		const out = await runBatches(list, async (c) => { const r = await deleteItems(c); if (r.ok) deleted += r.data.deleted; return r; }, (d, t) => setProgress({ done: d, total: t }));
		setProgress(null);
		removeRows(new Set(list.slice(0, out.done)));
		setSelected(new Set());
		toast({ message: out.error ? `${plural(deleted)} deleted, then: ${out.error}` : `${plural(deleted)} deleted for good`, variant: out.error ? 'error' : 'success' });
	}, [selected, toast]); // eslint-disable-line react-hooks/exhaustive-deps

	// ------------------------------------------------------- the drawer
	const [panelId, setPanelId] = useState<string | null>(null);
	useEffect(() => { setPanelId(new URLSearchParams(window.location.search).get('item')); }, []);
	const setItemParam = (id: string | null) => {
		const next = new URLSearchParams(window.location.search);
		if (id) next.set('item', id); else next.delete('item');
		const qs = next.toString();
		window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
	};
	const open = useCallback((row: WorkRow) => { setPanelId(row.id); setItemParam(row.id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
	const closePanel = useCallback(() => { setPanelId(null); setItemParam(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

	// ---------------------------------------------------------- keyboard
	const [hovered, setHovered] = useState<string | null>(null);
	const [help, setHelp] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	useRowShortcuts({
		hoveredId: hovered,
		onCreate: archivedView ? undefined : () => setNewOpen(true),
		onEdit: (id) => { setPanelId(id); setItemParam(id); },
		onAssign: (id) => { setPanelId(id); setItemParam(id); },
		onStatus: (id) => { setPanelId(id); setItemParam(id); },
		onFocusSearch: () => searchRef.current?.focus(),
		onHelp: () => setHelp(true),
		enabled: !panelId && !newOpen,
	});

	// ------------------------------------------------------- saved views
	const [views, setViews] = useState<SavedView[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		void listSavedViews(p.def.slug).then((r) => { if (!cancelled) setViews(r.ok ? r.data : []); });
		return () => { cancelled = true; };
	}, [p.def.slug]);
	const currentQuery = serializeHubState(current).toString();

	// ------------------------------------------------------------ type change
	const [typeOpen, setTypeOpen] = useState(false);

	// ---------------------------------------------------------- favourite
	const [favorite, setFavorite] = useState(p.payload.favorite);
	const onFavorite = async () => {
		if (!p.def.boardId) return;
		const next = !favorite;
		setFavorite(next);
		const res = await toggleFavorite(p.def.boardId, next);
		if (!res.ok) { setFavorite(!next); toast({ message: res.error, variant: 'error' }); }
		else window.dispatchEvent(new Event(BOARDS_CHANGED_EVENT));
	};

	// ------------------------------------------------------------ render
	const tabItems = p.payload.tabs.map((t) => ({ key: t.key, label: t.label, count: t.count }));
	const tabHref = (t: { href: string; quarterDefault: 'current' | 'all' }) => {
		const s = t.quarterDefault === p.def.quarterDefault ? p.state : { ...p.state, quarter: null };
		return `${t.href}${hubQueryString({ ...s, group: null, cols: null, sort: null, view: p.state.view })}`;
	};
	const facets: FacetOptions = {
		statuses: p.def.kinds.flatMap((k) => ctx.statusesByKind[k] ?? []).filter((s, i, a) => a.findIndex((x) => x.slug === s.slug) === i),
		clients: Object.entries(ctx.clients).map(([id, c]) => ({ id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
	};
	const filtered = filterCount(p.state) > 0;
	const quarterApplies = true;

	return (
		<div className={clsx('flex flex-col gap-2', p.embedded ? 'h-[36rem]' : 'h-[calc(100dvh-5.5rem)] min-h-[32rem]')}>
			{tabItems.length > 0 && !p.embedded ? (
				<div className="flex items-end gap-3">
					<Tabs items={tabItems} value={p.def.key} label={p.def.tabSet === 'client' ? 'Client work by type' : 'Work by type'} onChange={(k) => {
						const t = p.payload.tabs.find((x) => x.key === k)!;
						startNav(() => router.push(tabHref(t)));
					}} className="min-w-0 flex-1" />
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				{p.embedded ? <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{p.def.label}</h2> : <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">{p.def.label}</h1>}
				{p.def.boardId && (
					<IconButton aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={favorite} size="sm" bordered={false} onClick={onFavorite}
						className={clsx(favorite && 'text-amber-500')}>
						<Star className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
					</IconButton>
				)}
				<span className="text-sm tabular-nums text-slate-600 dark:text-slate-400" aria-live="polite">
					{total.toLocaleString()} {archivedView ? 'archived ' : ''}{total === 1 ? noun : p.def.plural}
					{loading && !allLoaded && <span className="ml-1 text-2xs text-slate-500">(loading {rows.length.toLocaleString()} of {total.toLocaleString()})</span>}
				</span>
				<div className="ml-auto flex items-center gap-2">
					{!archivedView && <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />New {creatableKinds.length > 2 ? 'item' : creatableKinds.map((k) => (KIND_LABELS[k] ?? k).toLowerCase()).join(' / ')}</Button>}
					{p.canEdit && p.def.boardId && (
						<Link href={`/the-work/b/${p.def.slug}/settings`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 px-2 text-xs text-slate-700 hover:bg-hover dark:border-slate-600 dark:text-slate-200">
							<Settings2 className="h-3.5 w-3.5" aria-hidden="true" />Board settings
						</Link>
					)}
					<IconButton aria-label="Keyboard shortcuts" size="sm" onClick={() => setHelp(true)}><HelpCircle className="h-4 w-4" aria-hidden="true" /></IconButton>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<SearchInput ref={searchRef} aria-label={`Search ${p.def.plural}`} placeholder={`Search ${p.def.plural}  /`} value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
				{quarterApplies && (
					<QuarterPicker quarters={p.payload.quarters} value={p.state.quarter} currentId={p.payload.currentQuarterId} defaultMode={p.def.quarterDefault}
						onChange={(q) => setFilters({ ...current, quarter: q })} />
				)}
				<FilterMenu state={current} ctx={ctx} extra={facets} onChange={setFilters} />
				<SortMenu state={current} onChange={(s) => { setSort(s.sort); pushState({ ...current, sort: s.sort }, { server: false }); }} />
				<GroupMenu options={p.groupOptions} value={groupBy} defaultValue={p.def.group} onChange={(g) => setFilters({ ...current, group: g })} />
				{view === 'table' && <ColumnsMenu all={columnsAll} visible={visibleKeys} onChange={(keys) => { setCols(keys); pushState({ ...current, cols: keys }, { server: false }); }} />}
				<DoneArchivedChips state={current} onChange={(s) => { setSelected(new Set()); setFilters(s); }} />
				<div className="ml-auto flex items-center gap-2">
					<ViewsMenu views={views} people={ctx.people} current={currentQuery}
						onApply={(v) => startNav(() => router.replace(`${pathname}${v.query ? `?${v.query}` : ''}`, { scroll: false }))}
						onSave={async (name, shared, id) => {
							const res = await saveView(p.def.slug, name, currentQuery, shared, id);
							if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
							setViews((vs) => [...(vs ?? []).filter((x) => x.id !== res.data.id), res.data].sort((a, b) => a.name.localeCompare(b.name)));
							toast({ message: `View “${res.data.name}” saved`, variant: 'success' });
						}}
						onDelete={async (v) => {
							const res = await deleteView(v.id);
							if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
							setViews((vs) => (vs ?? []).filter((x) => x.id !== v.id));
						}} />
					<ViewSwitch value={view} onChange={(v) => { setView(v); pushState({ ...current, view: v === 'table' ? null : v }, { server: false }); }} />
				</div>
			</div>
			<FilterChips state={current} ctx={ctx} extra={facets} onChange={setFilters} />

			{selected.size > 0 && selected.size < ids.length && allState !== 'all' && selected.size >= Math.min(rows.length, ids.length) && (
				<p className="text-xs text-slate-600 dark:text-slate-400">
					{plural(selected.size)} selected. <Button size="sm" variant="ghost" onClick={() => void toggleAll()}>Select all {plural(ids.length)} in this list</Button>
				</p>
			)}

			<div className="min-h-0 flex-1">
				{view === 'table' && (
					<HubTable
						items={items} columns={columns} ctx={ctx} today={today} noun={noun[0].toUpperCase() + noun.slice(1)}
						selected={selected} onToggleSelect={toggleSelect} allState={allState} onToggleAll={() => void toggleAll()}
						onToggleGroup={toggleGroup} onEdit={applyEdit} onOpen={open} onAdd={archivedView ? undefined : addInGroup}
						expanded={expanded} onToggleExpand={toggleExpand} onAddChild={archivedView ? undefined : addChild}
						readOnly={archivedView} onHoverRow={setHovered}
						empty={archivedView ? <p>Nothing archived here.</p> : filtered ? (
							<div className="space-y-2"><p>No {p.def.plural} match these filters.</p><Button size="sm" variant="outline" onClick={() => setFilters({ ...current, search: '', owner: [], lead: [], status: [], dept: [], subdept: [], tag: [], client: [], discipline: [], due: null })}>Clear filters</Button></div>
						) : (
							<div className="space-y-2"><p>No {p.def.plural} yet.</p><Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />New {noun}</Button></div>
						)}
					/>
				)}
				{view === 'board' && (
					<HubKanban groups={groupBy === 'none' ? groupsBy(ctx, sorted, 'status', p.def.kinds, total, groupCounts, allLoaded) : groups} ctx={ctx} today={today} onOpen={open} readOnly={archivedView}
						canDrop={!!GROUP_FIELD[groupBy === 'none' ? 'status' : groupBy] && groupBy !== 'parent'}
						onMove={(row, gk) => {
							const f = GROUP_FIELD[groupBy === 'none' ? 'status' : groupBy];
							if (!f) return;
							void applyEdit(row, { kind: 'field', field: f as never, value: gk === NO_GROUP_KEY ? null : gk });
						}} />
				)}
				{view === 'timeline' && <div className="h-full overflow-auto"><BoardTimeline groups={groups} ctx={ctx} today={today} onOpen={open} /></div>}
				{view === 'calendar' && <div className="h-full overflow-auto"><BoardCalendar groups={groups} today={today} onOpen={open} /></div>}
			</div>

			<NewItemModal
				open={newOpen}
				onClose={() => setNewOpen(false)}
				kinds={creatableKinds}
				ctx={ctx}
				viewerId={viewerId}
				boardName={p.def.label}
				defaults={p.defaults}
				onCreated={(row, openIt) => {
					if (p.def.kinds.includes(row.kind)) { setRows((rs) => [...rs, row]); setIds((xs) => [...xs, row.id]); setTotal((t) => t + 1); }
					else setCtx((c) => ({ ...c, parents: { ...c.parents, [row.id]: { name: row.name, kind: row.kind } }, parentGroups: [...(c.parentGroups ?? []), row.id] }));
					toast({ message: `Created ${row.name}`, variant: 'success' });
					if (openIt) open(row);
				}}
			/>

			{panelId && (
				<WorkItemPanel itemId={panelId} ctx={ctx} today={today} onClose={closePanel}
					onRowChange={(row) => patchRow(row.id, row)}
					onRemoved={(id) => removeRows(new Set([id]))}
					onUndone={(row) => setRows((rs) => (rs.some((r) => r.id === row.id) ? rs : [...rs, row]))}
					onOpenItem={(id) => { setPanelId(id); setItemParam(id); }} />
			)}

			{selected.size > 0 && (
				<BulkBar count={selected.size} noun={noun} plural={p.def.plural} ctx={ctx} kinds={selectedKinds.length ? selectedKinds : p.def.kinds} mode={archivedView ? 'archived' : 'live'} progress={progress}
					onStatus={(slug, label) => void bulkField('status', slug, label)}
					onOwner={(id) => void bulkField('owner_id', id, id ? ctx.people[id]?.name ?? 'owner' : 'Unassigned')}
					onDue={(d) => void bulkField('ends_at', d, d ? `due ${d}` : 'no due date')}
					onArchive={() => void bulkArchive()} onRestore={() => void bulkRestore()} onDelete={() => void bulkDelete()}
					onType={() => setTypeOpen(true)}
					onClear={() => setSelected(new Set())} />
			)}

			<TypeChangeDialog
				open={typeOpen}
				onClose={() => setTypeOpen(false)}
				rows={selectedRows}
				ctx={ctx}
				onDone={(changed) => { removeRows(new Set(changed.filter((r) => !p.def.kinds.includes(r.kind)).map((r) => r.id))); for (const r of changed) if (p.def.kinds.includes(r.kind)) patchRow(r.id, r); setSelected(new Set()); }}
			/>

			<ShortcutsHelpModal open={help} onClose={() => setHelp(false)} items={SHORTCUTS} title="The Work shortcuts" />
		</div>
	);
}

/** Status columns for the board view when the table is ungrouped. */
function groupsBy(ctx: BoardContext, rows: WorkRow[], by: string, kinds: string[], total: number, counts: Record<string, number>, allLoaded: boolean): RenderGroup[] {
	return groupRows(ctx, rows, by, kinds).map((g, i) => ({ key: g.key, label: g.label, rows: g.rows, color: groupColor(by, g.key, i, ctx, kinds), count: allLoaded ? g.rows.length : Math.max(g.rows.length, counts[g.key] ?? 0) }));
}
