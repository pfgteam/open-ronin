// / — the personal page (rework D5): Home, Self Overview and My Work as one
// tile grid (SelfOverview). /?tab=work keeps the full queue list that the
// My queue tile links to.
//
// (History below.) Home: My Work as the front door of Open Ronin.
//
// Concept B ("Cockpit") from the home mock-ups, approved 2026-08-12 with
// three changes: English-only UI, working Google Calendar connection, and
// no capacity card. /the-work/my-work now redirects here (middleware).
//
// Everything on this page reads from Supabase only — no Airtable/Sheets on
// the home's critical path, by design.
//
// Fixes rolled in vs. the old /the-work/my-work queue:
//   • (co-owners via work_item_owners were added here, then dropped
//     2026-11-03: Mine is primary owner only)
//   • terminal statuses come from work_item_statuses.is_terminal, not a
//     hardcoded list
//   • date-only due dates are bucketed in the viewer's LOCAL timezone
//     (see HomeView.parseDueLocal)
//   • per-source limit raised 300 → 500

import Card from '@/components/ui/Card';
import { departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { createClient, getAuthProfile, getAuthUser } from '@/lib/supabase/server';
import { loadFormSupportingData } from './the-work/_lib';
import {
	type WorkRow,
	type LegacyTaskRow,
	type AgendaEvent,
	type CalConnection,
	type FeedUpdate,
	type ReportProfile,
	type ReportWorkItem,
	type LeadItem,
} from './HomeView';
import MyWorkView from './MyWorkView';
import { loadBoardContext } from '@/lib/work/boards/load';
import { WORK_ROW_COLUMNS } from '@/lib/work/boards/types';
import HomeSetupNotice from './HomeSetupNotice';
import SelfOverview from './SelfOverview';
import { loadHomeSignals } from '@/lib/home/signals';
import { isElevatedRole } from '@/lib/permissions/constants';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadSessionActions } from '@/lib/home/sessionActions';
import { loadSalesData } from '@/lib/home/salesData';
import type { SalesCallEvent } from '@/lib/home/sales';
import { loadOpenRequests } from '@/lib/home/openRequests';
import { layoutFor } from '@/lib/home/personalLayout';

export const dynamic = 'force-dynamic';

// The boards' row shape (lib/work/boards/types): My work renders on the board engine.
const WORK_ITEM_COLUMNS = WORK_ROW_COLUMNS;

// Kinds that carry health updates — same set the Projects tab nudges on.
const LEAD_KINDS = ['goal', 'priority', 'project', 'campaign', 'twelve_week_plan', 'strategy'];

