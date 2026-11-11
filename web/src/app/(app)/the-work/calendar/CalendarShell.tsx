'use client';

// CalendarShell — orchestrator for the calendar UI. Holds:
//   • view switcher (Day / Week / Month / Quarter)
//   • date pivot (prev/today/next, scoped to view granularity)
//   • Google Cal connection banner / status
//   • Sync now + Disconnect
//   • Right-side unscheduled-tasks sidebar (drag source)
//   • Calendar grid (drop target + click-to-create + click-to-edit)
//   • Top-right "Add event" button → drawer in create mode
//   • CalendarEventDrawer for create/edit
//
// Drag/drop: @dnd-kit. Dropping an unscheduled task onto a day column
// creates an event linked to that task at noon (Day/Week) or at 9am of
// that day (Month/Quarter cell-level drops).

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
	DndContext, PointerSensor, useSensor, useSensors, useDroppable, DragOverlay,
	type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import {
	Plug2, RefreshCw, Unplug, Plus, Plane,
	ChevronLeft, ChevronRight, MapPin,
	PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import GoogleCalConnect from './GoogleCalConnect';
import UnscheduledSidebar, { type UnscheduledTask } from './UnscheduledSidebar';
import CalendarEventDrawer, { type EventDraft } from './CalendarEventDrawer';
import UsersCalendarPicker, { type UserOption, userCalendarColor } from './UsersCalendarPicker';
import { scheduleTaskAt, moveOrResizeEvent } from './actions';
import { FALLBACK_COLOR } from '@/lib/colors';

type ViewMode = 'day' | 'week' | 'month' | 'quarter';

interface Connection {
	id: string;
	google_account_email: string | null;
	last_synced_at: string | null;
	sync_status: string | null;
	sync_error: string | null;
	bidirectional: boolean;
}
interface CalEvent {
	id: string; user_id: string | null;
	title: string; starts_at: string; ends_at: string | null;
	all_day: boolean | null; category_key: string | null; source: string;
	location: string | null; url: string | null;
	attendee_external: string[] | null;
	description_md: string | null;
	project_id: string | null;
	visibility: string | null;
}
interface Category { key: string; label: string; color: string | null }

interface Props {
	view: ViewMode;
	refDate: string;
	windowStart: string;
	windowEnd: string;
	events: CalEvent[];
	categories: Category[];
	connections: Connection[];
	unscheduled: UnscheduledTask[];
	taskOptions: { id: string; name: string; kind: string }[];
	profiles: UserOption[];
	selfId: string;
	otherUserIds: string[];
}

const DAY_HOURS = 24;
const SLOT_MIN = 5;           // 5-minute snap for click + drag-resize
const ROW_HEIGHT_DEFAULT = 40;
const ROW_HEIGHT_MIN = 18;
const ROW_HEIGHT_MAX = 96;
const AUTO_SYNC_INTERVAL_MS = 10 * 60_000;       // every 10 min

/** Local-date YYYY-MM-DD. Critical: never use toISOString().slice(0,10)
 *  for day bucketing — that returns UTC date, which rolls events created
 *  in the evening (local) onto the next day when grouped against a column
 *  whose date is computed in local time. */
function localDateKey(value: string | Date): string {
	const d = typeof value === 'string' ? new Date(value) : value;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CalendarShell({
	view, refDate, events, categories, connections,
	unscheduled, taskOptions, profiles, selfId, otherUserIds,
}: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const [, startTransition] = useTransition();
	void startTransition;

	const [syncing, setSyncing] = useState(false);
	const [syncResult, setSyncResult] = useState<string | null>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
	const [drawerDraft, setDrawerDraft] = useState<EventDraft | null>(null);
	const [rowHeight, setRowHeight] = useState<number>(ROW_HEIGHT_DEFAULT);  // wheel-zoomable hour height

	// Optimistic UI: events the user just created (drop-to-schedule) appear
	// instantly while the server action + Google push run in the background.
	// Events the user just deleted vanish from the grid before the round trip
	// finishes. Both buckets clear automatically when the server refresh
	// brings the canonical event list back.
	const [optimisticEvents, setOptimisticEvents] = useState<CalEvent[]>([]);
	const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
	useEffect(() => {
		setOptimisticEvents([]);
		setRemovedIds(new Set());
	}, [events]);

	const visibleEvents = events.filter((e) => !removedIds.has(e.id)).concat(optimisticEvents);

	const isConnected = connections.length > 0;
	const conn = connections[0];
	const catMap = new Map(categories.map((c) => [c.key, c]));
	const refDateObj = new Date(refDate);

	// ----- Navigation
	function navigate(delta: number) {
		const d = new Date(refDateObj);
		if (view === 'day')     d.setDate(d.getDate() + delta);
		if (view === 'week')    d.setDate(d.getDate() + delta * 7);
		if (view === 'month')   d.setMonth(d.getMonth() + delta);
		if (view === 'quarter') d.setMonth(d.getMonth() + delta * 3);
		setURL({ date: d.toISOString().slice(0, 10) });
	}
	function gotoToday() { setURL({ date: null }); }
	function setView(v: ViewMode) { setURL({ view: v === 'week' ? null : v }); }
	function setURL(updates: Record<string, string | null>) {
		const params = new URLSearchParams();
		if (view !== 'week') params.set('view', view);
		const refIso = refDateObj.toISOString().slice(0, 10);
		if (refIso !== new Date().toISOString().slice(0, 10)) params.set('date', refIso);
		for (const [k, v] of Object.entries(updates)) {
			if (v) params.set(k, v); else params.delete(k);
		}
		router.push(`${pathname}?${params.toString()}`);
	}

	// ----- Sync (manual button: full refetch; auto-sync stays incremental)
	async function handleSync() {
		setSyncing(true); setSyncResult(null);
		try {
			const r = await fetch('/api/integrations/google-cal/sync?full=1', { method: 'POST' });
			const json = await r.json();
			if (!r.ok) throw new Error(json.error ?? 'Sync failed');
			setSyncResult(`Synced ${json.upserted ?? 0} events · attributed ${json.attributed ?? 0}`);
			router.refresh();
		} catch (e) {
			setSyncResult(e instanceof Error ? e.message : 'Sync error');
		} finally { setSyncing(false); }
	}

	// ----- Auto-sync: once on mount + every 10 min while the tab is open
	useEffect(() => {
		if (!isConnected) return;
		let cancelled = false;
		async function runSync() {
			if (cancelled || document.hidden) return;
			try {
				const r = await fetch('/api/integrations/google-cal/sync', { method: 'POST' });
				if (!r.ok) return;
				const json = await r.json();
				if (cancelled) return;
				if ((json.upserted ?? 0) > 0) router.refresh();
			} catch { /* silent — manual Sync button surfaces errors */ }
		}
		runSync();
		const id = setInterval(runSync, AUTO_SYNC_INTERVAL_MS);
		return () => { cancelled = true; clearInterval(id); };
	}, [isConnected, router]);
	async function handleDisconnect() {
		if (!confirm('Disconnect Google Calendar? Synced events stay; updates stop.')) return;
		setSyncing(true);
		try {
			await fetch('/api/integrations/google-cal/disconnect', { method: 'POST' });
			router.refresh();
		} finally { setSyncing(false); }
	}

	// ----- Drawer
	function openCreateAt(date: Date, durationMin = 60) {
		const ends = new Date(date.getTime() + durationMin * 60_000);
		setDrawerMode('create');
		setDrawerDraft({ starts_at: date.toISOString(), ends_at: ends.toISOString() });
		setDrawerOpen(true);
	}
	function openCreateBlank() {
		const now = new Date();
		now.setMinutes(0, 0, 0);
		now.setHours(now.getHours() + 1);
		openCreateAt(now);
	}
	function openEditEvent(ev: CalEvent) {
		// Trip chips (0111) are read-only projections of `trips`; edits happen
		// on the trips page, not in the event drawer.
		if (ev.source === 'trip') {
			router.push(ev.url ?? '/the-work/calendar/trips');
			return;
		}
		setDrawerMode('edit');
		setDrawerDraft({
			id: ev.id,
			title: ev.title,
			description_md: ev.description_md,
			starts_at: ev.starts_at,
			ends_at: ev.ends_at ?? ev.starts_at,
			all_day: ev.all_day ?? false,
			category_key: ev.category_key,
			location: ev.location,
			project_id: ev.project_id,
		});
		setDrawerOpen(true);
	}

	// ----- Drag & drop wiring (sidebar tasks → calendar slots)
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	// Live cursor tracked during drag — used at drop time to compute the
	// exact minute under the cursor regardless of which scroll container
	// the cursor ended up in. dnd-kit's cached rects can lag behind scroll.
	const lastCursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
	const [activeTask, setActiveTask] = useState<UnscheduledTask | null>(null);

	function handleDragStart(ev: DragStartEvent) {
		const data = ev.active.data.current as { kind?: string; taskId?: string } | undefined;
		if (data?.kind === 'unscheduled-task' && data.taskId) {
			const t = unscheduled.find((u) => u.id === data.taskId);
			if (t) setActiveTask(t);
		}
		const a = ev.activatorEvent as MouseEvent;
		lastCursorRef.current = { x: a.clientX, y: a.clientY };
		window.addEventListener('mousemove', trackCursor);
	}
	function trackCursor(e: MouseEvent) {
		lastCursorRef.current = { x: e.clientX, y: e.clientY };
	}

	async function handleDragEnd(ev: DragEndEvent) {
		window.removeEventListener('mousemove', trackCursor);
		setActiveTask(null);
		const activeData = ev.active.data.current as { kind?: string; taskId?: string } | undefined;
		if (activeData?.kind !== 'unscheduled-task' || !activeData.taskId) {
			console.warn('[drop] ignored — active is not an unscheduled task', activeData);
			return;
		}

		const { x, y } = lastCursorRef.current;
		console.log('[drop] cursor at', x, y);
		const hit = document.elementFromPoint(x, y);
		// Walk through any pointer-events-none overlays that might be above
		// the column (DragOverlay wrapper, etc.) by temporarily hiding them.
		// Failsafe: also use elementsFromPoint (plural) and find the first
		// element with [data-day-column] in the stack.
		let colNode: HTMLElement | null = (hit as HTMLElement | null)?.closest('[data-day-column]') ?? null;
		if (!colNode) {
			const stack = document.elementsFromPoint(x, y);
			for (const el of stack) {
				const c = (el as HTMLElement).closest('[data-day-column]') as HTMLElement | null;
				if (c) { colNode = c; break; }
			}
		}
		if (!colNode) {
			console.warn('[drop] no day column under cursor — likely dropped outside the grid');
			setSyncResult('Drop missed a day column — try again over the calendar grid.');
			setTimeout(() => setSyncResult(null), 4000);
			return;
		}
		const dateStr = colNode.getAttribute('data-date');
		if (!dateStr) {
			console.warn('[drop] column missing data-date attr', colNode);
			return;
		}

		const colRect = colNode.getBoundingClientRect();
		const yWithinCol = y - colRect.top;
		const pxPerMin = rowHeight / 60;
		const minute = Math.max(0, Math.min(24 * 60 - SLOT_MIN,
			Math.round(yWithinCol / pxPerMin / SLOT_MIN) * SLOT_MIN));
		const baseDate = new Date(`${dateStr}T00:00:00`);
		baseDate.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
		console.log('[drop] target', dateStr, 'minute', minute, '→', baseDate.toString());

		// Optimistic: paint the event on the grid immediately. The activeTask
		// state still holds the dragged item's metadata (cleared above), so
		// re-read it from the unscheduled list by id.
		const task = unscheduled.find((u) => u.id === activeData.taskId);
		const tempId = `pending-${Date.now()}`;
		const startIso = baseDate.toISOString();
		const endIso = new Date(baseDate.getTime() + 60 * 60_000).toISOString();
		if (task) {
			setOptimisticEvents((prev) => [...prev, {
				id: tempId,
				user_id: selfId,
				title: task.name,
				starts_at: startIso,
				ends_at: endIso,
				all_day: false,
				category_key: 'focus_block',
				source: 'manual',
				location: null,
				url: null,
				attendee_external: [],
				description_md: null,
				project_id: task.id,
				visibility: 'default',
			}]);
		}

		const res = await scheduleTaskAt({ work_item_id: activeData.taskId, starts_at: startIso });
		if (!res.ok) {
			console.error('[drop] scheduleTaskAt failed:', res.error);
			setOptimisticEvents((prev) => prev.filter((e) => e.id !== tempId));
			setSyncResult(`Schedule failed: ${res.error}`);
			setTimeout(() => setSyncResult(null), 6000);
			return;
		}
		console.log('[drop] created event', res.id);
		router.refresh();
	}

	return (
		<DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
			<div className="space-y-3">
				{/* Connect banner */}
				{!isConnected && (
					<Card>
						<div className="flex items-center justify-between gap-3 flex-wrap">
							<div className="flex items-start gap-3">
								<div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center text-primary-600 dark:text-primary-400 shrink-0">
									<Plug2 className="w-5 h-5" />
								</div>
								<div>
									<h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Connect Google Calendar</h3>
									<p className="text-xs text-slate-500 mt-0.5 max-w-md">
										Bidirectional sync + AI time attribution.
									</p>
								</div>
							</div>
							<GoogleCalConnect onConnected={() => router.refresh()} />
						</div>
					</Card>
				)}
				{isConnected && (
					<div className="flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
						<span className="inline-flex items-center gap-1.5">
							<span className={`w-1.5 h-1.5 rounded-full ${conn?.sync_status === 'ok' ? 'bg-green-500' : conn?.sync_status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
							{conn?.google_account_email ?? 'Google account'}
							{conn?.last_synced_at && <> · last sync {new Date(conn.last_synced_at).toLocaleString()}</>}
							{conn?.sync_error && <span className="text-red-600"> · {conn.sync_error}</span>}
						</span>
						<div className="flex items-center gap-2">
							{syncResult && <span className="text-2xs text-slate-600 dark:text-slate-400">{syncResult}</span>}
							<button onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 transition-colors">
								<RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing…' : 'Sync now'}
							</button>
							<button onClick={handleDisconnect} disabled={syncing} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition-colors">
								<Unplug className="w-3.5 h-3.5" /> Disconnect
							</button>
						</div>
					</div>
				)}

				{/* Toolbar */}
				<div className="flex items-center justify-between gap-2 flex-wrap">
					<div className="flex items-center gap-3">
						<h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
							{windowLabel(view, refDateObj)}
						</h1>
						<div className="inline-flex items-center gap-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
							<button onClick={() => navigate(-1)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700/45 rounded-l-md text-slate-500 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
							<button onClick={gotoToday} className="text-xs px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/45 text-slate-600 dark:text-slate-400 transition-colors">Today</button>
							<button onClick={() => navigate(1)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700/45 rounded-r-md text-slate-500 transition-colors"><ChevronRight className="w-4 h-4" /></button>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<div className="inline-flex items-center gap-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden text-xs">
							{(['day','week','month','quarter'] as const).map((v) => (
								<button
									key={v}
									onClick={() => setView(v)}
									className={`transition-colors px-2.5 py-1.5 ${view === v ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50'} ${v !== 'day' ? 'border-l border-slate-200 dark:border-slate-700' : ''}`}
								>
									{v[0].toUpperCase() + v.slice(1)}
								</button>
							))}
						</div>
						<button
							onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
							className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors"
							title={sidebarCollapsed ? 'Show unscheduled tasks' : 'Hide unscheduled tasks'}
						>
							{sidebarCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
						</button>
						<UsersCalendarPicker users={profiles} selectedIds={otherUserIds} selfId={selfId} />
						<Button variant="outline" onClick={() => router.push('/the-work/calendar/trips')} className="gap-1" title="Trips and travel">
							<Plane className="w-4 h-4" /> Trips
						</Button>
						<Button onClick={openCreateBlank} className="gap-1">
							<Plus className="w-4 h-4" /> Add event
						</Button>
					</div>
				</div>

				<div className="flex gap-3 min-h-[600px]">
					<div className="flex-1 min-w-0">
						{view === 'day' && (() => {
							// Day view + other users selected → split into per-user columns
							const visibleUsers = [
								profiles.find((p) => p.id === selfId) ?? { id: selfId, first_name: 'Me', last_name: null, email: '' },
								...otherUserIds.map((id) => profiles.find((p) => p.id === id)).filter((u): u is UserOption => !!u),
							];
							const columns = visibleUsers.length > 1
								? visibleUsers.map((u) => ({ date: refDateObj, user: u }))
								: [{ date: refDateObj, user: null as UserOption | null }];
							return <TimeGrid columns={columns} events={visibleEvents} catMap={catMap} selfId={selfId} rowHeight={rowHeight} onZoom={setRowHeight} onSlotClick={openCreateAt} onEventClick={openEditEvent} onRefresh={() => router.refresh()} />;
						})()}
						{view === 'week' && (
							<TimeGrid columns={daysOfWeek(refDateObj).map((d) => ({ date: d, user: null }))} events={visibleEvents} catMap={catMap} selfId={selfId} rowHeight={rowHeight} onZoom={setRowHeight} onSlotClick={openCreateAt} onEventClick={openEditEvent} onRefresh={() => router.refresh()} />
						)}
						{view === 'month' && (
							<MonthGrid refDate={refDateObj} events={visibleEvents} catMap={catMap} onDayClick={openCreateAt} onEventClick={openEditEvent} />
						)}
						{view === 'quarter' && (
							<QuarterGrid refDate={refDateObj} events={visibleEvents} catMap={catMap} onDayClick={openCreateAt} onEventClick={openEditEvent} />
						)}
					</div>
					{!sidebarCollapsed && (
						<UnscheduledSidebar tasks={unscheduled} />
					)}
				</div>
			</div>

			<CalendarEventDrawer
				open={drawerOpen}
				mode={drawerMode}
				draft={drawerDraft}
				categories={categories}
				taskOptions={taskOptions}
				onClose={() => setDrawerOpen(false)}
				onSaved={() => { setDrawerOpen(false); router.refresh(); }}
				onOptimisticDelete={(id) => {
					// Hide the event in the grid immediately so the user sees
					// instant feedback. Return a rollback that puts it back if
					// the server delete ultimately fails.
					setRemovedIds((prev) => new Set(prev).add(id));
					return () => setRemovedIds((prev) => {
						const next = new Set(prev);
						next.delete(id);
						return next;
					});
				}}
			/>

			{/* DragOverlay = a portaled clone that follows the cursor exactly.
			    Without it the dragged chip is positioned inside its parent
			    container's coordinate space, which is wrong for chips dragged
			    from the scroll-isolated sidebar. */}
			<DragOverlay dropAnimation={null}>
				{activeTask && (
					<div className="rounded-md border border-primary-300 bg-white dark:bg-slate-900 shadow-panel p-2 w-56 cursor-grabbing pointer-events-none">
						<div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{activeTask.name}</div>
						<div className="text-2xs text-slate-600 dark:text-slate-400">{activeTask.kind}{activeTask.parent_name ? ` · ${activeTask.parent_name}` : ''}</div>
					</div>
				)}
			</DragOverlay>
		</DndContext>
	);
}

// ===========================================================================
// TimeGrid — Day or Week view. 24-hour vertical scroll. Click empty cell to
// create an event at that 30-min slot. Each day column is a drop target.
// ===========================================================================

interface TimeGridColumn { date: Date; user: UserOption | null }
interface TimeGridProps {
	columns: TimeGridColumn[];
	events: CalEvent[];
	catMap: Map<string, Category>;
	selfId: string;
	rowHeight: number;
	onZoom: (next: number) => void;
	onSlotClick: (d: Date) => void;
	onEventClick: (ev: CalEvent) => void;
	onRefresh: () => void;
}

function TimeGrid({ columns, events, catMap, selfId, rowHeight, onZoom, onSlotClick, onEventClick, onRefresh }: TimeGridProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Scroll to 7am on mount
	useEffect(() => {
		if (containerRef.current) containerRef.current.scrollTop = rowHeight * 7;
		// run once on mount, deliberately ignore rowHeight changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Live "now" tick — re-renders the now-marker once a minute
	const [, force] = useState(0);
	useEffect(() => {
		const id = setInterval(() => force((n) => n + 1), 60_000);
		return () => clearInterval(id);
	}, []);

	const now = new Date();

	// Group events by column using LOCAL date keys so evening events don't
	// roll onto the next day's column.
	const eventsByColumn = columns.map((col) => {
		const colKey = localDateKey(col.date);
		return events.filter((e) => localDateKey(e.starts_at) === colKey && (!col.user || e.user_id === col.user.id));
	});

	const cols = columns.length;

	function onHourWheel(e: React.WheelEvent<HTMLDivElement>) {
		if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
			// Only zoom when wheeling on the hour rail itself (not the columns)
			const target = e.target as HTMLElement;
			if (!target.closest('[data-hour-rail]')) return;
		}
		e.preventDefault();
		const step = e.deltaY > 0 ? -4 : 4;
		onZoom(Math.max(ROW_HEIGHT_MIN, Math.min(ROW_HEIGHT_MAX, rowHeight + step)));
	}

	return (
		<Card padding="none">
			{/* Header row */}
			<div className="grid" style={{ gridTemplateColumns: `56px repeat(${cols}, minmax(0,1fr))` }}>
				<div className="px-2 py-2 text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 text-center border-b border-slate-200 dark:border-slate-700">Time</div>
				{columns.map((col, idx) => {
					const isToday = col.date.toDateString() === new Date().toDateString();
					const userLabel = col.user
						? ([col.user.first_name, col.user.last_name].filter(Boolean).join(' ') || col.user.email)
						: null;
					return (
						<div key={idx} className={`px-2 py-1.5 text-center border-l border-b border-slate-200 dark:border-slate-700 ${isToday ? 'bg-primary-50 dark:bg-primary-950/30' : ''}`}>
							{userLabel ? (
								<>
									<div className="text-2xs font-medium text-slate-700 dark:text-slate-300 truncate inline-flex items-center justify-center gap-1">
										<span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: col.user!.id === selfId ? '#22c55e' : userCalendarColor(col.user!.id) }} />
										{userLabel}
									</div>
									<div className={`text-2xs ${isToday ? 'text-primary-700 dark:text-primary-300' : 'text-slate-600 dark:text-slate-400'}`}>
										{col.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
									</div>
								</>
							) : (
								<>
									<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">{col.date.toLocaleDateString(undefined, { weekday: 'short' })}</div>
									<div className={`text-base font-medium ${isToday ? 'text-primary-700 dark:text-primary-300' : 'text-slate-900 dark:text-slate-100'}`}>{col.date.getDate()}</div>
								</>
							)}
						</div>
					);
				})}
			</div>

			{/* All-day chips row */}
			<div className="grid border-b border-slate-200 dark:border-slate-700" style={{ gridTemplateColumns: `56px repeat(${cols}, minmax(0,1fr))` }}>
				<div className="px-2 py-1 text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 text-right">All-day</div>
				{columns.map((col, idx) => {
					const allDay = eventsByColumn[idx].filter((e) => e.all_day);
					return (
						<div key={idx} className="border-l border-slate-200 dark:border-slate-700 px-1 py-1 min-h-[28px] space-y-0.5">
							{allDay.map((e) => (
								<button
									key={e.id}
									onClick={() => onEventClick(e)}
									className="block w-full text-left text-2xs px-1.5 py-0.5 rounded-md truncate hover:opacity-80"
									style={{ backgroundColor: hexAlpha(catMap.get(e.category_key ?? '')?.color ?? FALLBACK_COLOR, 0.18) }}
								>
									{maskTitle(e, selfId)}
								</button>
							))}
						</div>
					);
				})}
			</div>

			{/* Scrollable time grid */}
			<div ref={containerRef} className="overflow-y-auto" style={{ maxHeight: '70vh' }} onWheel={onHourWheel}>
				<div className="grid" style={{ gridTemplateColumns: `56px repeat(${cols}, minmax(0,1fr))`, minHeight: rowHeight * DAY_HOURS }}>
					{/* Hour ruler — scroll on this with no modifier to zoom */}
					<div data-hour-rail className="relative">
						{Array.from({ length: DAY_HOURS }).map((_, i) => (
							<div key={i} style={{ height: rowHeight }} className="text-2xs text-slate-600 dark:text-slate-400 text-right pr-1.5 pt-0.5 border-t border-slate-100 dark:border-slate-700/50 select-none">
								{formatHour(i)}
							</div>
						))}
					</div>
					{columns.map((col, idx) => {
						const isToday = col.date.toDateString() === now.toDateString();
						const timed = eventsByColumn[idx].filter((e) => !e.all_day);
						return (
							<DayColumn
								key={idx}
								date={col.date}
								events={timed}
								catMap={catMap}
								selfId={selfId}
								rowHeight={rowHeight}
								showNowMarker={isToday}
								now={now}
								onSlotClick={onSlotClick}
								onEventClick={onEventClick}
								onRefresh={onRefresh}
							/>
						);
					})}
				</div>
			</div>

			<div className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 flex items-center gap-3">
				<span>Scroll on the hour column to zoom · Drag event body to move · Drag edges to resize · Click slot to create</span>
				<span className="ml-auto">{rowHeight}px/hr</span>
			</div>
		</Card>
	);
}

function maskTitle(e: CalEvent, selfId: string): string {
	if (e.visibility === 'private' && e.user_id !== selfId) return 'Private';
	return e.title;
}

function DayColumn({
	date, events, catMap, selfId, rowHeight, showNowMarker, now, onSlotClick, onEventClick, onRefresh,
}: {
	date: Date;
	events: CalEvent[];
	catMap: Map<string, Category>;
	selfId: string;
	rowHeight: number;
	showNowMarker: boolean;
	now: Date;
	onSlotClick: (d: Date) => void;
	onEventClick: (ev: CalEvent) => void;
	onRefresh: () => void;
}) {
	function slotClick(e: React.MouseEvent<HTMLDivElement>) {
		if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const minute = Math.max(0, Math.round(y / (rowHeight / 60) / SLOT_MIN) * SLOT_MIN);
		const start = new Date(date);
		start.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
		onSlotClick(start);
	}

	const noonOfDay = new Date(date); noonOfDay.setHours(12, 0, 0, 0);
	const { setNodeRef: setDropRef, isOver } = useDroppable({
		id: `slot:${localDateKey(date)}`,
		data: { kind: 'slot', date: noonOfDay.toISOString() },
	});

	const positioned = assignLanes(events);

	const nowTop = showNowMarker
		? (now.getHours() * 60 + now.getMinutes()) * (rowHeight / 60)
		: -1;

	return (
		<div
			ref={setDropRef}
			data-day-column
			data-date={localDateKey(date)}
			onClick={slotClick}
			className={`relative border-l border-slate-200 dark:border-slate-700 cursor-pointer ${isOver ? 'bg-primary-50/40 dark:bg-primary-950/20' : ''}`}
		>
			{Array.from({ length: DAY_HOURS }).map((_, i) => (
				<div key={i} style={{ height: rowHeight }} className="border-t border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors" />
			))}
			{showNowMarker && (
				<div
					className="absolute left-0 right-0 z-20 pointer-events-none"
					style={{ top: nowTop }}
				>
					<div className="h-0.5 bg-red-500" />
					<div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-500" />
				</div>
			)}
			{positioned.map(({ event: e, lane, lanesInGroup }) => (
				<EventChip
					key={e.id}
					event={e}
					lane={lane}
					lanesInGroup={lanesInGroup}
					catMap={catMap}
					selfId={selfId}
					rowHeight={rowHeight}
					onClick={() => onEventClick(e)}
					onRefresh={onRefresh}
				/>
			))}
		</div>
	);
}

// =================================================================
// EventChip — renders one event, owns the resize-by-drag handle.
// =================================================================

function EventChip({
	event: e, lane, lanesInGroup, catMap, selfId, rowHeight, onClick, onRefresh,
}: {
	event: CalEvent;
	lane: number;
	lanesInGroup: number;
	catMap: Map<string, Category>;
	selfId: string;
	rowHeight: number;
	onClick: () => void;
	onRefresh: () => void;
}) {
	// Drag/resize state lives in refs + direct DOM style so we don't trigger
	// a React re-render on every mousemove. setState is reserved for the
	// final commit at mouseup (and the cursor/grab visual which doesn't
	// need to be per-frame).
	const chipRef = useRef<HTMLDivElement | null>(null);
	const [grabbing, setGrabbing] = useState(false);

	const isMine = e.user_id === selfId;
	const isPrivateMasked = e.visibility === 'private' && !isMine;
	const displayTitle = isPrivateMasked ? 'Private' : e.title;
	const baseColor = isMine
		? (catMap.get(e.category_key ?? '')?.color ?? FALLBACK_COLOR)
		: userCalendarColor(e.user_id ?? '');

	const { top: baseTop, height: baseHeight } = pixelize(e, rowHeight);
	const widthPct = 100 / lanesInGroup;
	const leftPct = lane * widthPct;

	function handleResizeStart(edge: 'top' | 'bottom', startEvt: React.MouseEvent) {
		if (!isMine || !chipRef.current) return;
		startEvt.stopPropagation();
		startEvt.preventDefault();
		const originY = startEvt.clientY;
		const pxPerMin = rowHeight / 60;
		const node = chipRef.current;
		let snappedMin = 0;
		let raf = 0;

		function paint() {
			raf = 0;
			if (!node) return;
			if (edge === 'bottom') {
				node.style.height = `${Math.max(rowHeight * (SLOT_MIN / 60), baseHeight + snappedMin * pxPerMin)}px`;
			} else {
				node.style.top = `${baseTop + snappedMin * pxPerMin}px`;
				node.style.height = `${baseHeight - snappedMin * pxPerMin}px`;
			}
		}
		function onMove(ev: MouseEvent) {
			const dy = ev.clientY - originY;
			snappedMin = Math.round(dy / pxPerMin / SLOT_MIN) * SLOT_MIN;
			if (!raf) raf = requestAnimationFrame(paint);
		}
		async function onUp() {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			if (raf) cancelAnimationFrame(raf);
			// Reset inline styles so React re-render takes over after refresh
			node.style.height = '';
			node.style.top = '';
			if (snappedMin === 0) return;
			const start = new Date(e.starts_at);
			const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 30 * 60_000);
			let newStart = start; let newEnd = end;
			if (edge === 'bottom') newEnd = new Date(end.getTime() + snappedMin * 60_000);
			if (edge === 'top')    newStart = new Date(start.getTime() + snappedMin * 60_000);
			if (newEnd <= newStart) return;
			await moveOrResizeEvent({ id: e.id, starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() });
			onRefresh();
		}
		window.addEventListener('mousemove', onMove, { passive: true });
		window.addEventListener('mouseup', onUp);
	}

	function handleMoveStart(startEvt: React.MouseEvent) {
		if (!isMine || !chipRef.current) return;
		if ((startEvt.target as HTMLElement).closest('[data-resize-handle]')) return;
		startEvt.stopPropagation();
		const originY = startEvt.clientY;
		const pxPerMin = rowHeight / 60;
		const node = chipRef.current;
		const dragThresholdPx = 6;
		let dragStarted = false;
		let snappedMin = 0;
		let raf = 0;

		function paint() {
			raf = 0;
			if (!node) return;
			node.style.transform = `translateY(${snappedMin * pxPerMin}px)`;
		}
		function onMove(ev: MouseEvent) {
			const dy = ev.clientY - originY;
			if (!dragStarted && Math.abs(dy) < dragThresholdPx) return;
			if (!dragStarted) {
				dragStarted = true;
				setGrabbing(true);
				node.style.zIndex = '30';
				node.style.willChange = 'transform';
			}
			snappedMin = Math.round(dy / pxPerMin / SLOT_MIN) * SLOT_MIN;
			if (!raf) raf = requestAnimationFrame(paint);
		}
		async function onUp() {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			if (raf) cancelAnimationFrame(raf);
			setGrabbing(false);
			node.style.transform = '';
			node.style.zIndex = '';
			node.style.willChange = '';
			if (!dragStarted) { onClick(); return; }
			if (snappedMin === 0) return;
			const start = new Date(e.starts_at);
			const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 30 * 60_000);
			const newStart = new Date(start.getTime() + snappedMin * 60_000);
			const newEnd   = new Date(end.getTime()   + snappedMin * 60_000);
			await moveOrResizeEvent({ id: e.id, starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() });
			onRefresh();
		}
		window.addEventListener('mousemove', onMove, { passive: true });
		window.addEventListener('mouseup', onUp);
	}

	return (
		<div
			ref={chipRef}
			data-event-chip
			onMouseDown={(ev) => isMine ? handleMoveStart(ev) : undefined}
			onClick={(ev) => { ev.stopPropagation(); if (!isMine) onClick(); }}
			className="absolute rounded-sm overflow-hidden group select-none"
			style={{
				top: baseTop,
				height: baseHeight,
				left: `calc(${leftPct}% + 2px)`,
				width: `calc(${widthPct}% - 4px)`,
				backgroundColor: hexAlpha(baseColor, isPrivateMasked ? 0.10 : 0.18),
				borderLeft: `2px solid ${baseColor}`,
				cursor: isMine ? (grabbing ? 'grabbing' : 'grab') : 'pointer',
			}}
			title={isPrivateMasked ? 'Private · time blocked' : `${e.title}\n${new Date(e.starts_at).toLocaleString()}${e.location ? `\n${e.location}` : ''}${!isMine ? '\n(shared from teammate)' : ''}`}
		>
			{isMine && (
				<div
					data-resize-handle
					onMouseDown={(ev) => handleResizeStart('top', ev)}
					className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-primary-500/40 z-10 transition-colors"
				/>
			)}
			<div className="block w-full h-full text-left px-1.5 py-0.5 text-2xs pointer-events-none">
				<div className={`font-medium truncate ${isPrivateMasked ? 'italic text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}>{displayTitle}</div>
				{baseHeight >= 30 && !isPrivateMasked && (
					<div className="text-slate-500 truncate">
						{new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
						{!isMine && <span className="ml-1 text-slate-400">· shared</span>}
					</div>
				)}
				{e.location && baseHeight >= 50 && !isPrivateMasked && (
					<div className="text-slate-500 truncate inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {e.location}</div>
				)}
			</div>
			{isMine && (
				<div
					data-resize-handle
					onMouseDown={(ev) => handleResizeStart('bottom', ev)}
					className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-primary-500/40 z-10 transition-colors"
				/>
			)}
		</div>
	);
}

// =================================================================
// Lane assignment algo for side-by-side overlap rendering.
// Returns each event with its lane index + how many lanes are in
// the same overlap group (so width = 1/lanesInGroup).
// =================================================================

interface Positioned { event: CalEvent; lane: number; lanesInGroup: number }

function assignLanes(events: CalEvent[]): Positioned[] {
	// Sort by start ascending, then duration desc (longer events get earlier lane)
	const sorted = [...events].sort((a, b) => {
		const sa = new Date(a.starts_at).getTime();
		const sb = new Date(b.starts_at).getTime();
		if (sa !== sb) return sa - sb;
		const ea = a.ends_at ? new Date(a.ends_at).getTime() : sa + 30 * 60_000;
		const eb = b.ends_at ? new Date(b.ends_at).getTime() : sb + 30 * 60_000;
		return (eb - sb) - (ea - sa);
	});

	const result: Positioned[] = [];
	let group: Positioned[] = [];
	let groupEnd = 0;

	function flush() {
		const max = Math.max(1, ...group.map((p) => p.lane + 1));
		for (const p of group) p.lanesInGroup = max;
		result.push(...group);
		group = [];
		groupEnd = 0;
	}

	for (const ev of sorted) {
		const start = new Date(ev.starts_at).getTime();
		const end = ev.ends_at ? new Date(ev.ends_at).getTime() : start + 30 * 60_000;

		if (start >= groupEnd) flush();

		// Find leftmost lane where the last event ended ≤ this event's start
		const lanesUsed = new Set<number>();
		for (const p of group) {
			const pEnd = p.event.ends_at ? new Date(p.event.ends_at).getTime() : new Date(p.event.starts_at).getTime() + 30 * 60_000;
			if (pEnd > start) lanesUsed.add(p.lane);
		}
		let lane = 0;
		while (lanesUsed.has(lane)) lane++;

		group.push({ event: ev, lane, lanesInGroup: 1 });
		if (end > groupEnd) groupEnd = end;
	}
	flush();
	return result;
}

// ===========================================================================
// MonthGrid — standard 7×5 (or 6) calendar grid. Each cell = one day.
// ===========================================================================

function MonthGrid({
	refDate, events, catMap, onDayClick, onEventClick,
}: {
	refDate: Date;
	events: CalEvent[];
	catMap: Map<string, Category>;
	onDayClick: (d: Date) => void;
	onEventClick: (ev: CalEvent) => void;
}) {
	const first = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
	const last = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
	const startOffset = (first.getDay() + 6) % 7;       // Monday = 0
	const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;
	const gridStart = new Date(first); gridStart.setDate(first.getDate() - startOffset);

	const eventsByDay = new Map<string, CalEvent[]>();
	for (const ev of events) {
		const key = localDateKey(ev.starts_at);
		const arr = eventsByDay.get(key) ?? [];
		arr.push(ev);
		eventsByDay.set(key, arr);
	}

	const cells: Date[] = Array.from({ length: totalCells }).map((_, i) => {
		const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d;
	});

	return (
		<Card padding="none">
			<div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
				{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label) => (
					<div key={label} className="px-2 py-1.5 text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 text-center border-r last:border-r-0 border-slate-200 dark:border-slate-700">{label}</div>
				))}
			</div>
			<div className="grid grid-cols-7" style={{ minHeight: 'calc(70vh - 36px)' }}>
				{cells.map((d) => {
					const key = localDateKey(d);
					const isCurrentMonth = d.getMonth() === refDate.getMonth();
					const isToday = d.toDateString() === new Date().toDateString();
					const dayEvents = eventsByDay.get(key) ?? [];
					return (
						<MonthCell
							key={key}
							date={d}
							isCurrentMonth={isCurrentMonth}
							isToday={isToday}
							events={dayEvents}
							catMap={catMap}
							onDayClick={onDayClick}
							onEventClick={onEventClick}
						/>
					);
				})}
			</div>
		</Card>
	);
}

function MonthCell({
	date, isCurrentMonth, isToday, events, catMap, onDayClick, onEventClick,
}: {
	date: Date; isCurrentMonth: boolean; isToday: boolean;
	events: CalEvent[]; catMap: Map<string, Category>;
	onDayClick: (d: Date) => void; onEventClick: (ev: CalEvent) => void;
}) {
	const noon = new Date(date); noon.setHours(9, 0, 0, 0);
	const { setNodeRef, isOver } = useDroppable({
		id: `slot:${date.toISOString().slice(0,10)}`,
		data: { kind: 'slot', date: noon.toISOString() },
	});

	return (
		<div
			ref={setNodeRef}
			onClick={() => onDayClick(noon)}
			className={`transition-colors relative min-h-[110px] border-r border-b last:border-r-0 border-slate-200 dark:border-slate-700 p-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/20 ${
				isToday ? 'bg-primary-50/40 dark:bg-primary-950/20' : ''
			} ${!isCurrentMonth ? 'bg-slate-50/30 dark:bg-slate-900/40' : ''} ${isOver ? 'ring-2 ring-primary-400' : ''}`}
		>
			<div className={`text-2xs font-medium mb-1 ${isToday ? 'text-primary-700 dark:text-primary-300' : isCurrentMonth ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}>
				{date.getDate()}
			</div>
			<div className="space-y-0.5">
				{events.slice(0, 3).map((e) => {
					const color = catMap.get(e.category_key ?? '')?.color ?? FALLBACK_COLOR;
					return (
						<button
							key={e.id}
							onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }}
							className="block w-full text-left text-2xs px-1 py-0.5 rounded-md truncate hover:opacity-80"
							style={{ backgroundColor: hexAlpha(color, 0.18) }}
						>
							{!e.all_day && <span className="text-slate-500 mr-1">{new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric' })}</span>}
							{e.title}
						</button>
					);
				})}
				{events.length > 3 && <div className="text-2xs text-slate-600 dark:text-slate-400 pl-1">+{events.length - 3} more</div>}
			</div>
		</div>
	);
}

// ===========================================================================
// QuarterGrid — stacked 3 months in mini form. Lighter detail than month
// view; great for planning + spotting density patterns across the quarter.
// ===========================================================================

function QuarterGrid({
	refDate, events, catMap, onDayClick, onEventClick,
}: {
	refDate: Date;
	events: CalEvent[];
	catMap: Map<string, Category>;
	onDayClick: (d: Date) => void;
	onEventClick: (ev: CalEvent) => void;
}) {
	const q = Math.floor(refDate.getMonth() / 3);
	const months = [0, 1, 2].map((i) => new Date(refDate.getFullYear(), q * 3 + i, 15));

	return (
		<div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
			{months.map((m) => (
				<Card key={m.toISOString()} padding="none">
					<div className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
						{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
					</div>
					<MiniMonth refDate={m} events={events} catMap={catMap} onDayClick={onDayClick} onEventClick={onEventClick} />
				</Card>
			))}
		</div>
	);
}

function MiniMonth({
	refDate, events, catMap, onDayClick, onEventClick,
}: {
	refDate: Date; events: CalEvent[]; catMap: Map<string, Category>;
	onDayClick: (d: Date) => void; onEventClick: (ev: CalEvent) => void;
}) {
	const first = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
	const last = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
	const startOffset = (first.getDay() + 6) % 7;
	const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;
	const gridStart = new Date(first); gridStart.setDate(first.getDate() - startOffset);

	const countsByDay = new Map<string, number>();
	const firstEventByDay = new Map<string, CalEvent>();
	for (const ev of events) {
		const key = localDateKey(ev.starts_at);
		countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
		if (!firstEventByDay.has(key)) firstEventByDay.set(key, ev);
	}

	const cells: Date[] = Array.from({ length: totalCells }).map((_, i) => {
		const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d;
	});

	return (
		<div className="p-2">
			<div className="grid grid-cols-7 mb-1">
				{['M','T','W','T','F','S','S'].map((l, i) => (
					<div key={i} className="text-2xs text-slate-600 dark:text-slate-400 text-center">{l}</div>
				))}
			</div>
			<div className="grid grid-cols-7 gap-px">
				{cells.map((d) => {
					const key = localDateKey(d);
					const inMonth = d.getMonth() === refDate.getMonth();
					const isToday = d.toDateString() === new Date().toDateString();
					const count = countsByDay.get(key) ?? 0;
					const firstEv = firstEventByDay.get(key);
					const color = firstEv ? catMap.get(firstEv.category_key ?? '')?.color ?? FALLBACK_COLOR : null;
					return (
						<button
							key={key}
							onClick={() => {
								const noon = new Date(d); noon.setHours(9, 0, 0, 0);
								if (firstEv && count === 1) onEventClick(firstEv);
								else onDayClick(noon);
							}}
							className={`aspect-square rounded-md text-2xs flex items-center justify-center transition-colors ${
								isToday ? 'ring-1 ring-primary-500' : ''
							} ${
								inMonth ? 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45' : 'text-slate-300 dark:text-slate-700'
							}`}
							style={color && inMonth ? { backgroundColor: hexAlpha(color, Math.min(0.6, 0.18 + count * 0.08)) } : undefined}
							title={count > 0 ? `${count} event${count > 1 ? 's' : ''} on ${d.toLocaleDateString()}` : d.toLocaleDateString()}
						>
							{d.getDate()}
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ===========================================================================
// Helpers
// ===========================================================================

function daysOfWeek(ref: Date): Date[] {
	const day = ref.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	const monday = new Date(ref); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() + diff);
	return Array.from({ length: 7 }).map((_, i) => {
		const d = new Date(monday); d.setDate(monday.getDate() + i); return d;
	});
}

function windowLabel(view: ViewMode, ref: Date): string {
	if (view === 'day') return ref.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
	if (view === 'week') {
		const days = daysOfWeek(ref);
		const first = days[0]; const last = days[6];
		const sameMonth = first.getMonth() === last.getMonth();
		return sameMonth
			? `${first.toLocaleDateString(undefined, { month: 'long' })} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
			: `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
	}
	if (view === 'month') return ref.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
	const q = Math.floor(ref.getMonth() / 3) + 1;
	return `Q${q} ${ref.getFullYear()}`;
}

function pixelize(ev: CalEvent, rowHeight: number = ROW_HEIGHT_DEFAULT): { top: number; height: number } {
	const start = new Date(ev.starts_at);
	const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + 30 * 60_000);
	const startMinutes = start.getHours() * 60 + start.getMinutes();
	const durationMin = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
	const pxPerMin = rowHeight / 60;
	return { top: Math.max(0, startMinutes * pxPerMin), height: durationMin * pxPerMin };
}

function formatHour(h: number): string {
	const period = h >= 12 ? 'pm' : 'am';
	const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
	return `${hour}${period}`;
}

/** A colour (hex or token variable) at `alpha` opacity. color-mix keeps it theme-aware (style guide: no rgba strings). */
function hexAlpha(color: string, alpha: number): string {
	return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
