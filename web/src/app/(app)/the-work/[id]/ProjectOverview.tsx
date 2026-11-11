'use client';

// Linear-style Overview — rendered by /the-work/[id] for goal / priority /
// project / campaign (other kinds keep the universal form layout). Per
// Sam 2026-07-14: all three strategic kinds share the same structure,
// and the "milestones" section is the natural child kind of the hierarchy —
// a goal's milestones are its Priorities, a priority's are its Projects, a
// project's are its Tasks (client mirror: campaign → Assignments).
//
//   main column  → summary/description (or, in edit mode, the full
//                  universal form inline), update composer + feed (health),
//                  children-with-progress section, full children tree panel
//   sidebar      → properties (status, priority, owner, lead, members,
//                  dates, quarter, labels) + Edit button, hidden in edit
//                  mode since the inline form covers the same fields
//
// Per Sam 2026-08-10: editing a project/goal/priority/campaign no longer
// opens the right-side drawer — it swaps the header card for the same
// WorkItemForm the drawer used to wrap, inline on this page. Every field the
// drawer exposed is still here, just without the panel-over-content feel.
//
// Health model: newest work_item_updates row = current health (on_track /
// at_risk / off_track). No update in the last 7 days → "Update missing".
//
// Per spec 2026-08-25 ("one chassis, three emphases") this overview also
// carries the shared detail chassis: the SAME status chips the popover and
// the task page use (DetailStatusChips, replacing the old <select>), plus
// Comments in the main column and Followers + Activity in the rail. Those
// three are SERVER components and this file is a client component, so they
// arrive as pre-rendered ReactNode slots from page.tsx rather than as
// imports — see task-6-report.md.
//
// And the one asymmetry: a GOAL never types health (`healthMode:
// 'computed'`). Its badge shows worstActiveHealth() over its priorities and
// it gets NO update composer; its feed is its children's updates, each
// labelled with the child it came from. Projects/priorities/campaigns keep
// typing their own health exactly as before.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import {
	Pencil, Plus, Check, Trash2,
	User as UserIcon, Users, Calendar as CalIcon, Flag, Tag as TagIcon,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';
import { formatShortDate } from '@/components/board/format';
import WorkItemForm, { type WorkItemFormInitial } from '../WorkItemForm';
import { useRowShortcuts } from '../useRowShortcuts';
import ShortcutsHelpModal from '../ShortcutsHelpModal';
import { setWorkItemStatus, upsertWorkItem, createWorkItemUpdate, deleteWorkItemUpdate, searchChildCandidates, addChild, type WorkItemHealth } from '../actions';
import AttachmentsPanel from '../AttachmentsPanel';
import LinkifiedText from '@/components/ui/LinkifiedText';
import DetailStatusChips from './DetailStatusChips';

export interface OverviewChild {
	id: string; name: string; status: string; ends_at: string | null;
	/** Rollup of this child's own children (grandchildren of the page item). */
	total: number; done: number;
	/** Whether the child itself sits in a terminal status. */
	is_terminal: boolean;
}
export interface OverviewUpdate {
	id: string; health: WorkItemHealth; body_md: string | null;
	created_at: string; author_name: string; author_id: string | null;
	/** Set only on a goal's rolled-up feed: the child this update came from,
	 *  rendered as a `(Child name)` prefix so the origin is never ambiguous.
	 *  null/undefined for an item's own updates. */
	origin_name?: string | null;
	/** Where the origin child lives, so the label is clickable. */
	origin_id?: string | null;
}
export interface OverviewMember { user_id: string; is_primary: boolean; name: string }
export interface OverviewChildMeta { kind: string; singular: string; plural: string }

interface Profile { id: string; first_name: string | null; last_name: string | null; email: string }
interface Tag { id: string; slug: string; label: string; color: string | null; category: string | null; parent_tag_id: string | null }

