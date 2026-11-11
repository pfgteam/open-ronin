'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Plus, X, Filter } from 'lucide-react';
import { OPS_BY_TYPE, OP_LABEL, UNARY_OPS } from '@/lib/native-tables/query';
import type { GridQuery, FilterClause, FilterOp } from '@/lib/native-tables/query';
import type { ColumnType } from '@/lib/native-tables/values';

interface Col { id: string; name: string; type: ColumnType; config: Record<string, unknown> }

interface Props {
  columns: Col[];
  query: GridQuery;
  onChange: (q: GridQuery) => void;
  disabled?: boolean;
}

const fieldClass = 'rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400';

/** Filter builder over the per-type operator whitelist (query.ts). Draft edits apply on blur / Apply. */
export default function FilterBar({ columns, query, onChange, disabled }: Props) {
  const [open, setOpen] = useState(query.filters.length > 0);
  const filterable = columns.filter((c) => c.type !== 'formula');

  const setFilter = (i: number, patch: Partial<FilterClause>) => {
    const next = query.filters.map((f, k) => (k === i ? { ...f, ...patch } : f));
    onChange({ ...query, filters: next });
  };
  const addFilter = () => {
    const col = filterable[0];
    if (!col) return;
    const op = OPS_BY_TYPE[col.type][0];
    onChange({ ...query, filters: [...query.filters, { column_id: col.id, op, value: UNARY_OPS.has(op) ? undefined : '' }] });
    setOpen(true);
  };
  const removeFilter = (i: number) => onChange({ ...query, filters: query.filters.filter((_, k) => k !== i) });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} className="gap-1.5" disabled={disabled}>
          <Filter className="w-3.5 h-3.5" /> Filter{query.filters.length > 0 ? ` (${query.filters.length})` : ''}
        </Button>
        {query.filters.length > 0 && (
          <button type="button" onClick={() => onChange({ ...query, filters: [] })} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline" disabled={disabled}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2 space-y-2">
          {query.filters.length > 1 && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              Match
              <select value={query.conjunction} onChange={(e) => onChange({ ...query, conjunction: e.target.value === 'or' ? 'or' : 'and' })} className={fieldClass} disabled={disabled} aria-label="Filter conjunction">
                <option value="and">all</option>
                <option value="or">any</option>
              </select>
              of these
            </div>
          )}
          {query.filters.map((f, i) => {
            const col = columns.find((c) => c.id === f.column_id);
            const ops = col ? OPS_BY_TYPE[col.type] : [];
            const unary = UNARY_OPS.has(f.op);
            const options = col?.type === 'select' && Array.isArray(col.config.options) ? (col.config.options as unknown[]).map(String) : null;
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={f.column_id}
                  onChange={(e) => {
                    const nc = columns.find((c) => c.id === e.target.value);
                    const nop = nc ? OPS_BY_TYPE[nc.type][0] : f.op;
                    setFilter(i, { column_id: e.target.value, op: nop, value: UNARY_OPS.has(nop) ? undefined : '' });
                  }}
                  className={fieldClass}
                  disabled={disabled}
                  aria-label="Filter column"
                >
                  {filterable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select
                  value={f.op}
                  onChange={(e) => {
                    const op = e.target.value as FilterOp;
                    setFilter(i, { op, value: UNARY_OPS.has(op) ? undefined : (f.value ?? '') });
                  }}
                  className={fieldClass}
                  disabled={disabled}
                  aria-label="Filter operator"
                >
                  {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                </select>
                {!unary && (f.op === 'has_any' && options ? (
                  <select
                    multiple
                    value={Array.isArray(f.value) ? f.value : []}
                    onChange={(e) => setFilter(i, { value: Array.from(e.target.selectedOptions).map((o) => o.value) })}
                    className={`${fieldClass} min-w-[8rem]`}
                    disabled={disabled}
                    aria-label="Filter options"
                  >
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={col?.type === 'datetime' ? 'date' : ['number', 'currency', 'percent', 'rating', 'duration'].includes(col?.type ?? '') ? 'number' : 'text'}
                    value={Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '')}
                    onChange={(e) => setFilter(i, { value: e.target.value })}
                    placeholder="Value"
                    className={`${fieldClass} w-40`}
                    disabled={disabled}
                    aria-label="Filter value"
                  />
                ))}
                <button type="button" onClick={() => removeFilter(i)} className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-md" title="Remove filter" disabled={disabled}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={addFilter} className="gap-1" disabled={disabled || filterable.length === 0}>
              <Plus className="w-3.5 h-3.5" /> Add filter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
