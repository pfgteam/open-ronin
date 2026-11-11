'use client';

// The one item editor (spec §4.2 screen 3) — replaces TaskQuickPopover,
// WorkItemDrawer and the ?edit=1 modal. A right drawer over any list; the
// full page /the-work/[id] keeps working for deep links.
//
// Fields are the same cells the board uses, so editing here and in the
// table behave identically. Updates (health) and comments are one feed.
//
// Rework phase 4 (2026-11-05): every planning field for the item's kind
// (lib/work/fields.ts, D4/D11), each save writes ONE field; a kind picker
// in the header changes the type through the confirm dialog (5.6); parent
// is changeable; progress is a slider with a manual marker and a way back
// to automatic (D14); the header stays put and the body scrolls as one.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Archive, ArchiveRestore, Bell, BellRing, ChevronDown, ChevronRight, Download, ExternalLink, FileText, Link2, Maximize2, MoreHorizontal, Paperclip, Trash2, UserPlus, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Popover from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { controlFocus } from '@/components/ui/focus';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
import { useAuthStore } from '@/stores/auth';
import { CHILD_KINDS_FOR_PARENT } from '@/app/(app)/the-work/hierarchy';
import { KIND_LABELS, isLate } from '@/lib/work/boards/groups';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { archiveItems, createItem, deleteItems, unarchiveItems, updateItemField, type EditableField } from '@/app/(app)/the-work/b/actions';
import { addFollower, loadItemPanel, setCoOwner, setItemTag, type PanelData } from '@/app/(app)/the-work/b/panelActions';
import { addUrlAttachment, addWorkItemComment, toggleFollow } from '@/app/(app)/the-work/social';
import { createWorkItemUpdate, type WorkItemHealth } from '@/app/(app)/the-work/actions';
import { getAttachmentDownloadUrl, uploadAttachment } from '@/app/(app)/the-work/attachments-actions';
import { Avatar } from '@/components/board/cells';
import ItemFields from '@/components/work/ItemFields';
import { TypeChangeDialog } from '@/components/work/hub/TypeChangeDialog';
import { TYPE_CHOICES } from '@/lib/work/fields';
import StatusPill from '@/components/work/StatusPill';
import LinkifiedText from '@/components/ui/LinkifiedText';
import { formatShortDate } from '@/components/board/format';

