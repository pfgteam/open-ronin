'use client';

import { useEffect, useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Link from 'next/link';
import { listAirtableTables, mirrorAirtableTable } from '../bases/actions';
import type { MirrorResult } from '../bases/actions';
import { Copy, RefreshCw, ExternalLink } from 'lucide-react';

interface Props {
  baseId: string;
  /** Pre-select one Airtable table (from /data/[baseId]/[tableId]). */
  tableId?: string;
  compact?: boolean;
}

/**
 * Phase 6 cutover tool: mirror an Airtable table into a native table through
 * the lib/data adapter. Shows which tables are already mirrored and lets a
 * manager refresh them.
 */
export default function MirrorPanel({ baseId, tableId, compact }: Props) {
  const [tables, setTables] = useState<Array<{ id: string; name: string; field_count: number; mirrored_table_id: string | null }>>([]);
  const [baseName, setBaseName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(MirrorResult & { name: string }) | null>(null);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    listAirtableTables(baseId).then((res) => {
      if (res.ok) {
        setTables(res.tables);
        setBaseName(res.base_name);
      } else {
        setError(res.error);
      }
    });
  }, [baseId]);

  const run = (t: { id: string; name: string; mirrored_table_id: string | null }) => {
    if (t.mirrored_table_id && !confirm(`Refresh the native mirror of "${t.name}"? Existing mirrored rows are replaced with the current Airtable records.`)) return;
    setError(null);
    setResult(null);
    setRunning(t.id);
    startTransition(async () => {
      const res = await mirrorAirtableTable(baseId, t.id);
      setRunning(null);
      if (res.ok) {
        setResult({ ...res.result, name: t.name });
        const refreshed = await listAirtableTables(baseId);
        if (refreshed.ok) setTables(refreshed.tables);
      } else {
        setError(res.error);
      }
    });
  };

  const shown = tableId ? tables.filter((t) => t.id === tableId) : tables;

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Mirror {baseName ? <strong>{baseName}</strong> : 'this base'} into native tables. Each run snapshots the Airtable records; links resolve to native rows when the linked table has been mirrored first (mirror the target table, then the one that links to it).
        </p>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {result && (
        <Callout tone="success">
          Mirrored <strong>{result.name}</strong>: {result.records_read} records read, {result.rows_created} rows and {result.cells_written} cells written, {result.columns_created} columns created
          {result.links_unresolved > 0 ? `, ${result.links_unresolved} link${result.links_unresolved === 1 ? '' : 's'} left unresolved (mirror the linked table and re-run)` : ''}.{' '}
          <Link href={`/data/base/${result.table_id}`} className="underline font-medium">Open native table</Link>
        </Callout>
      )}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        {shown.length === 0 && !error && <li className="px-3 py-2 text-xs text-slate-400">Loading tables…</li>}
        {shown.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-slate-900 dark:text-slate-100 truncate">{t.name}</p>
              <p className="text-2xs text-slate-400">
                {t.field_count} fields · <code className="font-mono">{t.id}</code>
                {t.mirrored_table_id && <> · mirrored</>}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {t.mirrored_table_id && (
                <Link href={`/data/base/${t.mirrored_table_id}`} className="inline-flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Native
                </Link>
              )}
              <Button
                variant={t.mirrored_table_id ? 'ghost' : 'outline'}
                size="sm"
                onClick={() => run(t)}
                disabled={pending}
                className="gap-1"
                title={t.mirrored_table_id ? 'Refresh the native mirror from Airtable' : 'Create a native table from this Airtable table'}
              >
                {running === t.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t.mirrored_table_id ? <RefreshCw className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {running === t.id ? 'Mirroring…' : t.mirrored_table_id ? 'Refresh' : 'Mirror'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
