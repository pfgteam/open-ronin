'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { LayoutGrid, Kanban, Save, Trash2, Link2, Check } from 'lucide-react';
import type { ViewInfo } from '../../bases/actions';

interface Props {
  views: ViewInfo[];
  available: boolean;
  activeViewId: string | null;
  dirty: boolean;
  onSelect: (view: ViewInfo | null) => void;
  onSave: (name: string, kind: 'grid' | 'kanban', groupBy: string | null, asNew: boolean) => Promise<void>;
  onDelete: (view: ViewInfo) => Promise<void>;
  selectColumns: Array<{ id: string; name: string }>;
  busy: boolean;
}

/** Saved views tab strip (phase 5) with save / save-as / delete / copy-link. */
export default function ViewsBar({ views, available, activeViewId, dirty, onSelect, onSave, onDelete, selectColumns, busy }: Props) {
  const active = views.find((v) => v.id === activeViewId) ?? null;
  const [saving, setSaving] = useState<'new' | 'update' | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'grid' | 'kanban'>('grid');
  const [groupBy, setGroupBy] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const openSave = (mode: 'new' | 'update') => {
    setSaving(mode);
    setName(mode === 'update' && active ? active.name : '');
    setKind(mode === 'update' && active ? active.kind : 'grid');
    setGroupBy(mode === 'update' && active?.group_by_column_id ? active.group_by_column_id : (selectColumns[0]?.id ?? ''));
  };

  const submit = async () => {
    if (!name.trim()) return;
    await onSave(name.trim(), kind, kind === 'kanban' ? groupBy || null : null, saving === 'new');
    setSaving(null);
  };

  const copyLink = async () => {
    if (!active) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', active.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this view link', url.toString());
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${activeViewId === null ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
        >
          <LayoutGrid className="w-3.5 h-3.5" /> All rows
        </button>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${v.id === activeViewId ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}
            title={v.kind === 'kanban' ? 'Kanban view' : 'Grid view'}
          >
            {v.kind === 'kanban' ? <Kanban className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            {v.name}
            {v.id === activeViewId && dirty && <span className="text-amber-600 dark:text-amber-400" title="Unsaved changes">•</span>}
          </button>
        ))}
        <div className="flex-1" />
        {available ? (
          <>
            {active && (
              <>
                <Button variant="ghost" size="sm" onClick={copyLink} className="gap-1" title="Copy a link to this view">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Link'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openSave('update')} disabled={busy} className="gap-1" title="Save changes to this view">
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete view "${active.name}"?`)) void onDelete(active); }} disabled={busy} className="gap-1 text-red-600 dark:text-red-400" title="Delete this view">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => openSave('new')} disabled={busy} className="gap-1">
              <Save className="w-3.5 h-3.5" /> Save as view
            </Button>
          </>
        ) : (
          <span className="text-2xs text-slate-400 dark:text-slate-500">Saved views arrive with migration 0109.</span>
        )}
      </div>
      {saving && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-wrap items-end gap-2 rounded-md border border-primary-200 dark:border-primary-800 bg-white dark:bg-slate-800 p-2">
          <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">
            View name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400" placeholder="Open items" />
          </label>
          <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">
            Layout
            <select value={kind} onChange={(e) => setKind(e.target.value === 'kanban' ? 'kanban' : 'grid')} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs">
              <option value="grid">Grid</option>
              <option value="kanban" disabled={selectColumns.length === 0}>Kanban (by select column)</option>
            </select>
          </label>
          {kind === 'kanban' && (
            <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">
              Group by
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs">
                {selectColumns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <Button type="submit" size="sm" disabled={!name.trim() || busy}>{saving === 'new' ? 'Create view' : 'Update view'}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSaving(null)}>Cancel</Button>
          <p className="basis-full text-2xs text-slate-400 dark:text-slate-500">Saves the current filters, sorts, search and hidden columns. Anyone with Data access can open the link.</p>
        </form>
      )}
    </div>
  );
}