const HEALTH: Record<WorkItemHealth, { label: string; cls: string }> = {
	on_track: { label: 'On track', cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' },
	at_risk: { label: 'At risk', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
	off_track: { label: 'Off track', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
};

function relTime(iso: string): string {
	const s = (Date.now() - Date.parse(iso)) / 1000;
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
	return formatShortDate(iso.slice(0, 10));
}

type Tab = 'updates' | 'children' | 'files' | 'activity';

export interface WorkItemPanelProps {
	itemId: string;
	ctx: BoardContext;
	today: string;
	/** drawer (default): the right-side overlay over a list. page: the same body in a card at /the-work/[id]. */
	variant?: 'drawer' | 'page';
	onClose?: () => void;
	/** The board's copy of the row changed (keep the table in sync). */
	onRowChange?: (row: WorkRow) => void;
	/** The item left this list (archived from a live board, restored or deleted from the Archived view). */
	onRemoved?: (id: string, how: 'archived' | 'restored' | 'deleted') => void;
	/** Undo on the archive toast brought the row back: put it back in the list. */
	onUndone?: (row: WorkRow) => void;
	onOpenItem?: (id: string) => void;
}

export default function WorkItemPanel({ itemId, ctx, today, variant = 'drawer', onClose, onRowChange, onRemoved, onUndone, onOpenItem }: WorkItemPanelProps) {
	const isDrawer = variant === 'drawer';
	const { toast, undoWindow } = useToast();
	const viewerId = useAuthStore((s) => s.profile?.id);
	const viewerRole = useAuthStore((s) => s.profile?.role);
	const [data, setData] = useState<PanelData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>('updates');
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap(panelRef, isDrawer, { autoFocus: false }); // the drawer focuses itself on mount
	// "⋯" menu: Archive (undoable) on a live item; Restore / Delete permanently on an archived one.
	const moreRef = useRef<HTMLButtonElement>(null);
	const [moreOpen, setMoreOpen] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	// Kind picker (5.6): bordered Button + Popover; picking a kind opens the confirm dialog.
	const kindRef = useRef<HTMLButtonElement>(null);
	const [kindOpen, setKindOpen] = useState(false);
	const [typeTo, setTypeTo] = useState<string | null>(null);

	const archive = async () => {
		setMoreOpen(false);
		const row = data?.item;
		const res = await archiveItems([itemId]);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
		onRemoved?.(itemId, 'archived');
		onClose?.();
		// Gmail-style: done at once, 10 s to take it back, then a final confirmation.
		undoWindow({
			message: `Archiving "${row?.name ?? 'item'}"`,
			committedMessage: 'Archived. Find it under the board\'s "Archived" filter.',
			undoneMessage: 'Restored',
			undo: async () => {
				const back = await unarchiveItems([itemId]);
				if (!back.ok) { toast({ message: back.error, variant: 'error' }); return; }
				if (row) onUndone?.(row);
			},
		});
	};
	const restore = async () => {
		setMoreOpen(false);
		const res = await unarchiveItems([itemId]);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
		onRemoved?.(itemId, 'restored');
		onClose?.();
		toast({ message: 'Restored', variant: 'success' });
	};
	const destroy = async () => {
		setMoreOpen(false); setConfirmDelete(false);
		const res = await deleteItems([itemId]);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
		onRemoved?.(itemId, 'deleted');
		onClose?.();
		toast({ message: 'Deleted permanently', variant: 'success' });
	};

	const reload = useCallback(async () => {
		const res = await loadItemPanel(itemId);
		if (res.ok) { setData(res.data); setError(null); } else setError(res.error);
	}, [itemId]);

	useEffect(() => { setData(null); setTab('updates'); void reload(); }, [reload]);
	useEffect(() => {
		if (!isDrawer) return;
		const onKey = (e: KeyboardEvent) => { // A cell popover is itself a role=dialog: its Escape closes it, not the panel.
			if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length <= 1) onClose?.(); };
		window.addEventListener('keydown', onKey);
		panelRef.current?.focus();
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose, isDrawer]);

	const item = data?.item;
	// Mirrors deleteItems(): creator, owner, or admin / exec. Others see why, not a button that fails.
	const canDelete = !!item && (viewerRole === 'admin' || viewerRole === 'exec' || (!!viewerId && (item.created_by === viewerId || item.owner_id === viewerId)));

	const edit = useCallback(async (field: EditableField, value: string | null) => {
		if (!data) return;
		const prev = data.item[field as keyof PanelData['item']] as string | null;
		setData((d) => (d ? { ...d, item: { ...d.item, [field]: value } } : d));
		const res = await updateItemField(itemId, field, value);
		if (!res.ok) { setData((d) => (d ? { ...d, item: { ...d.item, [field]: prev } } : d)); toast({ message: res.error, variant: 'error' }); return; }
		setData((d) => (d ? { ...d, item: { ...d.item, ...res.data } } : d));
		onRowChange?.(res.data);
		if (field === 'parent_id') void reload();
	}, [data, itemId, onRowChange, toast, reload]);

	const coOwner = async (uid: string, on: boolean) => {
		setData((d) => (d ? { ...d, owners: on ? [...new Set([...d.owners, uid])] : d.owners.filter((x) => x !== uid) } : d));
		const res = await setCoOwner(itemId, uid, on);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); void reload(); }
	};
	const tagEdit = async (tagId: string, on: boolean) => {
		setData((d) => (d ? { ...d, tags: on ? [...new Set([...d.tags, tagId])] : d.tags.filter((x) => x !== tagId) } : d));
		const res = await setItemTag(itemId, tagId, on);
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); void reload(); }
	};

	const following = !!viewerId && !!data?.followers.includes(viewerId);
	const onFollow = async () => {
		if (!data || !viewerId) return;
		const next = !following;
		setData({ ...data, followers: next ? [...data.followers, viewerId] : data.followers.filter((f) => f !== viewerId) });
		try { await toggleFollow(itemId, next); } catch (err) { toast({ message: (err as Error).message, variant: 'error' }); void reload(); }
	};

	const childKind = item ? CHILD_KINDS_FOR_PARENT[item.kind]?.[0] : undefined;
	const tabs: { key: Tab; label: string; count?: number }[] = [
		{ key: 'updates', label: 'Updates', count: data?.feed.length },
		...(childKind ? [{ key: 'children' as const, label: `${KIND_LABELS[childKind] ?? childKind}s`, count: data?.children.length }] : []),
		{ key: 'files', label: 'Files', count: data?.files.length },
		{ key: 'activity', label: 'Activity' },
	];

	const body = (
		<>
				{!data && !error && <div className="p-6 text-sm text-slate-500">Loading…</div>}
				{error && (
					<div className="p-6">
						<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
						<Button variant="outline" size="sm" className="mt-3" onClick={() => void reload()}>Try again</Button>
					</div>
				)}
				{item && data && (
					<>
						<div className="border-b border-slate-200 dark:border-slate-700 px-6 pt-4 pb-3">
							<div className="flex items-center gap-1.5 text-xs text-slate-500">
								<Button ref={kindRef} size="sm" variant="outline" onClick={() => setKindOpen(true)} aria-haspopup="menu" aria-expanded={kindOpen} disabled={item.archived}
									title="Change the type">
									{KIND_LABELS[item.kind] ?? item.kind}<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
								</Button>
								<Popover open={kindOpen} onClose={() => setKindOpen(false)} anchorRef={kindRef} width="w-52">
									<div className="p-1.5" role="menu" aria-label="Change type to">
										<p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-slate-500">Change type to</p>
										{TYPE_CHOICES.filter((k) => k !== item.kind).map((k) => (
											<button key={k} type="button" role="menuitem" onClick={() => { setKindOpen(false); setTypeTo(k); }}
												className={clsx('flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>{KIND_LABELS[k] ?? k}</button>
										))}
									</div>
								</Popover>
								{item.archived && <span className="rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Archived</span>}
								{(() => {
									// Rollup from the children (loadBoardContext.progress): done / total, as the old overview showed.
									const prog = ctx.progress[item.id];
									return prog && prog.total > 0 && childKind ? (
										<span className="rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-2xs tabular-nums text-slate-600 dark:text-slate-300" title={`${prog.done} of ${prog.total} ${(KIND_LABELS[childKind] ?? childKind).toLowerCase()}s done`}>
											{Math.round((prog.done / prog.total) * 100)}% · {prog.done}/{prog.total}
										</span>
									) : null;
								})()}
								{data.parent && (
									<>
										<ChevronRight className="w-3 h-3" aria-hidden="true" />
										<button type="button" onClick={() => onOpenItem?.(data.parent!.id)} className={clsx('truncate hover:underline', controlFocus)}>{data.parent.name}</button>
									</>
								)}
								<span className="ml-auto flex items-center gap-1">
									{isDrawer ? (
										<Link href={`/the-work/${item.id}`} aria-label="Open full page" className={clsx('rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><Maximize2 className="w-4 h-4" aria-hidden="true" /></Link>
									) : null}
									<button type="button" aria-label="Copy link" className={clsx('rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}
										onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/the-work/${item.id}`).then(() => toast({ message: 'Link copied', variant: 'success' }), () => undefined); }}>
										<Link2 className="w-4 h-4" aria-hidden="true" />
									</button>
									<button ref={moreRef} type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => { setConfirmDelete(false); setMoreOpen(true); }}
										className={clsx('rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><MoreHorizontal className="w-4 h-4" aria-hidden="true" /></button>
									<Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} placement="bottom-end" width="w-64">
										<div role="menu" aria-label="Item actions" className="p-1.5">
											{!item.archived ? (
												<button type="button" role="menuitem" onClick={() => void archive()}
													className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
													<Archive className="w-4 h-4 text-slate-500" aria-hidden="true" />Archive <span className="ml-auto text-xs text-slate-500">10 s to undo</span>
												</button>
											) : (
												<>
													<button type="button" role="menuitem" onClick={() => void restore()}
														className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
														<ArchiveRestore className="w-4 h-4 text-slate-500" aria-hidden="true" />Restore
													</button>
													{!canDelete ? (
														<p className="px-2 py-1.5 text-xs text-slate-500">Only the creator, the owner or an admin can delete this for good.</p>
													) : confirmDelete ? (
														<div className="px-2 py-1.5 text-sm">
															<p className="text-slate-700 dark:text-slate-300">Delete for good? This cannot be undone.</p>
															<div className="mt-1.5 flex gap-1">
																<Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => void destroy()}>Yes, delete</Button>
																<Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
															</div>
														</div>
													) : (
														<button type="button" role="menuitem" onClick={() => setConfirmDelete(true)}
															className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-600 hover:bg-hover dark:text-red-400', controlFocus)}>
															<Trash2 className="w-4 h-4" aria-hidden="true" />Delete permanently
														</button>
													)}
												</>
											)}
										</div>
									</Popover>
									{isDrawer && <button type="button" onClick={onClose} aria-label="Close" className={clsx('rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><X className="w-4 h-4" aria-hidden="true" /></button>}
								</span>
							</div>
							<NameField name={item.name} onSave={(v) => void edit('name', v)} />

						</div>

						{/* One scroll for the body (5.3): fields, followers, the tabs and their content. */}
						<div className={isDrawer ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : ''}>
						<div className="space-y-3 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
							<ItemFields item={item} ctx={ctx} today={today} parent={data.parent} owners={data.owners} tags={data.tags} readOnly={item.archived}
								onEdit={(f, v) => edit(f, v)} onCoOwner={(u, on) => void coOwner(u, on)} onTag={(tg, on) => void tagEdit(tg, on)} onOpenItem={onOpenItem} />


							<Followers followers={data.followers} ctx={ctx} following={following} onFollow={onFollow}
								onAdd={async (uid) => {
									setData((d) => (d ? { ...d, followers: [...new Set([...d.followers, uid])] } : d));
									const res = await addFollower(itemId, uid);
									if (!res.ok) { toast({ message: res.error, variant: 'error' }); void reload(); }
									else toast({ message: `${ctx.people[uid]?.name ?? 'They'} will get updates on this ${KIND_LABELS[item.kind]?.toLowerCase() ?? 'item'}`, variant: 'success' });
								}} />
						</div>

						<div role="tablist" aria-label="Item sections" className="sticky top-0 z-10 flex gap-1 border-b border-slate-200 bg-white px-6 dark:border-slate-700 dark:bg-slate-800">
							{tabs.map((t) => (
								<button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
									className={clsx('-mb-px border-b-2 px-3 py-2 text-sm', controlFocus, tab === t.key ? 'border-primary-600 font-semibold text-primary-700 dark:text-primary-400' : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100')}>
									{t.label}{t.count !== undefined && <span className="ml-1 text-xs text-slate-500 tabular-nums">{t.count}</span>}
								</button>
							))}
						</div>

						<div className="px-6 py-4">
							{tab === 'updates' && <Feed data={data} ctx={ctx} itemId={itemId} canHealth={!!childKind && item.kind !== 'goal'} onPosted={reload} />}
							{tab === 'children' && childKind && (
								<Children rows={data.children} ctx={ctx} today={today} childKind={childKind} onOpen={(id) => onOpenItem?.(id)}
									onAdd={async (name) => {
										const res = await createItem({ name, kind: childKind, parent_id: itemId, quarter_id: item.quarter_id ?? undefined });
										if (!res.ok) { toast({ message: res.error, variant: 'error' }); return false; }
										setData((d) => (d ? { ...d, children: [...d.children, res.data] } : d));
										return true;
									}} />
							)}
							{tab === 'files' && <Files files={data.files} ctx={ctx} itemId={itemId} hasChildren={!!childKind} onUploaded={reload} />}
							{tab === 'activity' && (
								<ul className="space-y-0">
									{data.activity.map((a, i) => (
										<li key={i} className="flex items-center gap-2 border-b border-dashed border-slate-200 dark:border-slate-700 py-2 text-sm text-slate-700 dark:text-slate-300">
											{a.actor_id ? <Avatar id={a.actor_id} ctx={ctx} size={20} /> : <span className="w-5" />}
											<span>{a.text}</span>
											<span className="ml-auto text-xs text-slate-500">{relTime(a.at)}</span>
										</li>
									))}
								</ul>
							)}
						</div>
						</div>
						{typeTo && (
							<TypeChangeDialog open rows={[item]} ctx={ctx} initialKind={typeTo} onClose={() => setTypeTo(null)}
								onDone={(changed) => { const r = changed[0]; if (r) { onRowChange?.(r); void reload(); } }} />
						)}
					</>
				)}
		</>
	);
	if (!isDrawer) {
		return <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">{body}</div>;
	}
	return (
		<div className="fixed inset-0 z-50 flex justify-end" role="presentation">
			<button type="button" aria-label="Close panel" onClick={onClose} className="absolute inset-0 bg-slate-950/30 cursor-default" tabIndex={-1} />
			<div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={item?.name ?? 'Work item'}
				className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-panel focus:outline-none">
				{body}
			</div>
		</div>
	);
}

function NameField({ name, onSave }: { name: string; onSave: (v: string) => void }) {
	const [v, setV] = useState(name);
	useEffect(() => setV(name), [name]);
	return (
		<input
			aria-label="Name"
			value={v}
			onChange={(e) => setV(e.target.value)}
			onBlur={() => { if (v.trim() && v.trim() !== name) onSave(v.trim()); else setV(name); }}
			onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
			className="mt-1.5 w-full rounded-md border border-transparent bg-transparent px-1 -mx-1 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 hover:border-slate-200 dark:hover:border-slate-700 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
		/>
	);
}

function Followers({ followers, ctx, following, onFollow, onAdd }: {
	followers: string[]; ctx: BoardContext; following: boolean; onFollow: () => void; onAdd: (id: string) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState('');
	const candidates = Object.entries(ctx.people).filter(([id, p]) => !followers.includes(id) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 30);
	return (
		<div className="mt-3 flex flex-wrap items-center gap-2">
			<span className="text-xs text-slate-500">Followers</span>
			<span className="flex">{followers.slice(0, 8).map((id, i) => <span key={id} className={i ? '-ml-1.5' : ''}><Avatar id={id} ctx={ctx} size={24} /></span>)}</span>
			{followers.length > 8 && <span className="text-xs text-slate-500">+{followers.length - 8}</span>}
			<button ref={ref} type="button" onClick={() => setOpen(true)} aria-label="Add a follower" className={clsx('rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}>
				<UserPlus className="w-4 h-4" aria-hidden="true" />
			</button>
			<Button variant="outline" size="sm" onClick={onFollow} aria-pressed={following}>
				{following ? <BellRing className="w-3.5 h-3.5" aria-hidden="true" /> : <Bell className="w-3.5 h-3.5" aria-hidden="true" />}{following ? 'Following' : 'Follow'}
			</Button>
			<span className="text-xs text-slate-500">Followers get status changes, updates, due dates and @mentions.</span>
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width="w-64">
				<div className="p-2">
					<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people"
						className="w-full mb-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500" />
					<div className="max-h-64 overflow-y-auto">
						{candidates.map(([id, p]) => (
							<button key={id} type="button" onClick={() => { setOpen(false); setQ(''); onAdd(id); }}
								className={clsx('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', controlFocus)}>
								<Avatar id={id} ctx={ctx} size={22} />{p.name}
							</button>
						))}
						{!candidates.length && <p className="px-2 py-1.5 text-xs text-slate-500">Everyone already follows this.</p>}
					</div>
				</div>
			</Popover>
		</div>
	);
}

function Feed({ data, ctx, itemId, canHealth, onPosted }: { data: PanelData; ctx: BoardContext; itemId: string; canHealth: boolean; onPosted: () => Promise<void> }) {
	const { toast } = useToast();
	const [text, setText] = useState('');
	const [health, setHealth] = useState<WorkItemHealth | null>(null);
	const [busy, setBusy] = useState(false);
	const post = async () => {
		if (!text.trim() && !health) return;
		setBusy(true);
		try {
			if (health) {
				const res = await createWorkItemUpdate({ work_item_id: itemId, health, body_md: text });
				if (!res.ok) throw new Error(res.error);
			} else {
				await addWorkItemComment({ workItemId: itemId, body: text });
			}
			setText(''); setHealth(null);
			await onPosted();
		} catch (err) {
			toast({ message: (err as Error).message, variant: 'error' });
		} finally { setBusy(false); }
	};
	return (
		<div>
			<div className="overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500">
				<label htmlFor="panel-update" className="sr-only">Write an update</label>
				<textarea id="panel-update" value={text} onChange={(e) => setText(e.target.value)} rows={3}
					placeholder="Write an update. @First Last mentions someone and adds them as a follower."
					className="block w-full resize-y border-0 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none" />
				<div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1.5">
					{canHealth && (
						<>
							<span className="text-xs text-slate-500">Health:</span>
							{(Object.keys(HEALTH) as WorkItemHealth[]).map((h) => (
								<button key={h} type="button" aria-pressed={health === h} onClick={() => setHealth(health === h ? null : h)}
									className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', controlFocus, health === h ? HEALTH[h].cls : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700')}>
									{HEALTH[h].label}
								</button>
							))}
						</>
					)}
					<Button size="sm" className="ml-auto" onClick={post} loading={busy} disabled={!text.trim() && !health}>{health ? 'Post health update' : 'Post'}</Button>
				</div>
			</div>
			<ul className="mt-2">
				{data.feed.map((f) => (
					<li key={f.id} className="flex gap-3 border-b border-slate-200 dark:border-slate-700 py-3">
						{f.author_id ? <Avatar id={f.author_id} ctx={ctx} size={28} /> : <span className="w-7" />}
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<span className="font-semibold">{f.author_id ? ctx.people[f.author_id]?.name ?? 'Former member' : 'System'}</span>
								<span className="text-xs text-slate-500">{relTime(f.created_at)}</span>
								{f.health && <span className={clsx('rounded-md px-1.5 py-0.5 text-2xs font-semibold', HEALTH[f.health].cls)}>{HEALTH[f.health].label}</span>}
							</div>
							{f.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300"><LinkifiedText text={f.body} /></p>}
						</div>
					</li>
				))}
				{!data.feed.length && <li className="py-6 text-sm text-slate-500">No updates yet.{canHealth ? ' The first update with a health mark shows up on the parent goal.' : ''}</li>}
			</ul>
		</div>
	);
}

function Children({ rows, ctx, today, childKind, onOpen, onAdd }: {
	rows: WorkRow[]; ctx: BoardContext; today: string; childKind: string; onOpen: (id: string) => void; onAdd: (name: string) => Promise<boolean>;
}) {
	const [v, setV] = useState('');
	const label = (KIND_LABELS[childKind] ?? childKind).toLowerCase();
	return (
		<div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
			<table className="w-full table-fixed text-sm">
				<colgroup><col /><col style={{ width: 64 }} /><col style={{ width: 132 }} /><col style={{ width: 84 }} /></colgroup>
				<thead><tr className="bg-slate-50 dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-400">
					<th className="px-3 py-2 text-left font-medium">{KIND_LABELS[childKind] ?? childKind}</th><th className="font-medium">Owner</th><th className="font-medium">Status</th><th className="font-medium">Due</th>
				</tr></thead>
				<tbody>
					{rows.map((r) => {
						return (
							<tr key={r.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover">
								<td className="px-3 py-1.5"><button type="button" onClick={() => onOpen(r.id)} className={clsx('truncate text-left hover:underline', controlFocus)}>{r.name}</button></td>
								<td className="text-center">{r.owner_id ? <Avatar id={r.owner_id} ctx={ctx} size={22} /> : '—'}</td>
								<td className="p-0"><span className="flex h-9 items-center justify-center px-1"><StatusPill ctx={ctx} kind={r.kind} status={r.status} className="w-full" /></span></td>
								<td className={clsx('text-center text-xs tabular-nums', isLate(ctx, r, today) && 'font-semibold text-red-600 dark:text-red-400')}>{r.ends_at ? formatShortDate(r.ends_at) : '—'}</td>
							</tr>
						);
					})}
					<tr className="border-t border-slate-200 dark:border-slate-700">
						<td colSpan={4} className="p-0">
							<input value={v} onChange={(e) => setV(e.target.value)} placeholder={`+ Add ${label}`} aria-label={`Add ${label}`}
								onKeyDown={async (e) => { if (e.key === 'Enter' && v.trim()) { if (await onAdd(v.trim())) setV(''); } }}
								className="h-9 w-full bg-transparent px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500" />
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function Files({ files, ctx, itemId, hasChildren, onUploaded }: {
	files: PanelData['files']; ctx: BoardContext; itemId: string; hasChildren: boolean; onUploaded: () => Promise<void>;
}) {
	const { toast } = useToast();
	const [scope, setScope] = useState<'all' | 'own'>('all');
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const own = files.filter((f) => !f.origin);
	const shown = scope === 'own' ? own : files;
	const upload = async (list: FileList | null) => {
		if (!list?.length) return;
		setBusy(true);
		for (const file of Array.from(list)) {
			const fd = new FormData();
			fd.set('file', file); fd.set('work_item_id', itemId);
			const res = await uploadAttachment(fd);
			if (!res.ok) toast({ message: `${file.name}: ${res.error}`, variant: 'error' });
		}
		setBusy(false);
		await onUploaded();
	};
	const download = async (id: string) => {
		const res = await getAttachmentDownloadUrl(id);
		if (res.ok) window.open(res.url, '_blank', 'noopener');
		else toast({ message: res.error, variant: 'error' });
	};
	// Link deliverables (a Drive / Doc URL is the usual deliverable, 0052).
	const [link, setLink] = useState('');
	const [linkDeliverable, setLinkDeliverable] = useState(true);
	const addLink = async () => {
		const url = link.trim();
		if (!/^https?:\/\//i.test(url)) { toast({ message: 'Paste a full link (https://…).', variant: 'error' }); return; }
		setBusy(true);
		try { await addUrlAttachment({ workItemId: itemId, url, isDeliverable: linkDeliverable }); setLink(''); await onUploaded(); }
		catch (e) { toast({ message: (e as Error).message, variant: 'error' }); }
		setBusy(false);
	};
	return (
		<div>
			{hasChildren && (
				<div role="group" aria-label="Which files" className="mb-3 inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600 text-xs">
					<button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')} className={clsx('px-3 py-1.5', controlFocus, scope === 'all' ? 'bg-primary-700 text-white' : 'text-slate-600 dark:text-slate-300')}>Include children ({files.length})</button>
					<button type="button" aria-pressed={scope === 'own'} onClick={() => setScope('own')} className={clsx('px-3 py-1.5', controlFocus, scope === 'own' ? 'bg-primary-700 text-white' : 'text-slate-600 dark:text-slate-300')}>Only this item ({own.length})</button>
				</div>
			)}
			<ul className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
				{shown.map((f) => (
					<li key={f.id} className="flex items-center gap-3 border-b last:border-b-0 border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
						<FileText className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-1.5 truncate font-medium">{f.file_name}{f.is_deliverable && <span className="shrink-0 rounded-md bg-primary-50 dark:bg-primary-950 px-1.5 text-2xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">Deliverable</span>}</span>
							<span className="block truncate text-xs text-slate-500">
								{f.origin ? <>From {KIND_LABELS[f.origin.kind]?.toLowerCase() ?? 'item'} <span className="text-slate-700 dark:text-slate-300">{f.origin.name}</span> · </> : null}
								{f.uploaded_by ? ctx.people[f.uploaded_by]?.name ?? 'Former member' : '—'} · {relTime(f.created_at)}
							</span>
						</span>
						{f.url ? (
							<a href={f.url} target="_blank" rel="noreferrer" aria-label={`Open ${f.file_name}`} className={clsx('rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><ExternalLink className="w-4 h-4" aria-hidden="true" /></a>
						) : (
							<button type="button" onClick={() => void download(f.id)} aria-label={`Download ${f.file_name}`} className={clsx('rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700', controlFocus)}><Download className="w-4 h-4" aria-hidden="true" /></button>
						)}
					</li>
				))}
				{!shown.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No files yet.</li>}
				<li className="flex items-center gap-2 px-3 py-2 text-sm">
					<Link2 className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
					<input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link (Drive, Doc, article…)" aria-label="Link to add"
						onKeyDown={(e) => { if (e.key === 'Enter' && link.trim()) { e.preventDefault(); void addLink(); } }}
						className="h-8 min-w-0 flex-1 bg-transparent text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 rounded-md px-1" />
					<label className="flex shrink-0 items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={linkDeliverable} onChange={(e) => setLinkDeliverable(e.target.checked)} className="accent-primary-600" />Deliverable</label>
					<Button size="sm" variant="outline" disabled={busy || !link.trim()} onClick={() => void addLink()}>Add</Button>
				</li>
			</ul>
			<input ref={inputRef} type="file" multiple className="sr-only" aria-label="Attach files" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
			<button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
				onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}
				className={clsx('mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-5 text-sm text-slate-500 hover:bg-hover', controlFocus)}>
				<Paperclip className="w-4 h-4" aria-hidden="true" />{busy ? 'Uploading…' : 'Drop files or click to attach (25MB max)'}
			</button>
		</div>
	);
}
