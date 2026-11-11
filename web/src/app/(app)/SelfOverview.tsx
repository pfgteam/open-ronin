'use client';

// The personal page (rework D5, 5.5): Home, Self Overview and My Work in
// ONE tile grid. Tiles drag and drop (dnd-kit: mouse, touch, keyboard),
// size to one or two columns, hide and come back, and the layout is saved
// per person (user_dashboard_layout 'personal'). A new user lands on the
// default layout for their role (rework 8.4, lib/home/personalLayout).
// Queue rows open the item drawer in place and change status in one click.
// Each tile links to its full list (the queue is /?tab=work).
//
// Same timezone rule as HomeView: ends_at is a bare date read as LOCAL
// midnight (parseDueLocal), never new Date('YYYY-MM-DD').

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
	AlertTriangle, ArrowRight, BellRing, Briefcase, CalendarDays, CalendarRange, CheckSquare, ChevronRight, Eye, EyeOff, Flag, GripVertical, HeartPulse, ListChecks,
	MessageSquare, PencilLine, Plus, Radar as RadarIcon, RotateCcw, Send, Settings2, Sun, Target, Users, Zap, Inbox, LayoutList,
} from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useToast } from '@/components/ui/Toast';
import WorkItemPanel from '@/components/work/WorkItemPanel';
import { StatusCell } from '@/components/board/cells';
import { updateItemField } from '@/app/(app)/the-work/b/actions';
import { TILES, visibleTiles, type TileId, type TileSlot } from '@/lib/home/personalLayout';
import { progressValue } from '@/lib/work/hub/rows';
import { savePersonalLayout } from './personalActions';
import Button from '@/components/ui/Button';
import { controlFocus } from '@/components/ui/focus';
import { dueBucket, relativeDue, startOfDay } from '@/lib/home/dueLabel';
import { buildRadarAll, capRadar, type RadarTone } from '@/lib/home/radar';
import { quickActionHref, resolveQuickActions } from '@/lib/home/quickActions';
import { useRouter } from 'next/navigation';
import type { SessionAction } from '@/lib/home/sessionActions';
import NewItemModal from '@/components/board/NewItemModal';
import StatusPill from '@/components/work/StatusPill';
import type { BoardContext } from '@/lib/work/boards/types';
import { callKindLabel, groupSalesRows, isSalesCall, salesDueLabel, slowNewLeads } from '@/lib/home/sales';
import type { SalesData } from '@/lib/home/salesData';
import { GROUP_TAG, SalesTargets } from './SalesBits';
import type { OpenRequest } from '@/lib/home/openRequestsShared';
import { useAuthStore } from '@/stores/auth';
import { ASK_FOR_TILES, isItemVisible, isSoonHref, newMenuOption } from '@/components/nav/navConfig';
import { resolveOptionHref } from '@/components/nav/NewMenu';
import { openNewMenu } from '@/components/nav/newMenuEvents';
import { computeTeamSignals, QuickActionsPicker, SessionActionsTab, TeamTab, type AgendaEvent, type CalConnection, type FeedUpdate, type LeadItem, type ReportProfile, type ReportWorkItem, type WorkRow } from './HomeView';

interface Status { slug: string; label: string; color: string | null }

export interface SelfOverviewProps {
	viewerId: string;
	viewerFirstName: string;
	ownedWork: WorkRow[];
	createdWork: WorkRow[];
	terminalStatuses: string[];
	statusesByKind: Record<string, Status[]>;
	profiles: { id: string; first_name: string | null; last_name: string | null; email: string }[];
	events: AgendaEvent[];
	updates: FeedUpdate[];
	leadItems: LeadItem[];
	metricsDue: number;
	monthLabel: string;
	checkinPending: boolean;
	computedMonth: { done: number; scheduled: number } | null;
	quickActionKeys: string[] | null;
	canUseRestricted: boolean;
	followingCount: number;
	/** Pending AI-suggested tasks from Sessions (viewer or their reports). Was a My work tab until 2026-10-05. */
	sessionActions: SessionAction[];
	/** Direct reports (leads only) + their open items: the "My team" exceptions section. */
	reports: ReportProfile[];
	reportItems: ReportWorkItem[];
	/** Google Calendar connections: drives the agenda auto-sync (moved from HomeView). */
	connections: CalConnection[];
	/** Board context for the "+ New task" modal (people, parents). */
	ctx: BoardContext;
	/** ?quickActions=1: the picker modal is open over the overview. */
	quickActionsOpen: boolean;
	/** Self → Sales (2026-10-15): null for viewers without a lane. */
	sales: SalesData | null;
	/** Work › Overview "My open requests" (lib/home/openRequests). */
	openRequests: OpenRequest[];
	/** Goals, priorities, projects, campaigns the viewer leads (team or project lead). */
	ledWork: WorkRow[];
	/** The viewer's tile layout (saved, else the role default). */
	layout: TileSlot[];
	/** True when the layout is the role default (nothing saved yet). */
	layoutIsDefault: boolean;
	calibrationOpen: boolean;
}