export default async function HomePage({ searchParams }: {
	// ?quickActions=1 opens the quick-actions picker — same query-param modal
	// idiom the admin catalogs use for ?edit=.
	// Work Revamp: / is the Self overview (cockpit); /?tab=work is the queue
	// (HomeView, unchanged) and ?queue= picks its first tab.
	searchParams: Promise<{ quickActions?: string; tab?: string; queue?: string }>;
}) {
	const { quickActions: quickActionsParam, tab, queue } = await searchParams;
	const showQueue = tab === 'work';
	const user = await getAuthUser();
	if (!user) {
		return (
			<>
				<Card><div className="text-sm text-slate-500 text-center py-6">Sign in to see your day.</div></Card>
			</>
		);
	}
	const profile = await getAuthProfile();
	const supabase = await createClient();
	const userId = user.id;

	// Events window: wide enough that "today" is fully covered in any viewer
	// timezone (server runs UTC); HomeView filters to the local day.
	const nowMs = Date.now();
	const eventsFrom = new Date(nowMs - 18 * 3_600_000).toISOString();
	const eventsTo = new Date(nowMs + 30 * 3_600_000).toISOString();

	// ----- Batch 1: independent lookups ---------------------------------------
	const [
		{ data: ownedRaw },
		{ data: legacyRaw },
		support,
		{ data: terminalRows },
		{ data: eventsRaw },
		{ data: connections },
		{ data: reportRows },
		signals,
		{ data: quickActionsRow },
	] = await Promise.all([
		supabase
			.from('projects')
			.select(WORK_ITEM_COLUMNS)
			.eq('owner_id', userId)
			.eq('archived', false)
			.limit(500),
		supabase
			.from('tasks')
			.select('id, project_id, title, status, priority, due_at, starts_at, completed_at')
			.eq('assignee_id', userId)
			.is('completed_at', null)
			.limit(500),
		loadFormSupportingData(),
		supabase.from('work_item_statuses').select('slug').eq('is_terminal', true),
		supabase
			.from('calendar_events')
			.select('id, title, starts_at, ends_at, all_day, category_key, source, location, url, attendee_external')
			.eq('user_id', userId)
			.neq('status', 'cancelled')
			.gte('starts_at', eventsFrom)
			.lt('starts_at', eventsTo)
			.order('starts_at', { ascending: true }),
		supabase
			.from('google_calendar_connections')
			.select('id, google_account_email, last_synced_at, sync_status, sync_error')
			.eq('user_id', userId),
		supabase
			.from('profiles')
			.select('id, first_name, last_name, department_tag_id, email')
			.eq('manager_id', userId)
			.eq('is_active', true),
		// Radar inputs the queue can't derive: metrics still blank this month,
		// an unsubmitted check-in, and the compute engine's counted month.
		loadHomeSignals(userId),
		// The viewer's chosen quick actions (0053). maybeSingle so "no row" is
		// data, not an error — no row is exactly what "never opened the picker"
		// looks like, and the null it produces is what makes HomeView render the
		// defaults. If 0053 has not been applied yet, this errors softly to the
		// same null and Home keeps working on the defaults.
		supabase.from('user_quick_actions').select('keys').eq('user_id', userId).maybeSingle(),
	]);

	const owned = (ownedRaw ?? []) as WorkRow[];
	const legacyTasks = (legacyRaw ?? []) as LegacyTaskRow[];
	const terminalStatuses = Array.from(new Set((terminalRows ?? []).map((r) => r.slug as string)));
	const reports = reportRows ?? [];
	const isLead = reports.length > 0;
	// Self → Sales (2026-10-15): only viewers with a lane get a non-null result.
	const salesP = loadSalesData(supabase, userId, (eventsRaw ?? []) as SalesCallEvent[]).catch((e: unknown) => {
		// The queue is an add-on to Self: a failure here must not take the home page down.
		console.error('[self] sales queue failed', e);
		return null;
	});

	const reportIds = reports.map((r) => r.id);
	const terminalList = `(${terminalStatuses.join(',')})`;

	// ----- Batch 2: dependent lookups ------------------------------------------
	const [createdRes, feedIdsRes, reportItemsRes, leadItemsRes, ledRes, layoutRes, calibrationRes] = await Promise.all([
		// Created / Delegated tabs — projects.created_by is written by every
		// create action, so this is a plain filter, no migration needed.
		supabase
			.from('projects')
			.select(WORK_ITEM_COLUMNS)
			.eq('created_by', userId)
			.eq('archived', false)
			.limit(500),
		// Items I own or lead — the population the Radar's change rows watch.
		supabase
			.from('projects')
			.select('id, name')
			.or(`owner_id.eq.${userId},team_lead_id.eq.${userId},project_lead_id.eq.${userId}`)
			.eq('archived', false)
			.order('updated_at', { ascending: false })
			.limit(150),
		isLead
			? supabase
					.from('projects')
					.select('owner_id, ends_at, status')
					.in('owner_id', reportIds)
					.eq('archived', false)
					.not('ends_at', 'is', null)
					.not('status', 'in', terminalList)
					.limit(1000)
			: Promise.resolve({ data: [] as ReportWorkItem[] }),
		isLead
			? supabase
					.from('projects')
					.select('id, name, kind, status, owner_id, updated_at')
					.or(`team_lead_id.eq.${userId},project_lead_id.eq.${userId}`)
					.in('kind', LEAD_KINDS)
					.eq('archived', false)
					.not('status', 'in', terminalList)
					.limit(100)
			: Promise.resolve({ data: [] as { id: string; name: string; kind: string; status: string; owner_id: string | null; updated_at: string }[] }),
		// Personal page tiles: goals / priorities / projects the viewer leads.
		supabase
			.from('projects')
			.select(WORK_ITEM_COLUMNS)
			.or(`team_lead_id.eq.${userId},project_lead_id.eq.${userId}`)
			.in('kind', LEAD_KINDS)
			.eq('archived', false)
			.not('status', 'in', terminalList)
			.limit(200),
		supabase.from('user_dashboard_layout').select('layout').eq('user_id', userId).eq('dashboard_key', 'personal').maybeSingle(),
		supabase.from('calibration_cycles').select('id').eq('status', 'open').limit(1),
	]);

	// Mine = primary owner only (Sam, 2026-11-03). work_item_owners is not
	// read here: board owner edits left the previous owner's row behind, so
	// ex-owners kept seeing items they no longer own.
	const ownedWork: WorkRow[] = owned;
	const createdWork: WorkRow[] = (createdRes.data ?? []) as WorkRow[];
	const feedItems = feedIdsRes.data ?? [];
	const feedNameById = new Map(feedItems.map((p) => [p.id as string, p.name as string]));
	const leadItemsRaw = leadItemsRes.data ?? [];

	// ----- Batch 3: legacy project names, update feed, lead-item health ------
	// Work rows get their labels from the board context below; only the
	// pre-revamp `tasks` rows still need a project name looked up here.
	const legacyProjectIds = Array.from(new Set(legacyTasks.map((t) => t.project_id).filter(Boolean)));
	const leadIds = leadItemsRaw.map((l) => l.id);

	const [legacyParentsRes, updatesRes, leadUpdatesRes] = await Promise.all([
		legacyProjectIds.length > 0
			? supabase.from('projects').select('id, name').in('id', legacyProjectIds)
			: Promise.resolve({ data: [] as { id: string; name: string }[] }),
		feedItems.length > 0
			? supabase
					.from('work_item_updates')
					.select('id, work_item_id, health, body_md, created_at, author_id')
					.in('work_item_id', feedItems.map((p) => p.id))
					.order('created_at', { ascending: false })
					.limit(8)
			: Promise.resolve({ data: [] as { id: string; work_item_id: string; health: string; body_md: string | null; created_at: string; author_id: string | null }[] }),
		leadIds.length > 0
			? supabase
					.from('work_item_updates')
					.select('work_item_id, health, created_at')
					.in('work_item_id', leadIds)
					.order('created_at', { ascending: false })
			: Promise.resolve({ data: [] as { work_item_id: string; health: string; created_at: string }[] }),
	]);

	const legacyProjectNames: Record<string, string> = {};
	for (const r of legacyParentsRes.data ?? []) legacyProjectNames[r.id] = r.name;

	const profileName = (id: string | null): string | null => {
		if (!id) return null;
		const p = support.profiles.find((x) => x.id === id);
		if (!p) return null;
		return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
	};

	const updates: FeedUpdate[] = (updatesRes.data ?? []).map((u) => ({
		id: u.id,
		itemId: u.work_item_id,
		itemName: feedNameById.get(u.work_item_id) ?? 'a work item',
		health: u.health,
		body: u.body_md,
		createdAt: u.created_at,
		authorName: profileName(u.author_id),
	}));

	// Latest health update per lead item (rows come back newest-first).
	const latestByItem = new Map<string, { created_at: string; health: string }>();
	for (const u of leadUpdatesRes.data ?? []) {
		if (!latestByItem.has(u.work_item_id)) {
			latestByItem.set(u.work_item_id, { created_at: u.created_at, health: u.health });
		}
	}
	const leadItems: LeadItem[] = leadItemsRaw.map((l) => ({
		id: l.id,
		name: l.name,
		kind: l.kind,
		status: l.status,
		owner_id: l.owner_id,
		ownerName: profileName(l.owner_id),
		updated_at: l.updated_at,
		lastUpdateAt: latestByItem.get(l.id)?.created_at ?? null,
		lastHealth: latestByItem.get(l.id)?.health ?? null,
	}));

	// 0089: department label comes from tags, not the retired text column.
	const deptLabels = departmentLabelById(await loadDepartments(supabase));
	const reportProfiles: ReportProfile[] = reports.map((r) => ({
		id: r.id,
		name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed',
		department: deptLabels.get(r.department_tag_id ?? '') ?? null,
	}));

	// Pending actions from Sessions (call_suggested_tasks, 0056): suggestions
	// the AI raised on calls the viewer attended, or that name the viewer (or
	// one of their direct reports) as suggested owner. RLS (can_view_call)
	// already limits the read to the viewer's own / direct reports' calls;
	// exec/admin see every call, so the ownership filter below is what keeps
	// this tab "mine or my team's" rather than the whole company's inbox.
	const sessionActions = await loadSessionActions(supabase, {
		viewerId: userId,
		viewerEmail: (profile?.email ?? user.email ?? '').toLowerCase(),
		reports: reports.map((r) => r.id),
		reportEmails: reports.map((r) => ((r as { email?: string | null }).email ?? '').toLowerCase()).filter(Boolean),
	});

	// Following = items I follow that someone else owns, still open. The
	// overview shows the count; the queue page has a Following tab.
	const { data: follows } = await supabase.from('work_item_followers').select('work_item_id').eq('user_id', userId).range(0, 1999);
	const followIds = (follows ?? []).map((f) => f.work_item_id as string);
	const followingWork: WorkRow[] = [];
	for (let i = 0; i < followIds.length; i += 150) {
		const { data } = await supabase.from('projects').select(WORK_ITEM_COLUMNS)
			.in('id', followIds.slice(i, i + 150)).eq('archived', false).neq('owner_id', userId).not('status', 'in', terminalList).limit(150);
		followingWork.push(...((data ?? []) as WorkRow[]));
	}

	// Board context (statuses, people, parents, progress) over every row either
	// view can show — the same shape the boards pass to their table and panel.
	const seen = new Set<string>();
	const allRows = [...ownedWork, ...createdWork, ...followingWork].filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
	// The queue needs the full context; the personal page needs progress for
	// the containers it shows (goals, priorities, projects) plus people.
	const ledWork = (ledRes.data ?? []) as WorkRow[];
	const containerRows = [...ownedWork, ...ledWork].filter((w) => LEAD_KINDS.includes(w.kind));
	const ctx = await loadBoardContext(showQueue ? allRows : [...containerRows, ...ownedWork.filter((w) => w.kind === 'assignment')], []);
	// Admin/exec OR the run_scrapers capability (0055): gates the scraper shortcut.
	const canUseRestricted = isElevatedRole(profile?.role) || (await hasCapability('run_scrapers'));
	// null (no row) ≠ [] (chose none) — preserved all the way to resolveQuickActions.
	const quickActionKeys = (quickActionsRow?.keys as string[] | undefined) ?? null;

	const sales = await salesP;
	// Work › Overview "My open requests" — only the overview renders it.
	const openRequests = showQueue ? [] : await loadOpenRequests(supabase, userId);

	if (!showQueue) {
		return (
			<>
				<HomeSetupNotice viewerId={userId} />
				<SelfOverview
					viewerId={userId}
					viewerFirstName={profile?.first_name || 'there'}
					ownedWork={ownedWork}
					createdWork={createdWork}
					terminalStatuses={terminalStatuses}
					statusesByKind={support.statusesByKind}
					profiles={support.profiles}
					events={(eventsRaw ?? []) as AgendaEvent[]}
					updates={updates}
					leadItems={leadItems}
					metricsDue={signals.metricsDue}
					monthLabel={signals.monthLabel}
					checkinPending={signals.checkinWeek !== null}
					computedMonth={signals.computedMonth}
					quickActionKeys={quickActionKeys}
					canUseRestricted={canUseRestricted}
					quickActionsOpen={quickActionsParam === '1'}
					followingCount={followingWork.length}
					sessionActions={sessionActions}
					reports={reportProfiles}
					reportItems={(reportItemsRes.data ?? []) as ReportWorkItem[]}
					connections={(connections ?? []) as CalConnection[]}
					ctx={ctx}
					sales={sales}
					openRequests={openRequests}
					ledWork={ledWork}
					layout={layoutFor(layoutRes.data?.layout ?? null, profile?.role, isLead)}
					layoutIsDefault={!layoutRes.data}
					calibrationOpen={!!calibrationRes.data?.length}
				/>
			</>
		);
	}

	const initialTab = (['work', 'created', 'delegated', 'following', 'sales'] as const).find((t) => t === queue && (t !== 'sales' || sales)) ?? 'work';

	return (
		<>
			{/* What still needs the viewer: check-in, metrics, profile gaps. Renders
			    nothing when there is nothing to do (Sam, 19/08). */}
			<HomeSetupNotice viewerId={userId} />
			<MyWorkView
				initialTab={initialTab}
				viewerId={userId}
				ownedWork={ownedWork}
				createdWork={createdWork}
				followingWork={followingWork}
				legacyTasks={legacyTasks}
				legacyProjectNames={legacyProjectNames}
				ctx={ctx}
				terminalStatuses={terminalStatuses}
				serverToday={new Date().toISOString().slice(0, 10)}
				quickActionKeys={quickActionKeys}
				canUseRestricted={canUseRestricted}
				quickActionsOpen={quickActionsParam === '1'}
				sales={sales}
			/>
		</>
	);
}