interface Props {
	item: WorkItemFormInitial & { id: string; name: string; kind: string };
	currentUserId: string | null;
	members: OverviewMember[];
	childItems: OverviewChild[];
	childMeta: OverviewChildMeta;
	progress: { total: number; done: number };
	updates: OverviewUpdate[];
	ownerName: string | null;
	leadName: string | null;
	quarterName: string | null;
	itemTagLabels: { id: string; label: string; color: string | null }[];
	// Supporting data for the edit drawer
	profiles: Profile[];
	tags: Tag[];
	quarters: { id: string; name: string }[];
	statusesByKind: Record<string, { slug: string; label: string; color: string | null; is_initial?: boolean; is_terminal?: boolean }[]>;
	parentOptions: { id: string; name: string; kind: string }[];
	/** 'typed' (project / priority / campaign): the composer posts this
	 *  item's own health. 'computed' (goal): no composer at all, and the
	 *  badge shows `computedHealth` instead of the newest update's. */
	healthMode: 'typed' | 'computed';
	/** worstActiveHealth() over the children, only meaningful when
	 *  healthMode === 'computed'. null = no active child has any health. */
	computedHealth: WorkItemHealth | null;
	/** Server-rendered chassis pieces (see the file header for why these are
	 *  slots and not imports). */
	commentsSlot: ReactNode;
	followersSlot: ReactNode;
	activitySlot: ReactNode;
}