const DAY = 86_400_000;
// Radar tones as tokens (rail + icon), not raw hex.
const TONE: Record<RadarTone, { rail: string; icon: string }> = {
	danger: { rail: 'border-red-500', icon: 'text-red-500' },
	warning: { rail: 'border-amber-500', icon: 'text-amber-500' },
	info: { rail: 'border-primary-500', icon: 'text-primary-500' },
};

function relTime(iso: string): string {
	const s = (Date.now() - Date.parse(iso)) / 1000;
	if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

function Card({ title, icon: Icon, hint, href, linkLabel, className, children, toolbar }: {
	title: string; icon: typeof Sun; hint?: string; href?: string; linkLabel?: string; className?: string; children: React.ReactNode; toolbar?: React.ReactNode;
}) {
	return (
		<section className={clsx('flex h-full min-w-0 flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800', className)} aria-label={title}>
			<header className="flex min-h-13 items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
				{toolbar}
				<Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
				{hint && <span className="truncate text-xs text-slate-500">{hint}</span>}
				{href && (
					<Link href={href} aria-label={linkLabel ?? `Open ${title}`} className={clsx('ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-hover', controlFocus)}>
						{linkLabel && <span>{linkLabel}</span>}<ArrowRight className="w-3 h-3" aria-hidden="true" />
					</Link>
				)}
			</header>
			<div className="flex-1 px-3 py-1.5">{children}</div>
		</section>
	);
}

/** Fixed-height row so cards in one grid row hold the same number of lines. */
function Row({ href, children, accent, onClick }: { href?: string; children: React.ReactNode; accent?: string; onClick?: () => void }) {
	const cls = clsx('flex h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-hover', controlFocus, accent && clsx('border-l-4', accent));
	if (onClick) return <button type="button" onClick={onClick} className={clsx(cls, 'w-full text-left')}>{children}</button>;
	return <Link href={href ?? '#'} className={cls}>{children}</Link>;
}

export default function SelfOverview(p: SelfOverviewProps) {
	const router = useRouter();
	const [newOpen, setNewOpen] = useState(false);
	const { profile: viewer, modules } = useAuthStore();
	// "Ask for…" tiles: one option → straight to its page; a tile covering
	// two options (Access / Purchase) opens + New on the first. Options the
	// viewer cannot use (module, WIP) drop out — honest nav.
	const askTiles = ASK_FOR_TILES.flatMap((t) => {
		const opts = [t.option, t.also].filter((x): x is string => !!x).map(newMenuOption).filter((o) => !!o && isItemVisible(o, viewer, modules));
		if (!opts.length) return [];
		const first = opts[0]!;
		const href = opts.length === 1 ? resolveOptionHref(first, viewer?.id) : null;
		return [{ label: t.label, option: first.label, href, soon: opts.every((o) => !!o?.href && isSoonHref(o.href)) }];
	});
	const [today, setToday] = useState<Date>(() => startOfDay(new Date()));
	useEffect(() => { setToday(startOfDay(new Date())); }, []);

	// Agenda auto-sync (was in HomeView): refresh Google events when the last
	// sync is > 15 min old, same incremental endpoint the Calendar page uses.
	const syncFired = useRef(false);
	useEffect(() => {
		if (syncFired.current || p.connections.length === 0) return;
		const last = p.connections[0]?.last_synced_at;
		if (last && Date.now() - new Date(last).getTime() < 15 * 60_000) return;
		syncFired.current = true;
		fetch('/api/integrations/google-cal/sync', { method: 'POST' })
			.then((r) => { if (r.ok) router.refresh(); })
			.catch(() => { /* the agenda simply stays as-is */ });
	}, [p.connections, router]);
	// When the Connect flow runs in another tab, pick the new connection up on focus.
	useEffect(() => {
		if (p.connections.length > 0) return;
		const onFocus = () => router.refresh();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [p.connections, router]);
	const terminal = useMemo(() => new Set(p.terminalStatuses), [p.terminalStatuses]);
	const open = useMemo(() => p.ownedWork.filter((w) => !terminal.has(w.status)), [p.ownedWork, terminal]);
	// Same buckets as the My work groups (lib/home/dueLabel): the KPI you click is the group you land on.
	const bucket = (w: WorkRow) => dueBucket(w.ends_at, today);
	const counts = { overdue: 0, today: 0, week: 0 };
	for (const w of open) { const b = bucket(w); if (b in counts) counts[b as keyof typeof counts]++; }

	const topWork = [...open].sort((a, b) => (a.ends_at ?? '9999').localeCompare(b.ends_at ?? '9999')).slice(0, 5);
	// Same definitions as HomeView's Created / Delegated tabs.
	const created = p.createdWork.filter((w) => !terminal.has(w.status));
	const delegated = created.filter((w) => w.owner_id && w.owner_id !== p.viewerId);
	const tasksN = open.filter((w) => w.kind === 'task').length;

	const agenda = useMemo(() => {
		const start = today.getTime(), end = start + DAY;
		return p.events.filter((e) => { const t = Date.parse(e.starts_at); return t >= start && t < end; }).slice(0, 5);
	}, [p.events, today]);

	const now = useMemo(() => new Date(), []);
	const salesTop = useMemo(() => {
		if (!p.sales) return [];
		return groupSalesRows(p.sales.rows, now, p.sales.callDeals).flatMap((g) => g.rows.map((r) => ({ r, g: g.key }))).slice(0, 5);
	}, [p.sales, now]);
	const salesNew = p.sales ? p.sales.rows.filter((r) => r.reason === 'new lead' && !r.answered).length : 0;
	const staleLead = p.leadItems.filter((l) => !terminal.has(l.status) && (!l.lastUpdateAt || (Date.now() - Date.parse(l.lastUpdateAt)) / DAY > 7)).length;
	const radar = capRadar(buildRadarAll({
		staleHealthCount: staleLead,
		staleHealthHref: '/the-work',
		metricsDue: p.metricsDue,
		monthLabel: p.monthLabel,
		metricsHref: `/team/${p.viewerId}?tab=metrics`,
		checkinPending: p.checkinPending,
		checkinHref: `/team/${p.viewerId}?tab=checkins`,
		computedMonth: p.computedMonth,
		changes: p.updates.map((u) => ({ text: `${u.authorName ?? 'Someone'} marked ${u.itemName} as ${u.health.replace('_', ' ')}`, whenLabel: relTime(u.createdAt), href: `/the-work/${u.itemId}` })),
		comments: [],
		slowNewLeads: p.sales ? { count: slowNewLeads(p.sales.rows, now, p.sales.goalMinutes), goalMinutes: p.sales.goalMinutes, href: '/?tab=work&queue=sales' } : null,
	})).slice(0, 5);
	const actions = resolveQuickActions(p.quickActionKeys, p.canUseRestricted).slice(0, 5);
	const isLead = p.reports.length > 0;
	const team = useMemo(
		() => computeTeamSignals({ isLead, reports: p.reports, reportItems: p.reportItems, leadItems: p.leadItems, terminal, viewerId: p.viewerId, today }),
		[isLead, p.reports, p.reportItems, p.leadItems, terminal, p.viewerId, today],
	);
	const name = (id: string | null) => { const x = p.profiles.find((pr) => pr.id === id); return x ? [x.first_name, x.last_name].filter(Boolean).join(' ') || x.email : '—'; };
	const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

	const kpis = [
		{ label: 'Overdue', value: counts.overdue, icon: AlertTriangle, href: '/?tab=work', tone: counts.overdue ? 'text-red-600 dark:text-red-400' : '' },
		{ label: 'Today', value: counts.today, icon: Sun, href: '/?tab=work', tone: '' },
		{ label: 'This week', value: counts.week, icon: CalendarRange, href: '/?tab=work', tone: '' },
		{ label: 'Following', value: p.followingCount, icon: BellRing, href: '/?tab=work&queue=following', tone: '' },
	];

	// ---------------------------------------------------- the tile grid
	const { toast } = useToast();
	const [layout, setLayout] = useState<TileSlot[]>(p.layout);
	const [customize, setCustomize] = useState(false);
	const [panelId, setPanelId] = useState<string | null>(null);
	const [rows, setRows] = useState<Record<string, WorkRow>>({});
	const rowOf = (w: WorkRow) => rows[w.id] ?? w;
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const persist = async (next: TileSlot[] | null) => {
		const res = await savePersonalLayout(next);
		if (!res.ok) toast({ message: res.error, variant: 'error' });
	};
	const onDragEnd = (e: DragEndEvent) => {
		if (!e.over || e.active.id === e.over.id) return;
		setLayout((l) => {
			const from = l.findIndex((x) => x.id === e.active.id), to = l.findIndex((x) => x.id === e.over!.id);
			const next = arrayMove(l, from, to);
			void persist(next);
			return next;
		});
	};
	const patchSlot = (id: TileId, patch: Partial<TileSlot>) => setLayout((l) => { const next = l.map((x) => (x.id === id ? { ...x, ...patch } : x)); void persist(next); return next; });
	const shown = visibleTiles(layout, { isLead, hasSales: !!p.sales });
	const quickStatus = async (w: WorkRow, slug: string | null) => {
		if (!slug) return;
		const prev = rowOf(w).status;
		setRows((r) => ({ ...r, [w.id]: { ...rowOf(w), status: slug } }));
		const res = await updateItemField(w.id, 'status', slug);
		if (!res.ok) { setRows((r) => ({ ...r, [w.id]: { ...rowOf(w), status: prev } })); toast({ message: res.error, variant: 'error' }); }
	};

	const goalsLed = useMemo(() => {
		const seen = new Set<string>();
		return [...p.ownedWork, ...p.ledWork].filter((w) => ['goal', 'priority'].includes(w.kind) && !terminal.has(w.status) && (seen.has(w.id) ? false : (seen.add(w.id), true)));
	}, [p.ownedWork, p.ledWork, terminal]);
	const projectsLed = useMemo(() => p.ledWork.filter((w) => w.kind === 'project' && !terminal.has(w.status)), [p.ledWork, terminal]);
	const assignments = useMemo(() => open.filter((w) => w.kind === 'assignment'), [open]);
	const byDiscipline = useMemo(() => {
		const m = new Map<string, WorkRow[]>();
		for (const a of assignments) { const k = a.discipline_id ?? 'none'; m.set(k, [...(m.get(k) ?? []), a]); }
		return [...m.entries()];
	}, [assignments]);
	const todos = [
		...(p.checkinPending ? [{ key: 'checkin', title: 'Weekly check-in is due', href: `/team/${p.viewerId}?tab=checkins`, icon: MessageSquare }] : []),
		...(p.metricsDue > 0 ? [{ key: 'metrics', title: `${p.metricsDue} metric${p.metricsDue === 1 ? '' : 's'} to enter for ${p.monthLabel}`, href: `/team/${p.viewerId}?tab=metrics`, icon: ListChecks }] : []),
		...(p.calibrationOpen ? [{ key: 'calibration', title: 'Calibration round is open', href: '/team/calibration', icon: Users }] : []),
		...(p.sessionActions.length ? [{ key: 'sessions', title: `${p.sessionActions.length} Sessions suggestion${p.sessionActions.length === 1 ? '' : 's'} to accept`, href: '#sessions', icon: CheckSquare }] : []),
	];

	const tile = (id: TileId): { node: React.ReactNode; title: string; icon: typeof Sun; hint?: string; href?: string; linkLabel?: string } | null => {
		switch (id) {
			case 'kpis':
				return { title: 'My numbers', icon: ListChecks, node: (
					<div className="grid grid-cols-2 gap-2 py-1.5 sm:grid-cols-4">
						{kpis.map((k) => (
							<Link key={k.label} href={k.href} className={clsx('rounded-md border border-slate-200 px-3 py-2 hover:bg-hover dark:border-slate-700', controlFocus)}>
								<span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"><k.icon className="h-3.5 w-3.5" aria-hidden="true" />{k.label}</span>
								<span className={clsx('block text-2xl font-bold tabular-nums tracking-tight', k.tone)}>{k.value}</span>
							</Link>
						))}
					</div>
				) };
			case 'my_queue':
				return { title: 'My queue', icon: ListChecks, hint: `${open.length} open · ${tasksN} tasks`, href: '/?tab=work', linkLabel: 'See all', node: (
					<>
						{topWork.map((w0) => {
							const w = rowOf(w0);
							const late = bucket(w) === 'overdue';
							return (
								<div key={w.id} className="flex h-10 items-center gap-2 rounded-md px-1 text-sm hover:bg-hover">
									<span className="w-28 shrink-0"><StatusCell row={w} ctx={p.ctx} onEdit={(e) => { if (e.kind === 'field') void quickStatus(w, e.value); }} /></span>
									<button type="button" onClick={() => setPanelId(w.id)} className={clsx('min-w-0 flex-1 truncate text-left', controlFocus)}>{w.name}</button>
									<span className={clsx('shrink-0 text-xs tabular-nums', late ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500')}>{relativeDue(w.ends_at, today)}</span>
								</div>
							);
						})}
						{!topWork.length && <p className="px-2 py-3 text-sm text-slate-500">Nothing open. Enjoy it.</p>}
					</>
				) };
			case 'goals_priorities':
				return { title: 'Goals and priorities', icon: Flag, hint: `${goalsLed.length}`, href: '/the-work/goals', linkLabel: 'Goals', node: (
					<>
						{goalsLed.slice(0, 6).map((w) => {
							const pct = progressValue(p.ctx, w);
							return (
								<button key={w.id} type="button" onClick={() => setPanelId(w.id)} className={clsx('flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover', controlFocus)}>
									<span className="w-14 shrink-0 text-2xs uppercase text-slate-500">{w.kind}</span>
									<span className="min-w-0 flex-1 truncate">{w.name}</span>
									<span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full bg-green-600" style={{ width: `${pct}%` }} /></span>
									<span className="w-9 shrink-0 text-right text-xs tabular-nums">{pct}%</span>
								</button>
							);
						})}
						{!goalsLed.length && <p className="px-2 py-3 text-sm text-slate-500">No goals or priorities on you.</p>}
					</>
				) };
			case 'projects_lead':
				return { title: 'Projects I lead', icon: Briefcase, hint: `${projectsLed.length}`, href: `/the-work/projects?lead=${p.viewerId}`, linkLabel: 'See all', node: (
					<>
						{projectsLed.slice(0, 6).map((w) => (
							<button key={w.id} type="button" onClick={() => setPanelId(w.id)} className={clsx('flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover', controlFocus)}>
								<StatusPill ctx={{ statusesByKind: p.statusesByKind }} kind={w.kind} status={w.status} className="w-24 shrink-0" />
								<span className="min-w-0 flex-1 truncate">{w.name}</span>
								<span className="shrink-0 text-xs tabular-nums text-slate-500">{progressValue(p.ctx, w)}%</span>
							</button>
						))}
						{!projectsLed.length && <p className="px-2 py-3 text-sm text-slate-500">You don&apos;t lead a project right now.</p>}
					</>
				) };
			case 'client_work':
				return { title: 'Client work', icon: LayoutList, hint: `${assignments.length}`, href: `/the-work/client-work`, linkLabel: 'Client Work', node: (
					<>
						{byDiscipline.map(([d, list]) => (
							<div key={d} className="py-1">
								<p className="px-2 text-2xs font-medium uppercase tracking-wide text-slate-500">{d === 'none' ? 'No discipline' : p.ctx.disciplines?.[d]?.label ?? 'Discipline'} · {list.length}</p>
								{list.slice(0, 4).map((w) => (
									<button key={w.id} type="button" onClick={() => setPanelId(w.id)} className={clsx('flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover', controlFocus)}>
										<span className="min-w-0 flex-1 truncate">{w.name}</span>
										<span className="shrink-0 truncate text-xs text-slate-500">{w.client_id ? p.ctx.clients[w.client_id]?.name ?? '' : ''}</span>
									</button>
								))}
							</div>
						))}
						{!assignments.length && <p className="px-2 py-3 text-sm text-slate-500">No client work on you.</p>}
					</>
				) };
			case 'agenda':
				return { title: "Today's agenda", icon: CalendarDays, href: '/the-work/calendar', linkLabel: 'Calendar', node: (
					<>
						{agenda.map((e) => {
							const match = p.sales?.calls[e.id];
							return (
								<Row key={e.id} href={match ? `/prospects/deals/${match.dealId}` : '/the-work/calendar'} accent={match ? 'border-primary-500' : undefined}>
									<span className="w-11 shrink-0 font-semibold tabular-nums">{e.all_day ? 'All day' : new Date(e.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
									{isSalesCall(e) && <span className="shrink-0 rounded-md bg-primary-100 px-1.5 py-0.5 text-2xs font-semibold text-primary-900 dark:bg-primary-950 dark:text-primary-300">{callKindLabel(e.title)}</span>}
									<span className="min-w-0 truncate">{match ? match.dealTitle : e.title}</span>
								</Row>
							);
						})}
						{!agenda.length && <p className="px-2 py-3 text-sm text-slate-500">No events today.</p>}
					</>
				) };
			case 'todos':
				return { title: 'To dos', icon: CheckSquare, hint: `${todos.length}`, node: (
					<>
						{todos.map((x) => <Row key={x.key} href={x.href}><x.icon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" /><span className="min-w-0 truncate">{x.title}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /></Row>)}
						{!todos.length && <p className="px-2 py-3 text-sm text-slate-500">Nothing waiting on you.</p>}
					</>
				) };
			case 'created':
				return { title: 'Created by me', icon: PencilLine, hint: `${created.length}`, href: '/?tab=work&queue=created', node: (
					<>
						{created.slice(0, 5).map((w) => (
							<Row key={w.id} onClick={() => setPanelId(w.id)}><span className="min-w-0 truncate">{w.name}</span><span className="ml-auto shrink-0 truncate text-xs text-slate-500">{name(w.owner_id)}</span></Row>
						))}
						{!created.length && <p className="px-2 py-3 text-sm text-slate-500">Nothing you created is open.</p>}
					</>
				) };
			case 'delegated':
				return { title: 'Delegated by me', icon: Send, hint: `${delegated.length}`, href: '/?tab=work&queue=delegated', node: (
					<>
						{delegated.slice(0, 5).map((l) => (
							<Row key={l.id} onClick={() => setPanelId(l.id)}><span className="min-w-0 truncate">{l.name}</span><span className="ml-auto shrink-0 truncate text-xs text-slate-500">{name(l.owner_id)}</span></Row>
						))}
						{!delegated.length && <p className="px-2 py-3 text-sm text-slate-500">Nothing you created is with someone else.</p>}
					</>
				) };
			case 'following':
				return { title: 'Following', icon: BellRing, hint: `${p.followingCount}`, href: '/?tab=work&queue=following', linkLabel: 'See all', node: (
					<p className="px-2 py-3 text-sm text-slate-600 dark:text-slate-400">{p.followingCount ? `${p.followingCount} open item${p.followingCount === 1 ? '' : 's'} you follow that someone else owns.` : 'You are not following anything open.'}</p>
				) };
			case 'radar':
				return { title: 'Radar', icon: RadarIcon, hint: `${radar.length} signals`, node: (
					<>
						{radar.map((r, i) => (
							<Row key={`${r.title}-${i}`} href={r.href} accent={TONE[r.tone].rail}>
								{r.tone === 'danger' ? <AlertTriangle className={clsx('h-4 w-4 shrink-0', TONE[r.tone].icon)} aria-hidden="true" />
									: r.title.toLowerCase().includes('check-in') ? <MessageSquare className={clsx('h-4 w-4 shrink-0', TONE[r.tone].icon)} aria-hidden="true" />
										: <HeartPulse className={clsx('h-4 w-4 shrink-0', TONE[r.tone].icon)} aria-hidden="true" />}
								<span className="min-w-0 truncate">{r.title}</span>
								<span className="ml-auto shrink-0 truncate text-xs text-slate-500">{r.sub}</span>
							</Row>
						))}
						{!radar.length && <p className="px-2 py-3 text-sm text-slate-500">All quiet.</p>}
					</>
				) };
			case 'quick_actions':
				return { title: 'Quick actions', icon: Zap, node: (
					<>
						{actions.map((a) => {
							const href = quickActionHref(a, p.viewerId);
							const inner = <><span className="min-w-0 truncate">{a.label}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /></>;
							return href ? <Row key={a.key} href={href}>{inner}</Row> : <Row key={a.key} onClick={() => setNewOpen(true)}>{inner}</Row>;
						})}
						<Row href="/?quickActions=1"><span className="text-xs text-slate-500">Choose quick actions…</span></Row>
					</>
				) };
			case 'team':
				return isLead ? { title: 'My team', icon: Users, node: <TeamTab teamOverdue={team.teamOverdue} staleLead={team.staleLead} delegatedStalled={team.delegatedStalled} router={router} /> } : null;
			case 'ask_for':
				return { title: 'Ask for…', icon: Send, hint: 'Requests route to the right team', node: (
					<div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-3">
						{askTiles.map((t) => {
							const inner = (<><span className="min-w-0 truncate font-medium">{t.label}</span>{t.soon && <span className="ml-auto shrink-0 text-2xs font-medium text-amber-800 dark:text-amber-300">Soon</span>}</>);
							const cls = clsx('flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm hover:bg-hover dark:border-slate-700', controlFocus);
							return t.href ? <Link key={t.label} href={t.href} className={cls}>{inner}</Link> : <button key={t.label} type="button" onClick={() => openNewMenu({ option: t.option })} className={clsx(cls, 'text-left')}>{inner}</button>;
						})}
					</div>
				) };
			case 'open_requests':
				return { title: 'My open requests', icon: Inbox, hint: `${p.openRequests.length}`, href: '/the-work/content-requests', linkLabel: 'Inbox', node: (
					<>
						{p.openRequests.map((r) => (
							<Row key={r.id} href={r.href}><span className="w-24 shrink-0 truncate text-xs text-slate-500">{r.type}</span><span className="min-w-0 truncate">{r.title}</span><span className="ml-auto shrink-0 text-xs text-slate-500">{r.status}</span></Row>
						))}
						{!p.openRequests.length && <p className="px-2 py-3 text-sm text-slate-500">Nothing waiting on anyone.</p>}
					</>
				) };
			case 'sales_queue':
				return p.sales ? { title: 'Sales queue', icon: Target, hint: `${p.sales.rows.length} · ${salesNew} new`, href: '/?tab=work&queue=sales', linkLabel: 'See all', node: (
					<>
						{salesTop.map(({ r, g }) => {
							const due = salesDueLabel(r, g, now, p.sales?.callDeals[r.deal_id], p.sales?.goalMinutes);
							return (
								<Row key={r.deal_id} href={`/prospects/deals/${r.deal_id}`} accent={g === 'new' ? 'border-red-500' : undefined}>
									<span className={clsx('shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold', GROUP_TAG[g].cls)}>{GROUP_TAG[g].label}</span>
									<span className="min-w-0 truncate">{r.title}</span>
									<span className={clsx('ml-auto shrink-0 text-xs tabular-nums', due.late ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500')}>{due.text}</span>
								</Row>
							);
						})}
						{!salesTop.length && <p className="px-2 py-3 text-sm text-slate-500">Your queue is clear.</p>}
					</>
				) } : null;
		}
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-end gap-3">
				<div>
					<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{hello}, {p.viewerFirstName}</h1>
					<p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
						{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {open.length} open item{open.length === 1 ? '' : 's'}
					</p>
				</div>
				<div className="ml-auto flex items-center gap-2">
					{customize && <Button variant="ghost" size="sm" onClick={() => { setLayout(p.layoutIsDefault ? p.layout : layout); void persist(null).then(() => router.refresh()); setCustomize(false); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset to default</Button>}
					<Button variant={customize ? 'primary' : 'outline'} size="sm" onClick={() => setCustomize((c) => !c)} aria-pressed={customize}><Settings2 className="h-4 w-4" aria-hidden="true" />{customize ? 'Done' : 'Customize'}</Button>
					<Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />New task</Button>
				</div>
			</div>

			{p.sales && p.sales.targets.length > 0 && (
				<section aria-label={`Today's targets · ${p.sales.laneLabel} lane`} className="space-y-1.5">
					<SalesTargets tiles={p.sales.targets} variant="tiles" />
				</section>
			)}

			{customize && (
				<p className="rounded-md border border-dashed border-primary-300 bg-primary-50 px-3 py-2 text-xs text-primary-900 dark:border-primary-700 dark:bg-primary-950 dark:text-primary-300">
					Drag tiles by their handle (or focus the handle and use the arrow keys). Make a tile wide or narrow, hide what you don&apos;t use. Changes save as you go.
				</p>
			)}

			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
				<SortableContext items={shown.filter((s) => customize || !s.hidden).map((s) => s.id)} strategy={rectSortingStrategy}>
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
						{shown.filter((s) => customize || !s.hidden).map((slot) => {
							const def = TILES.find((x) => x.id === slot.id)!;
							const tl = tile(slot.id);
							if (!tl) return null;
							return (
								<SortableTile key={slot.id} id={slot.id} size={slot.size} hidden={!!slot.hidden} customize={customize}>
									{(handle) => (
										<Card title={tl.title} icon={tl.icon} hint={slot.hidden ? 'hidden' : tl.hint} href={customize ? undefined : tl.href} linkLabel={tl.linkLabel}
											className={clsx(slot.hidden && 'opacity-60')}
											toolbar={customize ? (
												<span className="flex items-center gap-1">
													<span {...handle} aria-label={`Move ${def.title}`} className={clsx('cursor-grab touch-none rounded-md border border-slate-300 p-1 text-slate-500 dark:border-slate-600', controlFocus)}><GripVertical className="h-4 w-4" aria-hidden="true" /></span>
												</span>
											) : undefined}>
											{customize ? (
												<div className="flex flex-wrap items-center gap-2 py-2">
													<p className="w-full text-xs text-slate-600 dark:text-slate-400">{def.help}</p>
													<Button size="sm" variant="outline" onClick={() => patchSlot(slot.id, { size: slot.size === 2 ? 1 : 2 })}>{slot.size === 2 ? 'Make narrow' : 'Make wide'}</Button>
													<Button size="sm" variant="ghost" onClick={() => patchSlot(slot.id, { hidden: !slot.hidden })}>{slot.hidden ? <><Eye className="h-4 w-4" aria-hidden="true" />Show</> : <><EyeOff className="h-4 w-4" aria-hidden="true" />Hide</>}</Button>
												</div>
											) : tl.node}
										</Card>
									)}
								</SortableTile>
							);
						})}
					</div>
				</SortableContext>
			</DndContext>

			{p.sessionActions.length > 0 && <div id="sessions"><SessionActionsTab actions={p.sessionActions} profiles={p.profiles} viewerId={p.viewerId} /></div>}

			{/* The same "+ New" modal the boards use (no project required, owner = me). */}
			<NewItemModal
				open={newOpen}
				onClose={() => setNewOpen(false)}
				kinds={['task']}
				ctx={p.ctx}
				viewerId={p.viewerId}
				boardName="My work"
				defaults={{ quarter_id: null, department_tag_id: null, client_id: null }}
				onCreated={(row, openIt) => { router.refresh(); if (openIt) setPanelId(row.id); }}
			/>
			{panelId && (
				<WorkItemPanel itemId={panelId} ctx={p.ctx} today={today.toISOString().slice(0, 10)} onClose={() => setPanelId(null)}
					onRowChange={(row) => setRows((r) => ({ ...r, [row.id]: row as WorkRow }))}
					onRemoved={() => router.refresh()} onOpenItem={(id) => setPanelId(id)} />
			)}
			{p.quickActionsOpen && <QuickActionsPicker selected={p.quickActionKeys} canUseRestricted={p.canUseRestricted} />}
		</div>
	);
}

function SortableTile({ id, size, hidden, customize, children }: { id: TileId; size: 1 | 2; hidden: boolean; customize: boolean; children: (handle: Record<string, unknown>) => React.ReactNode }) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !customize });
	return (
		<div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
			className={clsx(size === 2 ? 'md:col-span-2' : 'col-span-1', isDragging && 'z-20 opacity-80', hidden && !customize && 'hidden')}>
			{children({ ...attributes, ...listeners })}
		</div>
	);
}
