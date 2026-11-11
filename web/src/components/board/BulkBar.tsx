'use client';

// The old board screen (with its Load more button) was retired by The Work
// rework: hub tabs and custom boards render on components/work/hub. Only the
// small bulk bar the My work queue (MyWorkView) still uses lives on here.

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Archive, ArchiveRestore, CircleDot, Trash2, User, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Popover from '@/components/ui/Popover';
import { controlFocus } from '@/components/ui/focus';
import { statusesFor } from '@/lib/work/boards/groups';
import { statusTone, TONE_DOT } from '@/lib/work/hub/rows';
import type { BoardContext } from '@/lib/work/boards/types';
import { Avatar } from './cells';

const bulkBtn = clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700', controlFocus);

export function BulkBar({ count, itemLabel, ctx, kind, kinds, mode, onStatus, onOwner, onArchive, onRestore, onDelete, onClear }: {
	count: number; itemLabel: string; ctx: BoardContext; kind: string;
	/** Kinds in the selection; when they differ the statuses differ too, so Status is hidden. */
	kinds?: string[]; mode: 'live' | 'archived';
	onStatus: (slug: string, label: string) => void; onOwner: (id: string) => void; onArchive: () => void; onRestore: () => void; onDelete: () => void; onClear: () => void;
}) {
	const statusRef = useRef<HTMLButtonElement>(null);
	const ownerRef = useRef<HTMLButtonElement>(null);
	const [openMenu, setOpenMenu] = useState<'status' | 'owner' | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const people = Object.entries(ctx.people).sort((a, b) => a[1].name.localeCompare(b[1].name));
	return (
		<div role="toolbar" aria-label="Bulk actions" className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 flex items-center gap-1 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pr-2 shadow-panel">
			<span className="self-stretch bg-primary-700 px-4 flex items-center text-base font-bold text-white tabular-nums">{count}</span>
			<span className="px-2 text-sm text-slate-700 dark:text-slate-200">{count === 1 ? `${itemLabel} selected` : `${itemLabel}s selected`}</span>
			{mode === 'live' ? (
				<>
					{new Set(kinds ?? [kind]).size <= 1 && <button ref={statusRef} type="button" onClick={() => setOpenMenu('status')} className={bulkBtn}><CircleDot className="w-4 h-4" aria-hidden="true" />Status</button>}
					<button ref={ownerRef} type="button" onClick={() => setOpenMenu('owner')} className={bulkBtn}><User className="w-4 h-4" aria-hidden="true" />Owner</button>
					{/* Archive is reversible (Undo toast + the Archived view), so no confirm step. */}
					<Button variant="ghost" size="sm" onClick={onArchive} className="text-red-600 dark:text-red-400"><Archive className="w-4 h-4" aria-hidden="true" />Archive</Button>
				</>
			) : confirmDelete ? (
				<span className="flex items-center gap-1 text-sm">
					Delete {count} for good? This cannot be undone.
					<Button variant="ghost" size="sm" onClick={() => { setConfirmDelete(false); onDelete(); }} className="text-red-600">Yes, delete</Button>
					<Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
				</span>
			) : (
				<>
					<Button variant="ghost" size="sm" onClick={onRestore}><ArchiveRestore className="w-4 h-4" aria-hidden="true" />Restore</Button>
					<Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-red-600 dark:text-red-400"><Trash2 className="w-4 h-4" aria-hidden="true" />Delete permanently</Button>
				</>
			)}
			<button type="button" onClick={onClear} aria-label="Clear selection" className={clsx('ml-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><X className="w-4 h-4" aria-hidden="true" /></button>

			<Popover open={openMenu === 'status'} onClose={() => setOpenMenu(null)} anchorRef={statusRef} width="w-56">
				<div className="p-2 space-y-1">
					{statusesFor(ctx, kind).map((s) => (
						<button key={s.slug} type="button" onClick={() => { setOpenMenu(null); onStatus(s.slug, s.label); }}
							className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
							<span className={clsx('h-2 w-2 rounded-full', TONE_DOT[statusTone(s)])} aria-hidden="true" />{s.label}
						</button>
					))}
				</div>
			</Popover>
			<Popover open={openMenu === 'owner'} onClose={() => setOpenMenu(null)} anchorRef={ownerRef} width="w-60">
				<div className="p-1.5 max-h-72 overflow-y-auto">
					{people.map(([id, person]) => (
						<button key={id} type="button" onClick={() => { setOpenMenu(null); onOwner(id); }}
							className={clsx('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
							<Avatar id={id} ctx={ctx} size={22} />{person.name}
						</button>
					))}
				</div>
			</Popover>
		</div>
	);
}
