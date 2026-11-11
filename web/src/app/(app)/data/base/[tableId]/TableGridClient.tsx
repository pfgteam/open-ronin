'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Callout from '@/components/ui/Callout';
import { getGridData, createRow, updateCell, deleteRow, importCsv, createColumn, updateColumn, deleteColumn, moveRow, pasteCells, listViews, saveView, deleteView, resolveLinkLabels, listTables } from '../../bases/actions';
import type { GridRow, GridColumnInfo, ViewInfo } from '../../bases/actions';
import { Plus, Trash2, ChevronLeft, FileUp, Settings2, X, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, GripVertical, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import FilterBar from './FilterBar';
import RefPicker from './RefPicker';
import ViewsBar from './ViewsBar';
import KanbanView from './KanbanView';

// Column type vocabulary mirrors the nt_column_type enum in 0096. Pure module,
// no server imports, so it is safe here.
import { COLUMN_TYPES } from '@/lib/native-tables/values';
import type { ColumnType } from '@/lib/native-tables/values';
import { EMPTY_QUERY, isEmptyQuery } from '@/lib/native-tables/query';
import type { GridQuery } from '@/lib/native-tables/query';
import AutoLoad from '@/components/ui/AutoLoad';

const TYPE_LABEL: Record<ColumnType, string> = {
  text: 'Text', long_text: 'Long text', number: 'Number', currency: 'Currency',
  percent: 'Percent', rating: 'Rating', duration: 'Duration', boolean: 'Checkbox',
  datetime: 'Date/time', select: 'Select', url: 'URL', email: 'Email', phone: 'Phone',
  user: 'User', brand: 'Brand', link: 'Link to table', formula: 'Formula',
};

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent', 'rating', 'duration']);
const REF_TYPES: ReadonlySet<string> = new Set(['user', 'brand', 'link']);
const AUDIENCE = ['exec', 'admin', 'manager', 'contributor'] as const;

type GridColumn = GridColumnInfo;

const PAGE_SIZE = 50;

interface Props {
  tableId: string;
  tableName: string;
}

/** Display formatter per column type; editing uses the raw value. */
function formatCell(col: GridColumn, v: unknown, linkLabels?: Record<string, string>): string {
  if (v == null) return '';
  switch (col.type) {
    case 'boolean':
      return v ? '✓' : '';
    case 'currency': {
      const n = Number(v);
      return isNaN(n) ? String(v) : n.toLocaleString(undefined, { style: 'currency', currency: String(col.config.currency ?? 'USD') });
    }
    case 'percent': {
      const n = Number(v);
      return isNaN(n) ? String(v) : `${n}%`;
    }
    case 'datetime': {
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
    }
    case 'select':
      return Array.isArray(v) ? v.join(', ') : String(v);
    case 'link':
      return Array.isArray(v) ? v.map((id) => linkLabels?.[String(id)] ?? String(id).slice(0, 8)).join(', ') : String(v);
    case 'user':
    case 'brand':
      return typeof v === 'object' ? String((v as { name?: unknown }).name ?? '') : String(v);
    default:
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'object') return JSON.stringify(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
  }
}

/** Coerce the editor's string into the typed JSON value the cell stores. */
function parseEdit(col: GridColumn, raw: string): unknown {
  const t = raw.trim();
  if (t === '') return null;
  if (NUMERIC_TYPES.has(col.type)) {
    const n = Number(t.replace(/[$,%]/g, ''));
    return isNaN(n) ? null : n;
  }
  if (col.type === 'datetime') {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (col.type === 'select') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return t;
}

function editorInitial(col: GridColumn, v: unknown): string {
  if (v == null) return '';
  if (col.type === 'datetime') {
    const d = new Date(String(v));
    // datetime-local wants local yyyy-MM-ddTHH:mm
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function TableGridClient({ tableId, tableName }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [serverQuery, setServerQuery] = useState(true);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);

  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const skipBlurRef = useRef(false);

  // Reference picker (link / user / brand) anchored to the cell button.
  const [picker, setPicker] = useState<{ rowId: string; col: GridColumn } | null>(null);
  const pickerAnchor = useRef<HTMLElement | null>(null);
  const [linkLabels, setLinkLabels] = useState<Record<string, string>>({});

  const [creatingRow, setCreatingRow] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Column editor: null = closed, 'new' = add form, otherwise the column id.
  const [colEditor, setColEditor] = useState<'new' | string | null>(null);
  const [colName, setColName] = useState('');
  const [colType, setColType] = useState<ColumnType>('text');
  const [colOptions, setColOptions] = useState('');
  const [colExpression, setColExpression] = useState('');
  const [colTarget, setColTarget] = useState('');
  const [colAudience, setColAudience] = useState<string[]>([]);
  const [colBusy, setColBusy] = useState(false);
  const [otherTables, setOtherTables] = useState<Array<{ id: string; name: string }>>([]);

  // Server-side query (phase 3): filters + sorts + search go to nt_query_rows().
  const [query, setQuery] = useState<GridQuery>(EMPTY_QUERY);
  const [searchDraft, setSearchDraft] = useState('');
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  // Views (phase 5).
  const [views, setViews] = useState<ViewInfo[]>([]);
  const [viewsAvailable, setViewsAvailable] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewBusy, setViewBusy] = useState(false);

  // Row drag (phase 3).
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ rowId: string; edge: 'before' | 'after' } | null>(null);

  const loadPage = useCallback(async (pageNum: number, reset = false, q: GridQuery = query) => {
    setLoading(true);
    setError(null);
    const res = await getGridData(tableId, PAGE_SIZE, pageNum * PAGE_SIZE, q, true);
    setLoading(false);
    if (res.ok) {
      setServerQuery(res.data.server_query);
      setSource(res.data.source);
      if (reset) {
        setRows(res.data.rows);
        setColumns(res.data.columns);
        setTotalRows(res.data.total_rows);
        setHasMore(res.data.has_more);
      } else {
        setRows((prev) => [...prev, ...res.data.rows]);
        setHasMore(res.data.has_more);
      }
    } else {
      setError(res.error);
    }
  }, [tableId, query]);

  // Initial load + view from URL (?view=<id>).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = await listViews(tableId);
      if (cancelled) return;
      if (v.ok) {
        setViews(v.views);
        setViewsAvailable(v.available);
        const wanted = searchParams.get('view');
        const found = wanted ? v.views.find((x) => x.id === wanted) : null;
        if (found) {
          setActiveViewId(found.id);
          setQuery(found.query);
          setSearchDraft(found.query.search);
          setHiddenIds(found.hidden_column_ids);
          setPage(0);
          await loadPage(0, true, found.query);
          return;
        }
      }
      setPage(0);
      await loadPage(0, true, EMPTY_QUERY);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const applyQuery = (q: GridQuery) => {
    setQuery(q);
    setPage(0);
    void loadPage(0, true, q);
  };

  // Debounced search -> query.search.
  useEffect(() => {
    if (searchDraft === query.search) return;
    const t = setTimeout(() => applyQuery({ ...query, search: searchDraft }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const loadMore = () => {
    if (!hasMore || loading) return;
    loadPage(page + 1);
    setPage((p) => p + 1);
  };

  const visibleColumns = useMemo(() => columns.filter((c) => (showHidden || !c.is_hidden) && !hiddenIds.includes(c.id)), [columns, hiddenIds, showHidden]);
  const selectColumns = useMemo(() => columns.filter((c) => c.type === 'select').map((c) => ({ id: c.id, name: c.name })), [columns]);
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const viewDirty = activeView ? JSON.stringify(activeView.query) !== JSON.stringify(query) || JSON.stringify(activeView.hidden_column_ids) !== JSON.stringify(hiddenIds) : false;

  // Resolve link labels for the rows on screen.
  useEffect(() => {
    const linkCols = columns.filter((c) => c.type === 'link' && typeof c.config.target_table_id === 'string');
    if (linkCols.length === 0) return;
    const wanted = new Map<string, Set<string>>();
    for (const c of linkCols) {
      const target = String(c.config.target_table_id);
      const set = wanted.get(target) ?? new Set<string>();
      for (const r of rows) {
        const v = r.cells[c.id];
        if (Array.isArray(v)) for (const id of v) if (!(String(id) in linkLabels)) set.add(String(id));
      }
      wanted.set(target, set);
    }
    for (const [target, ids] of wanted) {
      if (ids.size === 0) continue;
      resolveLinkLabels(target, [...ids]).then((res) => {
        if (res.ok) setLinkLabels((prev) => ({ ...prev, ...res.labels }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  const startEdit = (rowId: string, col: GridColumn, currentValue: unknown, anchor?: HTMLElement) => {
    if (col.type === 'formula') return;
    if (REF_TYPES.has(col.type)) {
      pickerAnchor.current = anchor ?? null;
      setPicker({ rowId, col });
      return;
    }
    setEditingCell({ rowId, colId: col.id });
    setEditValue(editorInitial(col, currentValue));
  };

  const writeCell = async (rowId: string, col: GridColumn, value: unknown) => {
    setSavingCell(true);
    const res = await updateCell(tableId, rowId, col.id, value as Parameters<typeof updateCell>[3]);
    setSavingCell(false);
    if (res.ok) {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [col.id]: value as GridRow['cells'][string] } } : r)));
      // Formula columns depend on this cell: refresh the row's computed values.
      if (columns.some((c) => c.type === 'formula')) void loadPage(0, true);
    } else {
      setError(res.error);
    }
  };

  const commitCell = async () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    if (!editingCell) return;
    const col = columns.find((c) => c.id === editingCell.colId);
    const target = editingCell;
    setEditingCell(null);
    if (!col) return;
    await writeCell(target.rowId, col, parseEdit(col, editValue));
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const handleAddRow = async () => {
    setCreatingRow(true);
    const res = await createRow(tableId, {});
    setCreatingRow(false);
    if (res.ok) {
      loadPage(page, true);
    } else {
      setError(res.error);
    }
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!confirm('Delete this row?')) return;
    const res = await deleteRow(tableId, rowId);
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      setTotalRows((n) => Math.max(0, n - 1));
    } else {
      setError(res.error);
    }
  };

  const handleImport = async (file: File) => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    const text = await file.text();
    const res = await importCsv(tableId, text, true);
    setImporting(false);
    if (res.ok) {
      loadPage(0, true);
    } else {
      setImportError(res.error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImport(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---- paste (phase 3) -----------------------------------------------------

  const handlePaste = async (e: React.ClipboardEvent, rowId: string, col: GridColumn) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return; // single value: let the editor handle it
    e.preventDefault();
    setPasteNote(null);
    const res = await pasteCells(tableId, rowId, col.id, text, rows.map((r) => r.id), visibleColumns.map((c) => c.id));
    if (res.ok) {
      setPasteNote(`Pasted ${res.cells_written} cell${res.cells_written === 1 ? '' : 's'}${res.rows_created ? `, added ${res.rows_created} row${res.rows_created === 1 ? '' : 's'}` : ''}${res.cells_skipped ? `, skipped ${res.cells_skipped}` : ''}.`);
      void loadPage(0, true);
    } else {
      setError(res.error);
    }
  };

  // ---- row drag reorder (phase 3) -----------------------------------------

  const canReorder = isEmptyQuery(query) && !activeView;

  const handleDrop = async (targetRowId: string, edge: 'before' | 'after') => {
    const moving = dragRow;
    setDragRow(null);
    setDropAt(null);
    if (!moving || moving === targetRowId) return;
    const order = rows.filter((r) => r.id !== moving).map((r) => r.id);
    const ti = order.indexOf(targetRowId);
    if (ti < 0) return;
    const insertAt = edge === 'before' ? ti : ti + 1;
    const before = insertAt > 0 ? order[insertAt - 1] : null;
    const after = insertAt < order.length ? order[insertAt] : null;
    // Optimistic reorder.
    setRows((prev) => {
      const movedRow = prev.find((r) => r.id === moving);
      if (!movedRow) return prev;
      const rest = prev.filter((r) => r.id !== moving);
      rest.splice(insertAt, 0, movedRow);
      return rest;
    });
    const res = await moveRow(tableId, moving, before, after);
    if (!res.ok) {
      setError(res.error);
      void loadPage(0, true);
    } else if (res.renumbered) {
      void loadPage(0, true);
    }
  };

  // ---- column editor -------------------------------------------------------

  const openNewColumn = () => {
    setColEditor('new');
    setColName('');
    setColType('text');
    setColOptions('');
    setColExpression('');
    setColTarget('');
    setColAudience([]);
    void loadOtherTables();
  };

  const loadOtherTables = async () => {
    const res = await listTables();
    if (res.ok) setOtherTables(res.tables.map((t) => ({ id: t.id, name: t.name })));
  };

  const openEditColumn = (col: GridColumn) => {
    setColEditor(col.id);
    setColName(col.name);
    setColType((COLUMN_TYPES as readonly string[]).includes(col.type) ? (col.type as ColumnType) : 'text');
    const opts = col.config.options;
    setColOptions(Array.isArray(opts) ? opts.map(String).join(', ') : '');
    setColExpression(typeof col.config.expression === 'string' ? col.config.expression : '');
    setColTarget(typeof col.config.target_table_id === 'string' ? col.config.target_table_id : '');
    setColAudience(Array.isArray(col.config.visible_to) ? col.config.visible_to.map(String) : []);
    void loadOtherTables();
  };

  const buildConfig = (existing: Record<string, unknown> = {}): Record<string, unknown> => {
    const cfg: Record<string, unknown> = { ...existing };
    delete cfg.options; delete cfg.expression; delete cfg.target_table_id; delete cfg.visible_to;
    if (colType === 'select') cfg.options = colOptions.split(',').map((s) => s.trim()).filter(Boolean);
    if (colType === 'formula') cfg.expression = colExpression;
    if (colType === 'link') cfg.target_table_id = colTarget;
    if (colAudience.length > 0 && colAudience.length < AUDIENCE.length) cfg.visible_to = colAudience;
    return cfg;
  };

  const saveColumn = async () => {
    const name = colName.trim();
    if (!name || !colEditor) return;
    setColBusy(true);
    setError(null);
    const existing = colEditor === 'new' ? {} : (columns.find((c) => c.id === colEditor)?.config ?? {});
    const res = colEditor === 'new'
      ? await createColumn(tableId, { name, type: colType, config: buildConfig() })
      : await updateColumn(colEditor, { name, type: colType, config: buildConfig(existing) });
    setColBusy(false);
    if (res.ok) {
      setColEditor(null);
      loadPage(0, true);
    } else {
      setError(res.error);
    }
  };

  const removeColumn = async () => {
    if (!colEditor || colEditor === 'new') return;
    if (!confirm('Delete this column and every value in it?')) return;
    setColBusy(true);
    const res = await deleteColumn(colEditor);
    setColBusy(false);
    if (res.ok) {
      setColEditor(null);
      loadPage(0, true);
    } else {
      setError(res.error);
    }
  };

  const toggleHideColumn = async (col: GridColumn) => {
    const res = await updateColumn(col.id, { is_hidden: !col.is_hidden });
    if (res.ok) setColumns((prev) => prev.map((c) => (c.id === col.id ? { ...c, is_hidden: !c.is_hidden } : c)));
    else setError(res.error);
  };

  /**
   * Move the column being edited one step left/right. order_key is a plain
   * string compared lexically; for a handful of columns rewriting every key
   * from the visible order is cheaper to reason about than lexical midpoints.
   * (Rows use the true fractional scheme via moveRow.)
   */
  const moveColumn = async (delta: -1 | 1) => {
    if (!colEditor || colEditor === 'new') return;
    const idx = columns.findIndex((c) => c.id === colEditor);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= columns.length) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(target, 0, moved);
    setColBusy(true);
    let failed: string | null = null;
    for (let i = 0; i < reordered.length; i++) {
      const key = String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
      const res = await updateColumn(reordered[i].id, { order_key: key });
      if (!res.ok) { failed = res.error; break; }
    }
    setColBusy(false);
    if (failed) setError(failed);
    loadPage(0, true);
  };

  const resizeColumn = async (col: GridColumn, width: number) => {
    const w = Math.max(80, Math.min(800, Math.round(width)));
    if (w === col.width) return;
    setColumns((prev) => prev.map((c) => (c.id === col.id ? { ...c, width: w } : c)));
    const res = await updateColumn(col.id, { width: w });
    if (!res.ok) setError(res.error);
  };

  const colWidth = (col: GridColumn) => (col.width ? col.width : 150);

  const toggleSort = (colId: string) => {
    const current = query.sorts[0];
    const next: GridQuery['sorts'] = current?.column_id !== colId ? [{ column_id: colId, dir: 'asc' }] : current.dir === 'asc' ? [{ column_id: colId, dir: 'desc' }] : [];
    applyQuery({ ...query, sorts: next });
  };
  const sort = query.sorts[0] ?? null;

  // ---- views (phase 5) -----------------------------------------------------

  const selectView = (v: ViewInfo | null) => {
    setActiveViewId(v?.id ?? null);
    const q = v ? v.query : EMPTY_QUERY;
    setSearchDraft(q.search);
    setHiddenIds(v ? v.hidden_column_ids : []);
    applyQuery(q);
    const url = new URL(window.location.href);
    if (v) url.searchParams.set('view', v.id); else url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
  };

  const handleSaveView = async (name: string, kind: 'grid' | 'kanban', groupBy: string | null, asNew: boolean) => {
    setViewBusy(true);
    const res = await saveView(tableId, { id: asNew ? undefined : activeViewId ?? undefined, name, kind, query, hidden_column_ids: hiddenIds, group_by_column_id: groupBy });
    setViewBusy(false);
    if (!res.ok) { setError(res.error); return; }
    const v = await listViews(tableId);
    if (v.ok) {
      setViews(v.views);
      setViewsAvailable(v.available);
      setActiveViewId(res.id);
      const url = new URL(window.location.href);
      url.searchParams.set('view', res.id);
      window.history.replaceState(null, '', url.toString());
    }
  };

  const handleDeleteView = async (v: ViewInfo) => {
    setViewBusy(true);
    const res = await deleteView(v.id);
    setViewBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setViews((prev) => prev.filter((x) => x.id !== v.id));
    if (activeViewId === v.id) selectView(null);
  };

  const kanbanColumn = activeView?.kind === 'kanban' ? columns.find((c) => c.id === activeView.group_by_column_id) ?? null : null;

  /** Tab / Shift+Tab move to the neighbouring editable cell in the visible order. */
  const moveEdit = (rowId: string, colId: string, delta: 1 | -1) => {
    const editable = visibleColumns.filter((c) => c.type !== 'boolean' && c.type !== 'formula' && !REF_TYPES.has(c.type));
    const ci = editable.findIndex((c) => c.id === colId);
    const ri = rows.findIndex((r) => r.id === rowId);
    if (ci < 0 || ri < 0) return;
    let nci = ci + delta;
    let nri = ri;
    if (nci >= editable.length) { nci = 0; nri = ri + 1; }
    if (nci < 0) { nci = editable.length - 1; nri = ri - 1; }
    const nextRow = rows[nri];
    if (!nextRow) return;
    const nextCol = editable[nci];
    startEdit(nextRow.id, nextCol, nextRow.cells[nextCol.id]);
  };

  const renderEditor = (col: GridColumn) => {
    const common = {
      value: editValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setEditValue(e.target.value),
      onBlur: commitCell,
      disabled: savingCell,
      autoFocus: true,
      className: 'w-full text-xs px-1 py-0.5 border border-primary-300 dark:border-primary-700 rounded-md bg-white dark:bg-slate-800 focus:outline-none',
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(col.type === 'long_text' && e.shiftKey)) {
        e.preventDefault();
        commitCell();
      }
      if (e.key === 'Tab' && editingCell) {
        e.preventDefault();
        const target = editingCell;
        const delta: 1 | -1 = e.shiftKey ? -1 : 1;
        const value = parseEdit(col, editValue);
        // The input unmounts and fires onBlur with a stale closure; tell it
        // this edit was already committed so it neither double-writes nor
        // cancels the next cell's edit.
        skipBlurRef.current = true;
        setTimeout(() => { skipBlurRef.current = false; }, 0);
        void writeCell(target.rowId, col, value);
        moveEdit(target.rowId, target.colId, delta);
      }
      if (e.key === 'Escape') cancelEdit();
    };
    if (col.type === 'long_text') return <textarea {...common} rows={3} onKeyDown={onKeyDown} />;
    if (NUMERIC_TYPES.has(col.type)) return <input {...common} type="number" step="any" onKeyDown={onKeyDown} />;
    if (col.type === 'datetime') return <input {...common} type="datetime-local" onKeyDown={onKeyDown} />;
    if (col.type === 'select' && Array.isArray(col.config.options) && col.config.options.length > 0) {
      return (
        <select {...common} onKeyDown={onKeyDown}>
          <option value="">—</option>
          {(col.config.options as unknown[]).map((o) => (
            <option key={String(o)} value={String(o)}>{String(o)}</option>
          ))}
        </select>
      );
    }
    const inputType = col.type === 'email' ? 'email' : col.type === 'url' ? 'url' : 'text';
    return <input {...common} type={inputType} onKeyDown={onKeyDown} />;
  };

  const sourceInfo = source && source.kind === 'airtable' ? source as { base_name?: string; table_name?: string; mirrored_at?: string; record_count?: number } : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/data/bases')}
          className="gap-1.5"
        >
          <ChevronLeft className="w-4 h-4" /> Tables
        </Button>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tableName}</h1>
        <span className="text-xs text-slate-400 dark:text-slate-500">{totalRows} rows · {columns.length} columns</span>
        <div className="flex-1" />
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder={serverQuery ? 'Search all rows' : 'Search (needs 0109)'}
          className="w-48 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
          aria-label="Search rows"
        />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHidden((s) => !s)} className="gap-1.5" title={showHidden ? 'Hide hidden columns' : 'Show hidden columns'}>
            {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="outline" size="sm" onClick={openNewColumn} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Column
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="gap-1.5"
          >
            <FileUp className="w-3.5 h-3.5" /> {importing ? 'Importing…' : 'Import'}
          </Button>
          <Button
            size="sm"
            onClick={handleAddRow}
            disabled={creatingRow}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Row
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <ViewsBar
        views={views}
        available={viewsAvailable}
        activeViewId={activeViewId}
        dirty={viewDirty}
        onSelect={selectView}
        onSave={handleSaveView}
        onDelete={handleDeleteView}
        selectColumns={selectColumns}
        busy={viewBusy}
      />

      <FilterBar columns={columns} query={query} onChange={applyQuery} disabled={!serverQuery} />

      {!serverQuery && (
        <Callout tone="warning">
          Server-side filter, sort and search need migration 0109 (pending apply). Showing rows in stored order.
        </Callout>
      )}

      {sourceInfo && (
        <Callout tone="info" className="flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span>
            Mirrored from Airtable {sourceInfo.base_name ? <strong>{sourceInfo.base_name}</strong> : null}{sourceInfo.table_name ? <> / <strong>{sourceInfo.table_name}</strong></> : null}
            {sourceInfo.mirrored_at ? ` on ${new Date(sourceInfo.mirrored_at).toLocaleString()}` : ''}{typeof sourceInfo.record_count === 'number' ? ` (${sourceInfo.record_count} records)` : ''}. Re-run the mirror from Tables to refresh; edits here do not flow back to Airtable.
          </span>
        </Callout>
      )}

      {importError && <Callout tone="error">{importError}</Callout>}
      {error && <Callout tone="error">{error}</Callout>}
      {pasteNote && <Callout tone="success">{pasteNote}</Callout>}

      {colEditor && (
        <Card className="border border-primary-200 dark:border-primary-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {colEditor === 'new' ? 'New column' : 'Edit column'}
            </h2>
            <button type="button" onClick={() => setColEditor(null)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); saveColumn(); }}
            className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
          >
            <Input label="Name" value={colName} onChange={(e) => setColName(e.target.value)} placeholder="Column name" disabled={colBusy} />
            <Select label="Type" value={colType} onChange={(e) => setColType(e.target.value as ColumnType)} disabled={colBusy}>
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </Select>
            {colType === 'select' ? (
              <Input label="Options (comma-separated)" value={colOptions} onChange={(e) => setColOptions(e.target.value)} placeholder="Open, In progress, Done" disabled={colBusy} />
            ) : colType === 'link' ? (
              <Select label="Links to table" value={colTarget} onChange={(e) => setColTarget(e.target.value)} disabled={colBusy}>
                <option value="">Choose a table</option>
                {otherTables.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === tableId ? ' (this table)' : ''}</option>)}
              </Select>
            ) : (
              <div />
            )}
            {colType === 'formula' && (
              <div className="md:col-span-3">
                <Input label="Expression" value={colExpression} onChange={(e) => setColExpression(e.target.value)} placeholder='IF({Amount} > 100, "big", "small")' disabled={colBusy} />
                <p className="mt-1 text-2xs text-slate-400 dark:text-slate-500">Reference columns as {'{Name}'}. Functions: IF, AND, OR, NOT, CONCAT, UPPER, LOWER, TRIM, LEN, ROUND, ABS, MIN, MAX, SUM, ISBLANK, TODAY, NOW, DATEDIFF_DAYS, YEAR, MONTH. Operators + - * / &amp; = != &lt; &lt;= &gt; &gt;=. Read-only, computed when the grid loads.</p>
              </div>
            )}
            <div className="md:col-span-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">Visible to</span>
              {AUDIENCE.map((r) => (
                <label key={r} className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={colAudience.length === 0 || colAudience.includes(r)}
                    onChange={(e) => {
                      const base = colAudience.length === 0 ? [...AUDIENCE] : colAudience;
                      const next = e.target.checked ? [...new Set([...base, r])] : base.filter((x) => x !== r);
                      setColAudience(next.length === AUDIENCE.length ? [] : next);
                    }}
                    className="h-3.5 w-3.5 rounded-sm border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                    disabled={colBusy}
                  />
                  {r}
                </label>
              ))}
              <span className="text-2xs text-slate-400 dark:text-slate-500">Unchecked roles never receive this column&rsquo;s values.</span>
            </div>
            <div className="md:col-span-3 flex items-center gap-2">
              <Button type="submit" size="sm" disabled={!colName.trim() || colBusy || (colType === 'link' && !colTarget) || (colType === 'formula' && !colExpression.trim())}>
                {colBusy ? 'Saving…' : colEditor === 'new' ? 'Add column' : 'Save'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setColEditor(null)} disabled={colBusy}>Cancel</Button>
              {colEditor !== 'new' && (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => moveColumn(-1)} disabled={colBusy} className="gap-1" title="Move left">
                    <ArrowLeft className="w-3.5 h-3.5" /> Left
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => moveColumn(1)} disabled={colBusy} className="gap-1" title="Move right">
                    Right <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                  {(() => { const c = columns.find((x) => x.id === colEditor); return c ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => toggleHideColumn(c)} disabled={colBusy} className="gap-1" title={c.is_hidden ? 'Show column' : 'Hide column'}>
                      {c.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} {c.is_hidden ? 'Unhide' : 'Hide'}
                    </Button>
                  ) : null; })()}
                  <div className="flex-1" />
                  <Button type="button" variant="ghost" size="sm" onClick={removeColumn} disabled={colBusy} className="text-red-600 dark:text-red-400 gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Delete column
                  </Button>
                </>
              )}
            </div>
          </form>
          <p className="mt-2 text-2xs text-slate-400 dark:text-slate-500">
            Type lives on the column. Changing it does not rewrite existing values; cells re-render with the new type&rsquo;s formatter.
          </p>
        </Card>
      )}

      {kanbanColumn ? (
        <KanbanView
          columns={visibleColumns}
          rows={rows}
          groupBy={kanbanColumn}
          formatCell={(c, v) => formatCell(c, v, linkLabels)}
          onMove={async (rowId, option) => { await writeCell(rowId, kanbanColumn, option ? [option] : null); }}
          onOpen={() => selectView(null)}
        />
      ) : (
      <Card padding="none" className="overflow-x-auto border border-slate-200 dark:border-slate-700">
        <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 min-w-max">
          <div className="w-12 shrink-0 px-3 py-2 text-xs font-medium text-slate-400 dark:text-slate-500 text-right border-r border-slate-200 dark:border-slate-700">
            #
          </div>
          {visibleColumns.map((col) => (
            <div
              key={col.id}
              className={`group relative flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-left border-r border-slate-200 dark:border-slate-700 min-w-[100px] ${col.is_hidden ? 'text-slate-400 dark:text-slate-500 italic' : 'text-slate-600 dark:text-slate-400'}`}
              style={{ width: colWidth(col) }}
              title={`${col.name} · ${TYPE_LABEL[col.type as ColumnType] ?? col.type}${col.is_hidden ? ' · hidden' : ''}${Array.isArray(col.config.visible_to) ? ` · visible to ${(col.config.visible_to as string[]).join(', ')}` : ''}`}
            >
              <button type="button" onClick={() => toggleSort(col.id)} className="flex-1 min-w-0 flex items-center gap-1 text-left hover:text-slate-900 dark:hover:text-slate-100" disabled={!serverQuery}>
                <span className="truncate">{col.name}</span>
                {sort?.column_id === col.id && (
                  sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />
                )}
              </button>
              <span className="text-2xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">{col.type === 'long_text' ? 'txt' : col.type.slice(0, 4)}</span>
              <button type="button" onClick={() => openEditColumn(col)} className="p-0.5 rounded-md opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" title="Column settings">
                <Settings2 className="w-3 h-3" />
              </button>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${col.name}`}
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary-400/60"
                onPointerDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startW = colWidth(col);
                  const onMove = (ev: PointerEvent) => {
                    const w = Math.max(80, Math.min(800, startW + (ev.clientX - startX)));
                    setColumns((prev) => prev.map((c) => (c.id === col.id ? { ...c, width: w } : c)));
                  };
                  const onUp = (ev: PointerEvent) => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    void resizeColumn({ ...col, width: startW }, startW + (ev.clientX - startX));
                  };
                  window.addEventListener('pointermove', onMove);
                  window.addEventListener('pointerup', onUp);
                }}
              />
            </div>
          ))}
          {columns.length === 0 && (
            <button type="button" onClick={openNewColumn} className="px-3 py-2 text-xs text-primary-600 dark:text-primary-400 hover:underline">
              + Add your first column
            </button>
          )}
          <div className="px-3 py-2 text-xs font-medium text-slate-400 dark:text-slate-500">
            &nbsp;
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {isEmptyQuery(query) ? <>No rows yet. Click &ldquo;Row&rdquo; to add one, or import a CSV.</> : 'No rows match these filters.'}
          </div>
        ) : (
          <div className="min-w-max">
            {rows.map((row, idx) => (
              <div
                key={row.id}
                className={`flex border-b border-slate-200 dark:border-slate-700 hover:bg-hover ${dragRow === row.id ? 'opacity-50' : ''} ${dropAt?.rowId === row.id ? (dropAt.edge === 'before' ? 'border-t-2 border-t-primary-500' : 'border-b-2 border-b-primary-500') : ''}`}
                onDragOver={(e) => {
                  if (!dragRow || !canReorder) return;
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setDropAt({ rowId: row.id, edge: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
                }}
                onDrop={(e) => { e.preventDefault(); if (dropAt) void handleDrop(dropAt.rowId, dropAt.edge); }}
              >
                <div
                  className={`w-12 shrink-0 px-2 py-1 text-xs text-slate-400 text-right border-r border-slate-200 dark:border-slate-700 select-none flex items-center justify-end gap-0.5 ${canReorder ? 'cursor-grab' : ''}`}
                  draggable={canReorder}
                  onDragStart={(e) => { if (!canReorder) return; e.dataTransfer.effectAllowed = 'move'; setDragRow(row.id); }}
                  onDragEnd={() => { setDragRow(null); setDropAt(null); }}
                  title={canReorder ? 'Drag to reorder' : 'Clear filters and sorts to reorder rows'}
                >
                  {canReorder && <GripVertical className="w-3 h-3 text-slate-300 dark:text-slate-600" />}
                  {idx + 1}
                </div>
                {visibleColumns.map((col) => {
                  const cellValue = row.cells[col.id];
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;
                  return (
                    <div
                      key={col.id}
                      className="px-3 py-1 min-w-[100px] border-r border-slate-200 dark:border-slate-700"
                      style={{ width: colWidth(col) }}
                      onPaste={(e) => handlePaste(e, row.id, col)}
                    >
                      {col.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(cellValue)}
                          disabled={savingCell}
                          onChange={(e) => writeCell(row.id, col, e.target.checked ? true : null)}
                          className="h-3.5 w-3.5 rounded-sm border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                          aria-label={col.name}
                        />
                      ) : isEditing ? (
                        renderEditor(col)
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => startEdit(row.id, col, cellValue, e.currentTarget)}
                          className={`w-full text-xs text-left rounded-md px-1 py-0.5 truncate block ${col.type === 'formula' ? 'text-slate-500 dark:text-slate-400 cursor-default' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
                          title={col.type === 'formula' ? `Formula: ${String(col.config.expression ?? '')}` : formatCell(col, cellValue, linkLabels)}
                          tabIndex={0}
                        >
                          {cellValue == null ? (
                            <span className="text-slate-300 dark:text-slate-600 italic">empty</span>
                          ) : col.type === 'url' ? (
                            <span className="text-primary-600 dark:text-primary-400 underline">{String(cellValue)}</span>
                          ) : col.type === 'link' || col.type === 'select' ? (
                            <span className="flex flex-wrap gap-1">
                              {(Array.isArray(cellValue) ? cellValue : [cellValue]).map((v, i) => (
                                <span key={i} className="rounded-md bg-slate-100 dark:bg-slate-700 px-1 text-2xs">{col.type === 'link' ? (linkLabels[String(v)] ?? String(v).slice(0, 8)) : String(v)}</span>
                              ))}
                            </span>
                          ) : (
                            <span className={NUMERIC_TYPES.has(col.type) || (col.type === 'formula' && typeof cellValue === 'number') ? 'block text-right tabular-nums' : ''}>{formatCell(col, cellValue, linkLabels)}</span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="px-3 py-1">
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(row.id)}
                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    title="Delete row"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rework D8: the grid loads the rest as it scrolls; no Load more button. */}
        <AutoLoad hasMore={hasMore} loading={loading} onLoad={loadMore} remaining={totalRows - rows.length} className="border-t border-slate-200 dark:border-slate-700" />

        {creatingRow && (
          <div className="p-3 border-t border-slate-200 dark:border-slate-700 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Adding row...
            </div>
          </div>
        )}
      </Card>
      )}

      {picker && (
        <RefPicker
          kind={picker.col.type as 'link' | 'user' | 'brand'}
          targetTableId={typeof picker.col.config.target_table_id === 'string' ? picker.col.config.target_table_id : undefined}
          selected={(() => {
            const v = rows.find((r) => r.id === picker.rowId)?.cells[picker.col.id];
            if (picker.col.type === 'link') return Array.isArray(v) ? v.map(String) : [];
            return v && typeof v === 'object' ? [String((v as { id?: unknown }).id ?? '')].filter(Boolean) : [];
          })()}
          labels={picker.col.type === 'link' ? linkLabels : (() => {
            const v = rows.find((r) => r.id === picker.rowId)?.cells[picker.col.id];
            return v && typeof v === 'object' ? { [String((v as { id?: unknown }).id ?? '')]: String((v as { name?: unknown }).name ?? '') } : {};
          })()}
          anchorRef={pickerAnchor}
          onCancel={() => setPicker(null)}
          onCommit={async (ids, labels) => {
            const { rowId, col } = picker;
            setPicker(null);
            if (col.type === 'link') {
              setLinkLabels((prev) => ({ ...prev, ...labels }));
              await writeCell(rowId, col, ids.length ? ids : null);
            } else {
              const id = ids[0];
              // Server re-resolves the name; optimistic value carries the picker label.
              await writeCell(rowId, col, id ? { id, name: labels[id] ?? '' } : null);
            }
          }}
        />
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Click any cell to edit. Enter saves, Tab moves to the next cell, Escape cancels. Paste a block from a spreadsheet into a cell to fill down and across. Click a column name to sort, the gear to rename, retype, hide, or delete it. Drag the row number to reorder (with no filters or sorts active).
      </p>
    </div>
  );
}
