'use client';

import { useState } from 'react';
import type { GridRow, GridColumnInfo } from '../../bases/actions';

interface Props {
  columns: GridColumnInfo[];
  rows: GridRow[];
  groupBy: GridColumnInfo;
  formatCell: (col: GridColumnInfo, v: unknown) => string;
  /** Move a row to a lane: writes the select cell. */
  onMove: (rowId: string, option: string | null) => Promise<void>;
  onOpen: (rowId: string) => void;
}

const UNGROUPED = '__none__';

/** Kanban-by-select (phase 5): one lane per option of the group-by column, drag cards between lanes to change the value. */
export default function KanbanView({ columns, rows, groupBy, formatCell, onMove, onOpen }: Props) {
  const options = Array.isArray(groupBy.config.options) ? (groupBy.config.options as unknown[]).map(String) : [];
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cardCols = columns.filter((c) => c.id !== groupBy.id).slice(0, 4);

  const laneOf = (r: GridRow): string => {
    const v = r.cells[groupBy.id];
    const first = Array.isArray(v) ? v[0] : v;
    return first == null || first === '' ? UNGROUPED : String(first);
  };
  const lanes = [...options, UNGROUPED];
  const byLane = new Map<string, GridRow[]>(lanes.map((l) => [l, []]));
  for (const r of rows) {
    const l = laneOf(r);
    if (!byLane.has(l)) byLane.set(l, []);
    byLane.get(l)!.push(r);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {[...byLane.keys()].map((lane) => (
        <div
          key={lane}
          onDragOver={(e) => { e.preventDefault(); setOver(lane); }}
          onDragLeave={() => setOver((o) => (o === lane ? null : o))}
          onDrop={async (e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/nt-row') || dragging;
            setOver(null);
            setDragging(null);
            if (id) await onMove(id, lane === UNGROUPED ? null : lane);
          }}
          className={`w-64 shrink-0 rounded-lg border ${over === lane ? 'border-primary-400 bg-primary-50/40 dark:bg-primary-950/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'} p-2`}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{lane === UNGROUPED ? 'No value' : lane}</span>
            <span className="text-2xs text-slate-400">{byLane.get(lane)!.length}</span>
          </div>
          <div className="space-y-2 min-h-[2rem]">
            {byLane.get(lane)!.map((r) => (
              <div
                key={r.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/nt-row', r.id); setDragging(r.id); }}
                onDragEnd={() => setDragging(null)}
                onDoubleClick={() => onOpen(r.id)}
                className={`rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs cursor-grab ${dragging === r.id ? 'opacity-50' : ''}`}
                title="Drag to another lane; double-click to open in the grid"
              >
                {cardCols.map((c, i) => {
                  const text = formatCell(c, r.cells[c.id]);
                  if (!text && i > 0) return null;
                  return (
                    <p key={c.id} className={i === 0 ? 'font-medium text-slate-900 dark:text-slate-100 truncate' : 'text-slate-500 dark:text-slate-400 truncate'}>
                      {i > 0 && <span className="text-slate-400 dark:text-slate-500">{c.name}: </span>}
                      {text || <span className="italic text-slate-300 dark:text-slate-600">empty</span>}
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
