// /the-work/calendar — unified calendar fabric.

//
// Source of truth = public.calendar_events. Populated from Google Cal
// sync, Airtable Industry Events, and manual creates via the drawer.
//
// View modes: day / week (default) / month / quarter — chosen via ?view=.
// Unscheduled tasks pool: assigned-to-me work_items where kind='task'
// AND status not terminal AND no calendar_event already linked.

import Card from '@/components/ui/Card';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { tripsToCalendarEvents, type TripRow } from '@/lib/trips/shared';
import CalendarShell from './CalendarShell';

export const metadata = { title: 'Calendar' };

export const dynamic = 'force-dynamic';

type ViewMode = 'day' | 'week' | 'month' | 'quarter';

interface PageProps {
	searchParams: Promise<{ view?: string; date?: string; users?: string; connected?: string; error?: string }>;
}

export default async function CalendarPage({ searchParams }: PageProps) {
	const sp = await searchParams;
	const view: ViewMode = (['day', 'week', 'month', 'quarter'] as const).includes(sp.view as ViewMode)
		? (sp.view as ViewMode) : 'week';

	// Other users whose calendars should overlay on top of mine
	const otherUserIds = (sp.users ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	const supabase = await createClient();
	const userId = (await getAuthUser())?.id;

	const { data: connections } = userId
		? await supabase
			.from('google_calendar_connections')
			.select('id, google_account_email, last_synced_at, sync_status, sync_error, bidirectional')
			.eq('user_id', userId)
		: { data: [] };

	// Window depends on view
	const refDate = sp.date ? new Date(sp.date + 'T00:00:00') : new Date();
	const { start: windowStart, end: windowEnd } = computeWindow(view, refDate);

	// Visible-user set = me + any overlaid colleagues
	const visibleUserIds = [userId, ...otherUserIds].filter((x): x is string => !!x);

	const [{ data: events }, { data: categories }, { data: tasksData }, { data: allProfiles }, tripsRes] = await Promise.all([
		supabase
			.from('calendar_events')
			.select('id, user_id, title, starts_at, ends_at, all_day, category_key, source, location, url, attendee_external, description_md, project_id, visibility')
			.in('user_id', visibleUserIds.length > 0 ? visibleUserIds : ['00000000-0000-0000-0000-000000000000'])
			.gte('starts_at', windowStart.toISOString())
			.lt('starts_at', windowEnd.toISOString())
			.order('starts_at', { ascending: true }),
		supabase.from('calendar_event_categories').select('key, label, color').order('position'),
		userId ? supabase
			.from('projects')
			.select('id, name, kind, priority, ends_at, parent_id')
			.eq('owner_id', userId)
			.in('kind', ['task', 'assignment'])
			.eq('archived', false)
			// Exclude not-yet-actionable + done buckets: backlog stays out of
			// the calendar sidebar, only items the user is actively working on.
			.not('status', 'in', '(backlog,done,discard,cancelled,archived,delivered,abandoned,deprecated)')
			.order('ends_at', { ascending: true, nullsFirst: false })
			.limit(100)
		: Promise.resolve({ data: [] }),
		supabase.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name'),
		// Trips (0111) overlay as all-day Travel chips for the visible users.
		// A missing table (0111 not applied) is a PostgREST error, not a crash:
		// the calendar just shows no trips.
		supabase
			.from('trips')
			.select('id, traveler_id, purpose, client_id, depart_on, return_on, destination, status, cost_usd, notes_md, source, created_at')
			.in('traveler_id', visibleUserIds.length > 0 ? visibleUserIds : ['00000000-0000-0000-0000-000000000000'])
			.lte('depart_on', windowEnd.toISOString().slice(0, 10))
			.gte('return_on', windowStart.toISOString().slice(0, 10))
			.neq('status', 'cancelled'),
	]);

	const profileName = (id: string) => {
		const p = (allProfiles ?? []).find((x) => x.id === id);
		return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email : null;
	};
	const tripEvents = tripsToCalendarEvents(
		(tripsRes.error ? [] : (tripsRes.data ?? [])) as TripRow[],
		profileName,
		windowStart.toISOString(),
		windowEnd.toISOString(),
	);

	// Filter out tasks that already have a calendar event linked (project_id match)
	const scheduledTaskIds = new Set((events ?? []).map((e) => e.project_id).filter(Boolean) as string[]);
	const unscheduledRaw = (tasksData ?? []).filter((t) => !scheduledTaskIds.has(t.id));

	// Pull parent names in one extra query (for display context)
	const parentIds = Array.from(new Set(unscheduledRaw.map((t) => t.parent_id).filter(Boolean) as string[]));
	const parentNameMap = new Map<string, string>();
	if (parentIds.length > 0) {
		const { data: parents } = await supabase
			.from('projects').select('id, name').in('id', parentIds);
		for (const p of parents ?? []) parentNameMap.set(p.id, p.name);
	}

	const unscheduled = unscheduledRaw.map((t) => ({
		id: t.id,
		name: t.name,
		kind: t.kind,
		priority: t.priority,
		ends_at: t.ends_at,
		parent_name: t.parent_id ? parentNameMap.get(t.parent_id) ?? null : null,
	}));

	// Task options for the drawer's "Link to task" dropdown — broader than
	// just unscheduled (lets you link an event to ANY of your open tasks).
	const taskOptions = (tasksData ?? []).map((t) => ({ id: t.id, name: t.name, kind: t.kind }));

	return (
		<>
			{sp.connected === '1' && (
				<Card>
					<div className="text-sm text-green-700 dark:text-green-300">
						✓ Google Calendar connected. Initial sync running — refresh in a minute if events don&apos;t show.
					</div>
				</Card>
			)}
			{sp.error && (
				<Card>
					<div className="text-sm text-red-700 dark:text-red-300">Google Cal: {sp.error}</div>
				</Card>
			)}
			<CalendarShell
				view={view}
				refDate={refDate.toISOString()}
				windowStart={windowStart.toISOString()}
				windowEnd={windowEnd.toISOString()}
				events={[...(events ?? []), ...tripEvents]}
				categories={categories ?? []}
				connections={connections ?? []}
				unscheduled={unscheduled}
				taskOptions={taskOptions}
				profiles={allProfiles ?? []}
				selfId={userId ?? ''}
				otherUserIds={otherUserIds}
			/>
		</>
	);
}

function computeWindow(view: 'day' | 'week' | 'month' | 'quarter', ref: Date): { start: Date; end: Date } {
	if (view === 'day') {
		const start = new Date(ref); start.setHours(0,0,0,0);
		const end = new Date(start); end.setDate(start.getDate() + 1);
		return { start, end };
	}
	if (view === 'week') {
		const day = ref.getDay();
		const diff = day === 0 ? -6 : 1 - day;
		const start = new Date(ref); start.setHours(0,0,0,0); start.setDate(start.getDate() + diff);
		const end = new Date(start); end.setDate(start.getDate() + 7);
		return { start, end };
	}
	if (view === 'month') {
		const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
		const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
		return { start, end };
	}
	// quarter
	const q = Math.floor(ref.getMonth() / 3);
	const start = new Date(ref.getFullYear(), q * 3, 1);
	const end = new Date(ref.getFullYear(), q * 3 + 3, 1);
	return { start, end };
}
