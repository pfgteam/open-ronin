'use client';

// Bulk bar (rework 5.2, D8): acts on the WHOLE selection, which can be every
// row in the filtered set. Large selections go to the server in batches of
// BATCH with a progress readout, and one Undo puts every row back. The
// server refuses an oversize call instead of silently trimming it, so a
// success message always matches what was written (phase 0).

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Archive, ArchiveRestore, CalendarClock, CircleDot, Shapes, Trash2, User, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Popover from '@/components/ui/Popover';
import Input from '@/components/ui/Input';
import { controlFocus } from '@/components/ui/focus';
import { statusesFor } from '@/lib/work/boards/groups';
import type { BoardContext } from '@/lib/work/boards/types';
import { statusTone, TONE_DOT } from '@/lib/work/hub/rows';
import { Avatar } from '@/components/board/cells';

export const BATCH = 400;

/** Run fn over ids in batches; returns how many succeeded and the first error. */
export async function runBatches<T extends { ok: boolean; error?: string }>(
	ids: string[], fn: (chunk: string[]) => Promise<T>, onProgress?: (done: number, total: number) => void,
): Promise<{ done: number; error: string | null; results: T[] }> {
	let done = 0;
	const results: T[] = [];
	for (let i = 0; i < ids.length; i += BATCH) {
		const chunk = ids.slice(i, i + BATCH);
		const res = await fn(chunk);
		results.push(res);
		if (!res.ok) return { done, error: res.error ?? 'Something went wrong.', results };
		done += chunk.length;
		onProgress?.(done, ids.length);
	}
	return { done, error: null, results };
}

export default function BulkBar({ count, noun, plural, ctx, kinds, mode, progress, onStatus, onOwner, onDue, onArchive, onRestore, onDelete, onType, onClear }: {
	count: number;
	noun: string;
	plural: string;
	ctx: BoardContext;
	/** Kinds present in the selection; Status shows only when they share one status set. */
	kinds: string[];
	mode: 'live' | 'archived';
	progress: { done: number; total: number } | null;
	onStatus: (slug: string, label: string) => void;
	onOwner: (id: string | null) => void;
	onDue: (date: string | null) => void;
	onArchive: () => void;
	onRestore: () => void;
	onDelete: () => void;
	onType?: () => void;
	onClear: () => void;
}) {
	const statusRef = useRef<HTMLButtonElement>(null);
	const ownerRef = useRef<HTMLButtonElement>(null);
	const dueRef = useRef<HTMLButtonElement>(null);
	const [menu, setMenu] = useState<'status' | 'owner' | 'due' | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [q, setQ] = useState('');
	const [due, setDue] = useState('');
	const people = Object.entries(ctx.people).filter(([, p]) => !q || p.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a[1].name.localeCompare(b[1].name));
	const busy = !!progress && progress.done < progress.total;
	const label = `${count.toLocaleString()} ${count === 1 ? noun : plural} selected`;
	return (
		<div role="toolbar" aria-label="Bulk actions" className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white py-1.5 pl-1.5 pr-2 shadow-panel dark:border-slate-700 dark:bg-slate-800">
			<span className="flex h-8 items-center rounded-md bg-primary-700 px-3 text-sm font-bold tabular-nums text-white">{count.toLocaleString()}</span>
			<span className="whitespace-nowrap px-2 text-sm text-slate-700 dark:text-slate-200" aria-live="polite">
				{busy ? `Working… ${progress!.done.toLocaleString()} of ${progress!.total.toLocaleString()}` : label}
			</span>
			{busy && (
				<span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden="true">
					<span className="block h-full bg-primary-600 transition-all" style={{ width: `${Math.round((progress!.done / progress!.total) * 100)}%` }} />
				</span>
			)}
			{mode === 'live' ? (
				<>
					{new Set(kinds).size === 1 && <Button ref={statusRef} size="sm" variant="ghost" disabled={busy} onClick={() => setMenu('status')}><CircleDot className="h-4 w-4" aria-hidden="true" />Status</Button>}
					<Button ref={ownerRef} size="sm" variant="ghost" disabled={busy} onClick={() => setMenu('owner')}><User className="h-4 w-4" aria-hidden="true" />Owner</Button>
					<Button ref={dueRef} size="sm" variant="ghost" disabled={busy} onClick={() => setMenu('due')}><CalendarClock className="h-4 w-4" aria-hidden="true" />Due</Button>
					{onType && <Button size="sm" variant="ghost" disabled={busy} onClick={onType}><Shapes className="h-4 w-4" aria-hidden="true" />Type</Button>}
					<Button size="sm" variant="ghost" disabled={busy} onClick={onArchive} className="text-red-700 dark:text-red-400"><Archive className="h-4 w-4" aria-hidden="true" />Archive</Button>
				</>
			) : confirmDelete ? (
				<span className="flex items-center gap-1 whitespace-nowrap text-sm">
					Delete {count.toLocaleString()} for good? This cannot be undone.
					<Button size="sm" variant="danger" onClick={() => { setConfirmDelete(false); onDelete(); }}>Yes, delete</Button>
					<Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
				</span>
			) : (
				<>
					<Button size="sm" variant="ghost" disabled={busy} onClick={onRestore}><ArchiveRestore className="h-4 w-4" aria-hidden="true" />Restore</Button>
					<Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)} className="text-red-700 dark:text-red-400"><Trash2 className="h-4 w-4" aria-hidden="true" />Delete permanently</Button>
				</>
			)}
			<IconButton aria-label="Clear selection" size="sm" onClick={onClear} disabled={busy}><X className="h-4 w-4" aria-hidden="true" /></IconButton>

			<Popover open={menu === 'status'} onClose={() => setMenu(null)} anchorRef={statusRef} width="w-56">
				<div className="p-1.5" role="menu" aria-label="Set status">
					{statusesFor(ctx, kinds[0] ?? '').map((s) => (
						<button key={s.slug} type="button" role="menuitem" onClick={() => { setMenu(null); onStatus(s.slug, s.label); }}
							className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
							<span className={clsx('h-2 w-2 rounded-full', TONE_DOT[statusTone(s)])} aria-hidden="true" />{s.label}
						</button>
					))}
				</div>
			</Popover>
			<Popover open={menu === 'owner'} onClose={() => setMenu(null)} anchorRef={ownerRef} width="w-64">
				<div className="p-2">
					<Input aria-label="Search people" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
					<div className="mt-1 max-h-64 overflow-y-auto" role="menu" aria-label="Set owner">
						<button type="button" role="menuitem" onClick={() => { setMenu(null); onOwner(null); }} className={clsx('w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-hover dark:text-slate-300', controlFocus)}>Unassigned</button>
						{people.map(([id, person]) => (
							<button key={id} type="button" role="menuitem" onClick={() => { setMenu(null); setQ(''); onOwner(id); }}
								className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
								<Avatar id={id} ctx={ctx} size={22} />{person.name}
							</button>
						))}
					</div>
				</div>
			</Popover>
			<Popover open={menu === 'due'} onClose={() => setMenu(null)} anchorRef={dueRef} width="w-60">
				<form className="space-y-2 p-3" onSubmit={(e) => { e.preventDefault(); setMenu(null); onDue(due || null); }}>
					<Input type="date" label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
					<div className="flex justify-between gap-2">
						<Button size="sm" variant="ghost" onClick={() => { setMenu(null); onDue(null); }}>Clear due date</Button>
						<Button size="sm" type="submit" disabled={!due}>Set</Button>
					</div>
				</form>
			</Popover>
		</div>
	);
}
