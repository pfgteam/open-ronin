'use client';

import { useEffect, useRef, useState } from 'react';
import Popover from '@/components/ui/Popover';
import { searchLinkTargets, searchUsers, searchBrands } from '../../bases/actions';
import type { PickerOption } from '../../bases/actions';
import { X, Check } from 'lucide-react';

type Kind = 'link' | 'user' | 'brand';

interface Props {
  kind: Kind;
  /** Link columns: the target native table. */
  targetTableId?: string;
  /** Currently selected ids (link: many; user/brand: at most one). */
  selected: string[];
  labels: Record<string, string>;
  onCommit: (ids: string[], labels: Record<string, string>) => void;
  onCancel: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

/** Search-and-pick popover for reference cells (phase 4). Link columns allow many; user/brand allow one. */
export default function RefPicker({ kind, targetTableId, selected, labels, onCommit, onCancel, anchorRef }: Props) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [chosen, setChosen] = useState<string[]>(selected);
  const [known, setKnown] = useState<Record<string, string>>(labels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const multi = kind === 'link';

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const res = kind === 'link'
        ? (targetTableId ? await searchLinkTargets(targetTableId, q) : { ok: false as const, error: 'Link column has no target table.' })
        : kind === 'user' ? await searchUsers(q) : await searchBrands(q);
      setLoading(false);
      if (res.ok) {
        setOptions(res.options);
        setKnown((k) => ({ ...k, ...Object.fromEntries(res.options.map((o) => [o.id, o.label])) }));
      } else {
        setError(res.error);
      }
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, kind, targetTableId]);

  const toggle = (id: string) => {
    if (multi) setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    else onCommit([id], known);
  };

  return (
    <Popover open onClose={onCancel} anchorRef={anchorRef}>
      <div className="w-72 space-y-2">
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === 'link' ? 'Search rows' : kind === 'user' ? 'Search people' : 'Search brands'}
          className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
          aria-label="Search"
        />
        {multi && chosen.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chosen.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-md bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 text-2xs">
                {known[id] ?? id.slice(0, 8)}
                <button type="button" onClick={() => toggle(id)} className="hover:text-red-600" title="Remove"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-2xs text-red-600 dark:text-red-400">{error}</p>}
        <ul className="max-h-56 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700 rounded-md border border-slate-200 dark:border-slate-700">
          {loading && options.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-400">Loading…</li>}
          {!loading && options.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-400">No matches.</li>}
          {options.map((o) => {
            const on = chosen.includes(o.id);
            return (
              <li key={o.id}>
                <button type="button" onClick={() => toggle(o.id)} className={`w-full flex items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-700/50 ${on ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-200'}`}>
                  <span className="truncate">
                    {o.label}
                    {o.hint && <span className="ml-1 text-slate-400">{o.hint}</span>}
                  </span>
                  {on && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => onCommit([], known)} className="text-2xs text-slate-500 hover:text-red-600 dark:hover:text-red-400 underline">Clear</button>
          {multi && (
            <button type="button" onClick={() => onCommit(chosen, known)} className="rounded-md bg-primary-600 hover:bg-primary-700 text-white px-2.5 py-1 text-xs">Done</button>
          )}
        </div>
      </div>
    </Popover>
  );
}
