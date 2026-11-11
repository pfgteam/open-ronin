'use client';

import { useEffect, useState, useTransition } from 'react';
import Card from '@/components/ui/Card';
import { listTables, createTable, updateTable, deleteTable } from './actions';
import Link from 'next/link';
import { Plus, Table2, Database, Pencil, Trash2 } from 'lucide-react';

interface TableInfo {
  id: string;
  name: string;
  description: string | null;
  row_count: number;
  column_count: number;
  created_at: string;
}

export default function BasesPage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    listTables().then((res) => {
      if (res.ok) setTables(res.tables);
      else setError(res.error);
    });
  }, []);

  async function refresh() {
    const res = await listTables();
    if (res.ok) setTables(res.tables);
    else setError(res.error);
  }

  function handleRename(t: TableInfo) {
    const next = prompt('Rename table', t.name);
    if (next == null) return;
    const n = next.trim();
    if (!n || n === t.name) return;
    setError(null);
    startTransition(async () => {
      const res = await updateTable(t.id, { name: n });
      if (res.ok) await refresh();
      else setError(res.error);
    });
  }

  function handleDelete(t: TableInfo) {
    if (!confirm(`Delete "${t.name}" and all ${t.row_count} rows? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteTable(t.id);
      if (res.ok) await refresh();
      else setError(res.error);
    });
  }

  async function handleCreate() {
    const n = name.trim();
    if (!n) return;
    setError(null);
    startTransition(async () => {
      const res = await createTable({ name: n });
      if (res.ok) {
        setName('');
        const refreshed = await listTables();
        if (refreshed.ok) setTables(refreshed.tables);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">New table</h2>
        <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="flex items-center gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Table name"
            className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={!name.trim() || pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? 'Creating...' : <><Plus className="w-4 h-4" /> Create</>}
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </Card>

      {tables.length === 0 ? (
        <Card className="mb-6">
          <div className="flex items-center gap-3 p-6 text-center">
            <Database className="w-5 h-5 text-slate-300 dark:text-slate-600" />
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No tables yet</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Create a table above to get started. Each table is a spreadsheet with typed columns, rows, and cell editing.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{tables.length} table{tables.length !== 1 ? 's' : ''}</p>
          <div className="space-y-2">
            {tables.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors group"
              >
                <Link href={`/data/base/${t.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                  <Table2 className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.row_count} rows · {t.column_count} columns</p>
                  </div>
                </Link>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button type="button" onClick={() => handleRename(t)} disabled={pending} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/50" title="Rename">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => handleDelete(t)} disabled={pending} className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30" title="Delete table">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <Link href={`/data/base/${t.id}`} className="ml-1 text-xs text-primary-600 hover:underline">Open</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