const HEALTH_META: Record<WorkItemHealth, { label: string; dot: string; badge: string }> = {
	on_track:  { label: 'On track',  dot: 'bg-green-500', badge: 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' },
	at_risk:   { label: 'At risk',   dot: 'bg-amber-500',   badge: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
	off_track: { label: 'Off track', dot: 'bg-red-500',     badge: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' },
};

const STALE_UPDATE_DAYS = 7;

export function healthIsStale(latest: string | null): boolean {
	if (!latest) return true;
	return Date.now() - new Date(latest).getTime() > STALE_UPDATE_DAYS * 24 * 60 * 60 * 1000;
}

function relativeTime(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diffMs / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return formatDate(iso);
}

export default function ProjectOverview({
	item, currentUserId, members, childItems, childMeta, progress, updates,
	ownerName, leadName, quarterName, itemTagLabels,
	profiles, tags, quarters, statusesByKind, parentOptions,
	healthMode, computedHealth, commentsSlot, followersSlot, activitySlot,
}: Props) {
	const healthIsComputed = healthMode === 'computed';
	const router = useRouter();
	const { toast } = useToast();
	const [, startTransition] = useTransition();

	// Inline edit — replaces the old right-side drawer. The header card
	// becomes the universal WorkItemForm; the read-only Properties sidebar
	// hides itself since the form already covers every one of those fields.
	const [editMode, setEditMode] = useState(false);
	// Set by the 'A'/'S' shortcuts so the form lands the cursor on Owner/
	// Status directly on mount; cleared whenever edit mode closes.
	const [focusField, setFocusField] = useState<'status' | 'owner' | undefined>(undefined);

	// Keyboard shortcuts (E/A/S) — single-item page, so there's no "row under
	// the mouse" to track; this page's own item is always the target. No 'C'
	// (no create-here action) or '/' (no search box on this page).
	// '?' opens the shortcuts cheat sheet (Sam, 2026-08-10) — chosen over
	// a persistent hint bar so it doesn't take up screen space.
	const [helpOpen, setHelpOpen] = useState(false);

	useRowShortcuts({
		hoveredId: item.id,
		onEdit: () => setEditMode(true),
		onAssign: () => { setFocusField('owner'); setEditMode(true); },
		onStatus: () => { setFocusField('status'); setEditMode(true); },
		onHelp: () => setHelpOpen(true),
		enabled: !editMode,
	});

	// Update composer
	const [health, setHealth] = useState<WorkItemHealth>('on_track');
	const [updateBody, setUpdateBody] = useState('');
	const [posting, setPosting] = useState(false);

	// Inline child-add (goal → priority, priority → project, project → task).
	// Two modes: create a brand-new child, or attach an existing item that
	// isn't parented here yet.
	const [showAddChild, setShowAddChild] = useState(false);
	const [addMode, setAddMode] = useState<'new' | 'existing'>('new');
	const [childName, setChildName] = useState('');
	const [childDate, setChildDate] = useState('');
	const [childSaving, setChildSaving] = useState(false);
	const [attachQuery, setAttachQuery] = useState('');
	const [attachResults, setAttachResults] = useState<{ id: string; name: string; kind: string; parent_id: string | null }[]>([]);
	const [attachSearching, setAttachSearching] = useState(false);

	const latestUpdate = updates[0] ?? null;
	const stale = healthIsStale(latestUpdate?.created_at ?? null);
	const statusOptions = statusesByKind[item.kind] ?? [];
	const childStatuses = statusesByKind[childMeta.kind] ?? [];
	const childStatusLabels = new Map(childStatuses.map((s) => [s.slug, s.label]));
	const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

	// Checkbox slugs for the children list — from the kind's status config
	// (is_terminal / is_initial), never hardcoded. Prefer 'done' when the
	// config has more than one terminal status.
	const childDoneSlug =
		(childStatuses.find((st) => st.slug === 'done' && st.is_terminal) ??
			childStatuses.find((st) => st.is_terminal))?.slug ?? 'done';
	const childReopenSlug =
		(childStatuses.find((st) => st.is_initial) ??
			childStatuses.find((st) => !st.is_terminal))?.slug ?? 'to_do';

	// Optimistic done-state for the children checkboxes: the strike-through +
	// fade applies immediately; a failed save reverts it with a toast.
	const [childDone, setChildDone] = useState<Record<string, boolean>>({});

	function handleToggleChild(c: OverviewChild, nextDone: boolean) {
		setChildDone((m) => ({ ...m, [c.id]: nextDone }));
		startTransition(async () => {
			const res = await setWorkItemStatus(c.id, nextDone ? childDoneSlug : childReopenSlug);
			if (!res.ok) {
				setChildDone((m) => { const n = { ...m }; delete n[c.id]; return n; });
				toast({ message: `Could not update ${c.name}: ${res.error}`, variant: 'error' });
				return;
			}
			router.refresh();
		});
	}

	// (The item's own status change used to live here as a <select> handler;
	// it is now DetailStatusChips' job — same server action, same optimistic
	// revert + toast, but the identical control the popover and task page
	// use. The children checkboxes above still call setWorkItemStatus
	// directly, since they act on OTHER items.)

	async function handlePostUpdate() {
		setPosting(true);
		const res = await createWorkItemUpdate({ work_item_id: item.id, health, body_md: updateBody });
		setPosting(false);
		if (!res.ok) { toast({ message: `Could not post update: ${res.error}`, variant: 'error' }); return; }
		setUpdateBody('');
		toast({ message: `Update posted — ${HEALTH_META[health].label}` });
		router.refresh();
	}

	async function handleDeleteUpdate(id: string) {
		const res = await deleteWorkItemUpdate(id, item.id);
		if (!res.ok) { toast({ message: `Could not delete update: ${res.error}`, variant: 'error' }); return; }
		toast({ message: 'Update deleted' });
		router.refresh();
	}

	async function handleAddChild() {
		const name = childName.trim();
		if (!name) return;
		setChildSaving(true);
		const res = await upsertWorkItem({
			name, kind: childMeta.kind, parent_id: item.id,
			status: (statusesByKind[childMeta.kind] ?? [])[0]?.slug ?? 'to_do',
			ends_at: childDate || null,
			// Children inherit the parent's quarter so they show up on the
			// same quarter-scoped tabs (harmless for non-quarter kinds).
			quarter_id: item.quarter_id ?? null,
		});
		setChildSaving(false);
		if (!res.ok) { toast({ message: `Could not add ${childMeta.singular.toLowerCase()}: ${res.error}`, variant: 'error' }); return; }
		setChildName(''); setChildDate(''); setShowAddChild(false);
		toast({ message: `${childMeta.singular} “${name}” added` });
		router.refresh();
	}

	async function handleAttachSearch(q: string) {
		setAttachQuery(q);
		setAttachSearching(true);
		const results = await searchChildCandidates(item.kind, q, item.id, childMeta.kind);
		setAttachSearching(false);
		// Hide items already attached here.
		const attached = new Set(childItems.map((c) => c.id));
		setAttachResults(results.filter((r) => !attached.has(r.id)));
	}

	async function handleAttach(childId: string, childNameLabel: string) {
		const res = await addChild(item.id, childId);
		if (!res.ok) { toast({ message: `Could not attach: ${res.error}`, variant: 'error' }); return; }
		setAttachResults((rs) => rs.filter((r) => r.id !== childId));
		toast({ message: `“${childNameLabel}” attached` });
		router.refresh();
	}

	return (
		<>
		<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
			{/* ============ Main column ============ */}
			<div className="lg:col-span-2 space-y-4">
				{/* Header — swaps to the full universal form in place when
				    editing, instead of opening a drawer over the page. */}
				{editMode ? (
					<Card>
						<WorkItemForm
							mode="edit"
							initial={item}
							profiles={profiles}
							tags={tags}
							quarters={quarters}
							statusesByKind={statusesByKind}
							parentOptions={parentOptions}
							autoFocusField={focusField}
							onCancel={() => { setEditMode(false); setFocusField(undefined); }}
							onSaved={() => { setEditMode(false); setFocusField(undefined); router.refresh(); }}
						/>
					</Card>
				) : (
					<Card>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">{item.name}</h1>
								<div className="flex items-center gap-2 mt-2 flex-wrap">
									{/* A goal's health is INHERITED, never declared. It is the
									    worst health among its active priorities — so a goal can
									    never read "On track" while a priority under it is off
									    track. Staleness doesn't apply: there is no update of the
									    goal's own to have gone stale. */}
									{healthIsComputed ? (
										computedHealth ? (
											<span
												title="Health is inherited from the worst active priority."
												className={`inline-flex items-center gap-1.5 text-2xs font-medium border rounded-full px-2 py-0.5 ${HEALTH_META[computedHealth].badge}`}
											>
												<span className={`w-1.5 h-1.5 rounded-full ${HEALTH_META[computedHealth].dot}`} />
												{HEALTH_META[computedHealth].label}
											</span>
										) : (
											<span
												title="Health is inherited from the worst active priority."
												className="inline-flex items-center gap-1.5 text-2xs font-medium border rounded-full px-2 py-0.5 bg-slate-50 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
											>
												<span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
												No {childMeta.singular.toLowerCase()} health yet
											</span>
										)
									) : latestUpdate && !stale ? (
										<span className={`inline-flex items-center gap-1.5 text-2xs font-medium border rounded-full px-2 py-0.5 ${HEALTH_META[latestUpdate.health].badge}`}>
											<span className={`w-1.5 h-1.5 rounded-full ${HEALTH_META[latestUpdate.health].dot}`} />
											{HEALTH_META[latestUpdate.health].label}
										</span>
									) : (
										<span className="inline-flex items-center gap-1.5 text-2xs font-medium border rounded-full px-2 py-0.5 bg-slate-50 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
											<span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
											Update missing
										</span>
									)}
									<span className="text-2xs text-slate-600 dark:text-slate-400">
										{progress.done}/{progress.total} {childMeta.plural.toLowerCase()} · {pct}%
									</span>
								</div>
							</div>
							<Button variant="secondary" onClick={() => setEditMode(true)}>
								<Pencil className="w-3.5 h-3.5" /> Edit
							</Button>
						</div>
						<div className="mt-3 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden">
							<div className="h-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
						</div>
						{item.description_md && (
							<p className="text-sm text-slate-600 dark:text-slate-400 mt-3 whitespace-pre-wrap"><LinkifiedText text={item.description_md} /></p>
						)}
					</Card>
				)}

				{/* Update composer + feed. On a goal the composer is absent by
				    design (health is computed, so there is nothing to type) and
				    the feed is the children's updates instead of this item's. */}
				<Card>
					<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-2">
						{healthIsComputed ? `Updates from ${childMeta.plural.toLowerCase()}` : 'Updates'}
					</div>
					{healthIsComputed ? (
						updates.length === 0 && (
							<p className="text-xs text-slate-400">
								No updates from {childMeta.plural.toLowerCase()} yet.
							</p>
						)
					) : (
					<div className="space-y-2">
						<div className="inline-flex items-center gap-0 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
							{(Object.keys(HEALTH_META) as WorkItemHealth[]).map((h, i) => (
								<button
									key={h}
									type="button"
									onClick={() => setHealth(h)}
									className={`transition-colors px-2.5 py-1.5 inline-flex items-center gap-1.5 text-xs ${i > 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''} ${
										health === h ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'
									}`}
								>
									<span className={`w-1.5 h-1.5 rounded-full ${HEALTH_META[h].dot}`} />
									{HEALTH_META[h].label}
								</button>
							))}
						</div>
						<textarea
							value={updateBody}
							onChange={(e) => setUpdateBody(e.target.value)}
							placeholder={updates.length === 0 ? 'Write first update…' : 'What changed since the last update?'}
							rows={2}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
						<div className="flex justify-end">
							<Button onClick={handlePostUpdate} loading={posting} disabled={posting}>Post update</Button>
						</div>
					</div>
					)}

					{updates.length > 0 && (
						<div className={`space-y-3 ${healthIsComputed ? '' : 'mt-4 border-t border-slate-100 dark:border-slate-700/50 pt-3'}`}>
							{updates.map((u) => (
								<div key={u.id} className="flex items-start gap-2.5 group">
									<span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${HEALTH_META[u.health].dot}`} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2 text-xs flex-wrap">
											{/* Origin label — only ever set on a rolled-up feed, so
											    an update read on a goal page always says which
											    priority it actually describes. */}
											{u.origin_name && (
												u.origin_id ? (
													<Link href={`/the-work/${u.origin_id}`} className="text-slate-500 hover:text-primary-600 transition-colors">
														({u.origin_name})
													</Link>
												) : (
													<span className="text-slate-500">({u.origin_name})</span>
												)
											)}
											<span className="font-medium text-slate-900 dark:text-slate-100">{u.author_name}</span>
											<span className="text-slate-500">{HEALTH_META[u.health].label}</span>
											<span className="text-slate-400">{relativeTime(u.created_at)}</span>
										</div>
										{u.body_md && <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 whitespace-pre-wrap"><LinkifiedText text={u.body_md} /></p>}
									</div>
									{/* Deleting is offered only on the item's own feed — a
									    rolled-up update belongs to the child that posted it. */}
									{!healthIsComputed && currentUserId && u.author_id === currentUserId && (
										<button
											type="button"
											onClick={() => handleDeleteUpdate(u.id)}
											className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity"
											title="Delete update"
										>
											<Trash2 className="w-3.5 h-3.5" />
										</button>
									)}
								</div>
							))}
						</div>
					)}
				</Card>

				{/* Children-as-milestones: goal→Priorities, priority→Projects,
				    project→Tasks. Each row shows its own rollup when it has
				    children of its own; leaf rows show their status instead. */}
				<Card>
					<div className="flex items-center justify-between mb-2">
						<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">{childMeta.plural}</div>
						<button
							type="button"
							onClick={() => setShowAddChild(!showAddChild)}
							className="text-xs text-slate-500 hover:text-primary-600 inline-flex items-center gap-1 transition-colors"
						>
							<Plus className="w-3.5 h-3.5" /> {childMeta.singular}
						</button>
					</div>

					{showAddChild && (
						<div className="mb-3 space-y-2">
							{/* Mode toggle: create new vs attach an existing item */}
							<div className="inline-flex items-center gap-0 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
								<button
									type="button"
									onClick={() => setAddMode('new')}
									className={`transition-colors px-2.5 py-1 ${addMode === 'new' ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
								>
									New
								</button>
								<button
									type="button"
									onClick={() => { setAddMode('existing'); if (attachResults.length === 0) handleAttachSearch(''); }}
									className={`transition-colors px-2.5 py-1 border-l border-slate-200 dark:border-slate-700 ${addMode === 'existing' ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
								>
									Existing
								</button>
							</div>

							{addMode === 'new' ? (
								<div className="flex items-center gap-2">
									<Input value={childName} onChange={(e) => setChildName(e.target.value)} placeholder={`${childMeta.singular} name`} autoFocus />
									<input
										type="date"
										value={childDate}
										onChange={(e) => setChildDate(e.target.value)}
										className="text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
									/>
									<Button onClick={handleAddChild} loading={childSaving} disabled={childSaving || !childName.trim()}>Add</Button>
								</div>
							) : (
								<div className="space-y-1.5">
									<Input
										value={attachQuery}
										onChange={(e) => handleAttachSearch(e.target.value)}
										placeholder={`Search existing ${childMeta.plural.toLowerCase()}…`}
										autoFocus
									/>
									{attachSearching && <div className="text-2xs text-slate-600 dark:text-slate-400">Searching…</div>}
									{!attachSearching && attachResults.length === 0 && (
										<div className="text-2xs text-slate-600 dark:text-slate-400 italic">No unattached {childMeta.plural.toLowerCase()} found.</div>
									)}
									{attachResults.map((r) => (
										<div key={r.id} className="flex items-center justify-between gap-2 text-sm rounded-md border border-slate-100 dark:border-slate-700/50 px-2 py-1.5">
											<span className="truncate text-slate-700 dark:text-slate-300">
												{r.name}
												{r.parent_id && r.parent_id !== item.id && (
													<span className="text-2xs text-amber-600 dark:text-amber-400 ml-1.5">(will move from another parent)</span>
												)}
											</span>
											<button
												type="button"
												onClick={() => handleAttach(r.id, r.name)}
												className="text-xs text-primary-600 hover:underline shrink-0"
											>
												Attach
											</button>
										</div>
									))}
								</div>
							)}
						</div>
					)}

					{childItems.length === 0 && !showAddChild ? (
						<div className="text-xs text-slate-400 italic py-2">
							No {childMeta.plural.toLowerCase()} yet. Break this {item.kind} down into {childMeta.plural.toLowerCase()} with target dates.
						</div>
					) : (
						<div className="space-y-1">
							{/* Tasks are single actions — checkbox + strike-through on
							    completion, no per-row progress bar (Sam, 2026-08-12).
							    Rows that have their own children keep the x/y count as
							    plain text for context. */}
							{childItems.map((c) => {
								const done = childDone[c.id] ?? c.is_terminal;
								return (
									<div key={c.id} className="group flex items-center gap-2.5 text-sm py-1">
										<button
											type="button"
											onClick={() => handleToggleChild(c, !done)}
											aria-label={done ? `Reopen ${c.name}` : `Mark ${c.name} done`}
											title={done ? 'Reopen' : 'Mark done'}
											className={`w-4 h-4 rounded-md border shrink-0 grid place-items-center transition-colors duration-200 ${
												done
													? 'bg-primary-500 border-primary-500 text-white'
													: 'border-slate-300 dark:border-slate-600 text-transparent hover:border-primary-500 hover:text-primary-400'
											}`}
										>
											<Check className="w-3 h-3" strokeWidth={3} />
										</button>
										<Link
											href={`/the-work/${c.id}`}
											className={`min-w-0 flex-1 truncate font-medium transition-all duration-300 ${
												done
													? 'line-through text-slate-400 dark:text-slate-500 opacity-60'
													: 'text-slate-900 dark:text-slate-100 group-hover:text-primary-600'
											}`}
										>
											{c.name}
										</Link>
										<span className={`text-2xs shrink-0 transition-opacity duration-300 ${done ? 'text-slate-600 dark:text-slate-400 opacity-60' : 'text-slate-500'}`}>
											{c.total > 0
												? `${c.done}/${c.total}`
												: (done ? (childStatusLabels.get(childDoneSlug) ?? 'Done') : (childStatusLabels.get(c.status) ?? c.status))}
											{c.ends_at ? <span title={formatDate(c.ends_at)}> · {formatShortDate(c.ends_at)}</span> : ''}
										</span>
									</div>
								);
							})}
						</div>
					)}
				</Card>

				{/* Attachments — per Sam 2026-08-10, files can be attached to any
				    work item (migration 0022 + storage bucket). Self-fetches its
				    own list, same pattern as the Children panel above. */}
				<Card>
					<AttachmentsPanel workItemId={item.id} />
				</Card>

				{/* Comments — conversation, distinct from Updates above (which
				    carry health and broadcast state). Both live on a project;
				    a goal gets comments plus its children's updates. */}
				{commentsSlot}

			</div>

			{/* ============ Sidebar: properties ============ */}
			<div className="space-y-4">
				{editMode ? (
					<Card>
						<div className="text-xs text-slate-500">
							Editing — status, priority, owner, lead, members, dates, quarter, and labels are all in the form on the left. Save or Cancel there to come back to this view.
						</div>
					</Card>
				) : (
				<Card>
					<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-3">Properties</div>
					{/* Status is the SAME control everywhere — Home popover, task
					    page, this page (spec: "the same chips, same action, same
					    appearance"). It replaced this card's old <select>. */}
					{statusOptions.length > 0 && (
						<div className="mb-3">
							<div className="text-slate-500 text-xs mb-1.5">Status</div>
							<DetailStatusChips
								itemId={item.id}
								kind={item.kind}
								currentStatus={item.status ?? ''}
								statuses={statusOptions.map((s) => ({ slug: s.slug, label: s.label }))}
							/>
						</div>
					)}
					<dl className="space-y-2.5 text-sm">
						<div className="flex items-center justify-between gap-2">
							<dt className="text-slate-500 text-xs inline-flex items-center gap-1"><Flag className="w-3 h-3" /> Priority</dt>
							<dd className="text-xs text-slate-700 dark:text-slate-300 capitalize">{item.priority ?? '—'}</dd>
						</div>
						<div className="flex items-center justify-between gap-2">
							<dt className="text-slate-500 text-xs inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> Owner</dt>
							<dd className="text-xs text-slate-700 dark:text-slate-300">{ownerName ?? '—'}</dd>
						</div>
						{leadName && (
							<div className="flex items-center justify-between gap-2">
								<dt className="text-slate-500 text-xs inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> Lead</dt>
								<dd className="text-xs text-slate-700 dark:text-slate-300">{leadName}</dd>
							</div>
						)}
						<div className="flex items-start justify-between gap-2">
							<dt className="text-slate-500 text-xs inline-flex items-center gap-1 mt-0.5"><Users className="w-3 h-3" /> Members</dt>
							<dd className="text-xs text-slate-700 dark:text-slate-300 text-right">
								{members.length === 0 ? '—' : members.map((m) => m.name).join(', ')}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-2">
							<dt className="text-slate-500 text-xs inline-flex items-center gap-1"><CalIcon className="w-3 h-3" /> Dates</dt>
							<dd className="text-xs text-slate-700 dark:text-slate-300">
								{item.starts_at ? formatDate(item.starts_at) : '…'} → {item.ends_at ? formatDate(item.ends_at) : '…'}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-2">
							<dt className="text-slate-500 text-xs">Quarter</dt>
							<dd className="text-xs text-slate-700 dark:text-slate-300">{quarterName ?? '—'}</dd>
						</div>
						<div className="flex items-start justify-between gap-2">
							<dt className="text-slate-500 text-xs inline-flex items-center gap-1 mt-0.5"><TagIcon className="w-3 h-3" /> Labels</dt>
							<dd className="flex flex-wrap gap-1 justify-end">
								{itemTagLabels.length === 0 ? <span className="text-xs text-slate-400">—</span> : itemTagLabels.map((t) => (
									<span key={t.id} className="text-2xs px-1.5 py-0 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
										style={t.color ? { borderLeft: `2px solid ${t.color}`, paddingLeft: 4 } : undefined}>
										{t.label}
									</span>
								))}
							</dd>
						</div>
					</dl>
				</Card>
				)}

				{/* Rail chassis — who's watching, and what has happened. Kept
				    outside the editMode branch above: editing fields is no
				    reason to hide the item's followers or its history. */}
				{followersSlot}
				{activitySlot}
			</div>
		</div>

		<ShortcutsHelpModal
			open={helpOpen}
			onClose={() => setHelpOpen(false)}
			items={[
				{ keys: 'E', label: 'Edit this item' },
				{ keys: 'A', label: 'Edit, focus Owner' },
				{ keys: 'S', label: 'Edit, focus Status' },
				{ keys: '?', label: 'Show this help' },
			]}
		/>
		</>
	);
}
