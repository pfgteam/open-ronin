'use client';

// Intake door ② (spec §7): the short "+ New" modal. Five fields; everything
// else is edited in the table or the item panel. Enter creates, Shift+Enter
// creates and opens the panel. Replaces /the-work/planning as the way in.

import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Popover from '@/components/ui/Popover';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
import { controlFocus } from '@/components/ui/focus';
import { PARENT_KIND_FOR } from '@/app/(app)/the-work/hierarchy';
import { KIND_LABELS } from '@/lib/work/boards/groups';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { createItem, searchParents } from '@/app/(app)/the-work/b/actions';
import ClientSelect from '@/components/work/ClientSelect';

export interface NewItemModalProps {
	open: boolean;
	onClose: () => void;
	kinds: string[];
	ctx: BoardContext;
	viewerId?: string;
	boardName: string;
	defaults: { quarter_id: string | null; department_tag_id: string | null; client_id: string | null; parent_id?: string | null; status?: string | null };
	onCreated: (row: WorkRow, openIt: boolean) => void;
}

export default function NewItemModal(p: NewItemModalProps) {
	const [name, setName] = useState('');
	const [kind, setKind] = useState(p.kinds[0]);
	const [parentId, setParentId] = useState<string>('');
	const [parentQuery, setParentQuery] = useState('');
	const [parents, setParents] = useState<{ id: string; name: string }[]>([]);
	const [owner, setOwner] = useState(p.viewerId ?? '');
	const [due, setDue] = useState('');
	const [clientId, setClientId] = useState(p.defaults.client_id ?? '');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const nameRef = useRef<HTMLInputElement>(null);
	// The parent list (goals above a priority, priorities above a project…) is a
	// dropdown: closed until clicked, so the modal stays five short fields.
	const parentBtnRef = useRef<HTMLButtonElement>(null);
	const parentSearchRef = useRef<HTMLInputElement>(null);
	const [parentOpen, setParentOpen] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef, p.open, { autoFocus: false }); // the name field takes focus on open
	const parentKind = PARENT_KIND_FOR[kind];

	useEffect(() => {
		if (!p.open) return;
		setName(''); setError(null); setDue(''); setKind(p.kinds[0]); setOwner(p.viewerId ?? ''); setClientId(p.defaults.client_id ?? '');
		setParentId(p.defaults.parent_id ?? '');
		setParentQuery(''); setParentOpen(false);
		setTimeout(() => nameRef.current?.focus(), 30);
	}, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => { if (parentOpen) setTimeout(() => parentSearchRef.current?.focus(), 20); }, [parentOpen]);

	// Parent search: only the one kind this kind may hang under.
	useEffect(() => {
		if (!p.open || !parentKind) { setParents([]); return; }
		let cancelled = false;
		const t = setTimeout(async () => {
			const res = await searchParents(parentKind, parentQuery);
			if (!cancelled && res.ok) setParents(res.data);
		}, 200);
		return () => { cancelled = true; clearTimeout(t); };
	}, [p.open, parentKind, parentQuery]);

	const parentLabel = useMemo(() => {
		if (!parentId) return null;
		return parents.find((x) => x.id === parentId)?.name ?? p.ctx.parents[parentId]?.name ?? null;
	}, [parentId, parents, p.ctx.parents]);

	const submit = async (openIt: boolean) => {
		if (!name.trim()) { setError(`Give the ${(KIND_LABELS[kind] ?? kind).toLowerCase()} a name.`); nameRef.current?.focus(); return; }
		setBusy(true);
		const res = await createItem({
			name: name.trim(),
			kind,
			parent_id: parentKind && parentId ? parentId : undefined,
			owner_id: owner || null,
			ends_at: due || undefined,
			status: p.defaults.status ?? undefined,
			quarter_id: p.defaults.quarter_id ?? undefined,
			department_tag_id: p.defaults.department_tag_id ?? undefined,
			client_id: clientId || undefined,
		});
		setBusy(false);
		if (!res.ok) { setError(res.error); return; }
		p.onCreated(res.data, openIt);
		p.onClose();
	};

	if (!p.open) return null;
	const label = KIND_LABELS[kind] ?? kind;
	const people = Object.entries(p.ctx.people).sort((a, b) => a[1].name.localeCompare(b[1].name));

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-10">
			<div className="fixed inset-0 bg-slate-900/40" onClick={p.onClose} aria-hidden="true" />
			<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-item-title"
				onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } }}
				className="relative w-full max-w-lg rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-panel">
				<div className="mb-3 flex items-center">
					<h2 id="new-item-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">New {label.toLowerCase()}</h2>
					<button type="button" onClick={p.onClose} aria-label="Close" className={clsx('ml-auto rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><X className="w-4 h-4" aria-hidden="true" /></button>
				</div>
			<form onSubmit={(e) => { e.preventDefault(); void submit(false); }} className="space-y-4">
				<p className="-mt-2 text-xs text-slate-500">In {p.boardName}. Quarter and department come from the board.</p>
				<Input
					ref={nameRef}
					label="Name"
					value={name}
					onChange={(e) => { setName(e.target.value); setError(null); }}
					onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); void submit(true); } }}
					placeholder={`${label} name`}
					error={error ?? undefined}
					autoComplete="off"
				/>
				{p.kinds.length > 1 && (
					<div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-1.5">
						{p.kinds.map((k) => (
							<button key={k} type="button" role="radio" aria-checked={k === kind} onClick={() => { setKind(k); setParentId(''); }}
								className={clsx('rounded-full border px-3 py-1 text-sm', controlFocus, k === kind ? 'border-primary-600 bg-primary-50 text-primary-800 font-semibold dark:bg-primary-950 dark:text-primary-300' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300')}>
								{KIND_LABELS[k] ?? k}
							</button>
						))}
					</div>
				)}
				{parentKind && (
					<div>
						<span id="new-parent-label" className="text-sm font-medium text-slate-700 dark:text-slate-300">{KIND_LABELS[parentKind] ?? parentKind} <span className="font-normal text-slate-500">(optional)</span></span>
						<button ref={parentBtnRef} type="button" aria-haspopup="listbox" aria-expanded={parentOpen} aria-labelledby="new-parent-label"
							onClick={() => setParentOpen(true)}
							className={clsx('mt-1 flex w-full items-center gap-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-left text-sm', controlFocus)}>
							<span className={clsx('min-w-0 flex-1 truncate', !parentLabel && 'text-slate-500')}>{parentLabel ?? `No ${(KIND_LABELS[parentKind] ?? parentKind).toLowerCase()}`}</span>
							<ChevronDown className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
						</button>
						<Popover open={parentOpen} onClose={() => setParentOpen(false)} anchorRef={parentBtnRef} width="w-[28rem]">
							<div className="p-2">
								<input ref={parentSearchRef} value={parentQuery} onChange={(e) => setParentQuery(e.target.value)} placeholder={`Search ${(KIND_LABELS[parentKind] ?? parentKind).toLowerCase()}s`}
									aria-label={`Search ${(KIND_LABELS[parentKind] ?? parentKind).toLowerCase()}s`}
									onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setParentOpen(false); } }}
									className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500" />
								<div role="listbox" aria-labelledby="new-parent-label" className="mt-1 max-h-56 overflow-y-auto">
									<button type="button" role="option" aria-selected={!parentId} onClick={() => { setParentId(''); setParentOpen(false); }}
										className={clsx('w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover', controlFocus, !parentId && 'bg-selected')}>No {(KIND_LABELS[parentKind] ?? parentKind).toLowerCase()}</button>
									{parents.map((x) => (
										<button key={x.id} type="button" role="option" aria-selected={parentId === x.id} onClick={() => { setParentId(x.id); setParentOpen(false); }}
											className={clsx('w-full truncate rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover', controlFocus, parentId === x.id && 'bg-selected')}>{x.name}</button>
									))}
									{parents.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No open {(KIND_LABELS[parentKind] ?? parentKind).toLowerCase()} matches.</p>}
								</div>
							</div>
						</Popover>
					</div>
				)}
				<div className="grid grid-cols-2 gap-3">
					<Select label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
						<option value="">No owner</option>
						{people.map(([id, person]) => <option key={id} value={id}>{person.name}</option>)}
					</Select>
					<Input label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
				</div>
				<ClientSelect id="new-item-client" value={clientId} onChange={setClientId} />
				<div className="flex items-center gap-2 border-t border-slate-200 dark:border-slate-700 pt-3">
					<span className="text-xs text-slate-500">Enter creates · Shift+Enter creates and opens</span>
					<Button type="button" variant="ghost" className="ml-auto" onClick={p.onClose}>Cancel</Button>
					<Button type="submit" loading={busy}>Create {label.toLowerCase()}</Button>
				</div>
			</form>
			</div>
		</div>
	);
}
