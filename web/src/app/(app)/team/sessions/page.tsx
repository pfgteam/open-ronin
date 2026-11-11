// /team/sessions — every recorded call, scored and actionable.
//
// RLS on `calls` (migration 0056) already scopes rows to attendee / direct
// manager of an attendee / exec-admin, so this page adds NO extra permission
// gate — a contributor's own calls are exactly what they should see here.
//
// Filters: ?type= and ?month=YYYY-MM are applied server-side in the `calls`
// read (SQL). `Needs attention` is NOT — see the comment above needsAttention
// below for why, and how it's computed instead.

import Link from 'next/link';
import { clsx } from 'clsx';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { formatDate, businessToday } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { latestAnalysisPerCall, scoreBand, SCORE_BAND_BADGE, type CallAnalysisDimension } from '@/lib/sessions/analysis';
import { buildRanking } from '@/lib/sessions/ranking';
import { canManagePeople, loadSensitiveAccessContext } from '@/lib/people/permissions';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SessionsTable, { type SessionRow } from './SessionsTable';
import AttendeeFilter from './AttendeeFilter';
import { Suspense } from 'react';

// Calls per page on the calls tab. Was a flat 50-row window with a "older
// ones are not listed" notice and a TODO for real paging (Sam asked for
// it on 09/09/2026 so older calls are reachable).
const CALLS_PAGE_SIZE = 50;

const SESSIONS_TABS = ['calls', 'ranking'] as const;
type SessionsTab = (typeof SESSIONS_TABS)[number];

/** An unknown, malformed, or not-permitted ?tab= folds to `calls` rather than
 *  rendering an empty/broken page — same fold-to-default rule as
 *  parseProfileTab in ProfileTabs.tsx. */
function parseSessionsTab(raw: string | undefined, canRanking: boolean): SessionsTab {
	return raw === 'ranking' && canRanking ? 'ranking' : 'calls';
}

const SESSIONS_TAB_LABEL: Record<SessionsTab, string> = {
	calls: 'Calls',
	ranking: 'Ranking',
};

// Treatment copied from ProfileTabs.tsx (web/src/app/team/[id]/ProfileTabs.tsx)
// per the brief — do not invent a third tab-strip style.
function SessionsTabStrip({
	active,
	hrefFor,
}: {
	active: SessionsTab;
	hrefFor: (tab: SessionsTab) => string;
}) {
	return (
		<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 -mx-1 px-1 mb-4 overflow-x-auto">
			{SESSIONS_TABS.map((key) => {
				const isActive = key === active;
				return (
					<Link
						key={key}
						href={hrefFor(key)}
						aria-current={isActive ? 'page' : undefined}
						className={clsx(
							'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
							isActive
								? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
								: 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
						)}
					>
						{SESSIONS_TAB_LABEL[key]}
					</Link>
				);
			})}
		</div>
	);
}

export const metadata = { title: 'Sessions' };

export const dynamic = 'force-dynamic';

interface CallRow {
	id: string;
	client_id: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	attendee_user_ids: string[];
}

interface AnalysisRow {
	call_id: string;
	overall_score: number;
	attention_points: { severity: 'info' | 'warning' | 'critical'; point: string }[];
	created_at: string;
}

interface SuggestedTaskRow {
	call_id: string;
	status: string;
}

interface ClientRow {
	id: string;
	display_name: string;
}

interface ProfileRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	photo_url: string | null;
	avatar_url: string | null;
}

interface RankingCallRow {
	id: string;
	client_id: string | null;
	occurred_at: string;
	attendee_user_ids: string[];
}

interface RankingAnalysisRow {
	call_id: string;
	overall_score: number;
	dimensions: CallAnalysisDimension[];
	created_at: string;
}

interface RankingProfileRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
}

interface ScoredCallRow {
	id: string;
	occurredAt: string;
	clientName: string;
	score: number;
}

// Shared by the "Best calls" / "Needs review" halves of the ranking tab —
// real links (not a row onClick) per the standing rule from the calls table.
function ScoredCallsCard({ title, rows }: { title: string; rows: ScoredCallRow[] }) {
	return (
		<Card padding="none" className="overflow-hidden">
			<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300">
				{title}
			</div>
			{rows.length === 0 ? (
				<p className="px-4 py-6 text-sm text-slate-400 text-center">No scored calls.</p>
			) : (
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{rows.map((r) => (
						<li key={r.id}>
							<Link
								href={`/team/sessions/${r.id}`}
								className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-hover transition-colors"
							>
								<span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
									{r.clientName} — {formatDate(r.occurredAt)}
								</span>
								<Badge color={SCORE_BAND_BADGE[scoreBand(r.score)]}>{r.score.toFixed(1)}</Badge>
							</Link>
						</li>
					))}
				</ul>
			)}
		</Card>
	);
}

/** Turns 'client_followup' into 'Client Followup' for chip/badge labels. */
function typeLabel(callType: string): string {
	return callType
		.split('_')
		.map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
		.join(' ');
}

function monthRange(ym: string): { startIso: string; endIso: string } {
	const [y, m] = ym.split('-').map(Number);
	const start = new Date(Date.UTC(y, m - 1, 1));
	const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
	return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function shiftMonth(ym: string, delta: number): string {
	const [y, m] = ym.split('-').map(Number);
	const d = new Date(Date.UTC(y, m - 1 + delta, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Filters are plain Links that rewrite the query string (server-side
// re-fetch), not client state — so they can't reuse the button-based
// FilterChip component (a <button> can't wrap an <a>). This mirrors
// FilterChip's own pill visuals so the two read as one filter language.
function ChipLink({
	href,
	active,
	tone = 'default',
	count,
	children,
}: {
	href: string;
	active: boolean;
	tone?: 'default' | 'warning';
	count?: number;
	children: React.ReactNode;
}) {
	const toneClasses =
		tone === 'warning'
			? active
				? 'bg-amber-500 border-amber-500 text-white'
				: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
			: active
				? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
				: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600';
	return (
		<Link
			href={href}
			className={clsx('text-xs px-2.5 py-1 rounded-full border transition-colors', toneClasses)}
		>
			{children}
			{count != null && <span className="ml-1.5 tabular-nums opacity-60">{count}</span>}
		</Link>
	);
}

export default async function SessionsPage({
	searchParams,
}: {
	searchParams: Promise<{
		type?: string;
		month?: string;
		attention?: string;
		tab?: string;
		p?: string;
		person?: string;
	}>;
}) {
	const { type: typeParam, month, attention, tab: tabParam, p: pParam, person: personParam } = await searchParams;
	// ?person= narrows the calls tab to sessions the profile attended.
	const person = /^[0-9a-f-]{36}$/i.test(personParam ?? '') ? (personParam as string) : null;
	// ?p= pages the calls tab, 1-based. Unparseable folds to page 1 — it is a
	// view offset, not input worth refusing.
	const pageParam = Math.max(1, Number.parseInt(pParam ?? '', 10) || 1);
	const ym = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : businessToday().slice(0, 7);
	const { startIso, endIso } = monthRange(ym);
	const monthLabel = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});

	const accessCtx = await loadSensitiveAccessContext();
	const canRank = canManagePeople(accessCtx);
	const tab = parseSessionsTab(tabParam, canRank);

	const supabase = await createClient();

	// Shared by both tabs: month nav + tab-strip links all go through this, so
	// `month`/`type` (and the active tab) always survive a navigation — see
	// the brief's note about the withParam helper.
	const withParam = (params: {
		type?: string;
		attention?: string;
		month?: string;
		tab?: SessionsTab;
		/** Calls-tab page. Omitted resets to page 1, which is what changing a
		 *  month, a type or the attention filter should do — keeping ?p= across
		 *  a filter change lands you on a page that may not exist. */
		page?: number;
	}) => {
		const usp = new URLSearchParams();
		usp.set('month', params.month ?? ym);
		if (params.type) usp.set('type', params.type);
		if (params.attention) usp.set('attention', params.attention);
		if (person) usp.set('person', person);
		const tabValue = params.tab ?? tab;
		if (tabValue !== 'calls') usp.set('tab', tabValue);
		if (params.page && params.page > 1) usp.set('p', String(params.page));
		return `/team/sessions?${usp.toString()}`;
	};

	const monthNav = (
		<div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
			<Link
				href={withParam({ type: typeParam, attention, month: shiftMonth(ym, -1) })}
				className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/45"
				aria-label="Previous month"
			>
				<ChevronLeft className="w-4 h-4" />
			</Link>
			<span className="min-w-28 text-center">{monthLabel}</span>
			<Link
				href={withParam({ type: typeParam, attention, month: shiftMonth(ym, 1) })}
				className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/45"
				aria-label="Next month"
			>
				<ChevronRight className="w-4 h-4" />
			</Link>
		</div>
	);

	if (tab === 'ranking') {
		const rankCallsQuery = supabase
			.from('calls')
			.select('id, client_id, occurred_at, attendee_user_ids')
			.gte('occurred_at', startIso)
			.lt('occurred_at', endIso)
			.order('occurred_at', { ascending: false });

		const { data: rankCallsData, error: rankCallsError } = await rankCallsQuery.returns<RankingCallRow[]>();
		const rankCalls = rankCallsData ?? [];

		const rankCallIds = rankCalls.map((c) => c.id);
		const rankClientIds = [...new Set(rankCalls.map((c) => c.client_id).filter((v): v is string => !!v))];
		const rankAttendeeIds = [...new Set(rankCalls.flatMap((c) => c.attendee_user_ids ?? []))];

		const [rankAnalysesRes, rankTasksRes, rankClientsRes, rankProfilesRes] = await Promise.all([
			rankCallIds.length
				? supabase
						.from('call_analyses')
						.select('call_id, overall_score, dimensions, created_at')
						.in('call_id', rankCallIds)
						.returns<RankingAnalysisRow[]>()
				: Promise.resolve({ data: [] as RankingAnalysisRow[], error: null }),
			rankCallIds.length
				? supabase
						.from('call_suggested_tasks')
						.select('call_id, status')
						.in('call_id', rankCallIds)
						.returns<SuggestedTaskRow[]>()
				: Promise.resolve({ data: [] as SuggestedTaskRow[], error: null }),
			rankClientIds.length
				? supabase
						.from('clients_v2')
						.select('id, display_name')
						.in('id', rankClientIds)
						.returns<ClientRow[]>()
				: Promise.resolve({ data: [] as ClientRow[], error: null }),
			rankAttendeeIds.length
				? supabase
						.from('profiles')
						.select('id, first_name, last_name')
						.in('id', rankAttendeeIds)
						.returns<RankingProfileRow[]>()
				: Promise.resolve({ data: [] as RankingProfileRow[], error: null }),
		]);

		// Same standing rule as the calls tab: a failed read renders its own
		// message, never the reassuring empty state.
		const rankError =
			rankCallsError?.message ??
			rankAnalysesRes.error?.message ??
			rankTasksRes.error?.message ??
			rankClientsRes.error?.message ??
			rankProfilesRes.error?.message ??
			null;

		const rankPendingByCall = new Map<string, number>();
		for (const t of rankTasksRes.data ?? []) {
			if (t.status !== 'pending') continue;
			rankPendingByCall.set(t.call_id, (rankPendingByCall.get(t.call_id) ?? 0) + 1);
		}

		const rankClientById = new Map((rankClientsRes.data ?? []).map((c) => [c.id, c.display_name]));
		const rankProfileById = new Map((rankProfilesRes.data ?? []).map((p) => [p.id, p]));
		const personName = (id: string): string => {
			const p = rankProfileById.get(id);
			if (!p) return 'Unknown';
			return [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown';
		};

		const ranking = rankError
			? []
			: buildRanking({
					calls: rankCalls,
					analyses: rankAnalysesRes.data ?? [],
					pendingByCall: rankPendingByCall,
				});

		const latestByRankCall = latestAnalysisPerCall(rankAnalysesRes.data ?? []);
		const scoredCalls: ScoredCallRow[] = rankCalls
			.map((c) => {
				const analysis = latestByRankCall.get(c.id);
				if (!analysis) return null;
				return {
					id: c.id,
					occurredAt: c.occurred_at,
					clientName: c.client_id ? (rankClientById.get(c.client_id) ?? 'Unknown client') : 'Internal',
					score: analysis.overall_score,
				};
			})
			.filter((r): r is ScoredCallRow => r !== null);

		// Opposite ends of ONE sorted array, never overlapping: with <=10 scored
		// calls the naive "top 5 / bottom 5 of independent sorts" shows the SAME
		// calls in both cards (one list just reversed) — a call would read as
		// both a highlight and a problem. `bottomSorted` is worst-first (what a
		// manager scanning "Needs review" wants to see first), built by
		// reversing the slice taken from the high-to-low `sorted` array.
		const sortedByScoreDesc = [...scoredCalls].sort((a, b) => b.score - a.score);
		const bestCalls = sortedByScoreDesc.slice(0, 5);
		const worstCalls = sortedByScoreDesc.slice(Math.max(5, sortedByScoreDesc.length - 5)).reverse();

		return (
			<>
				<PageHeader
					title="Sessions"
					description="Every recorded call, scored and actionable."
					actions={monthNav}
				/>

				<SessionsTabStrip
					active={tab}
					hrefFor={(t) => withParam({ type: typeParam, attention, month: ym, tab: t })}
				/>

				{rankError ? (
					<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">
							<strong>Could not load the ranking</strong> — reload the page.
						</p>
					</Card>
				) : scoredCalls.length === 0 ? (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
							No scored calls in this window.
						</p>
					</Card>
				) : (
					<div className="space-y-4">
						<Card padding="none" className="overflow-hidden">
							<div className="overflow-x-auto">
								<table className="w-full text-sm">
									<thead>
										<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
												Person
											</th>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
												Scored calls
											</th>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
												Avg score
											</th>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
												Worst dimension
											</th>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
												Pending suggestions
											</th>
										</tr>
									</thead>
									<tbody>
										{ranking.map((r) => (
											<tr
												key={r.userId}
												className="border-b border-slate-200 dark:border-slate-700 last:border-0"
											>
												<td className="px-4 py-3">
													<Link
														href={`/team/${r.userId}`}
														className="text-slate-700 dark:text-slate-300 hover:text-primary-600 transition-colors"
													>
														{personName(r.userId)}
													</Link>
												</td>
												<td className="px-4 py-3 text-slate-700 dark:text-slate-300 tabular-nums">
													{r.calls}
												</td>
												<td className="px-4 py-3">
													<Badge color={SCORE_BAND_BADGE[scoreBand(r.avgScore)]}>
														{r.avgScore.toFixed(1)}
													</Badge>
												</td>
												<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
													{r.worstDimension
														? `${r.worstDimension.dimension} (${r.worstDimension.avgScore.toFixed(1)})`
														: '—'}
												</td>
												<td className="px-4 py-3 text-slate-700 dark:text-slate-300 tabular-nums">
													{r.pendingSuggestions}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Card>

						{/* With <=5 scored calls in the window, `worstCalls` and `bestCalls`
						    would be the same set (see the slicing comment above) — rather
						    than show a "Needs review" card duplicating "Best calls", omit
						    it entirely. */}
						<div
							className={clsx(
								'grid grid-cols-1 gap-4',
								worstCalls.length > 0 && 'md:grid-cols-2',
							)}
						>
							<ScoredCallsCard title="Best calls" rows={bestCalls} />
							{worstCalls.length > 0 && (
								<ScoredCallsCard title="Needs review" rows={worstCalls} />
							)}
						</div>
					</div>
				)}
			</>
		);
	}

	// Exact count first so an out-of-range ?p= clamps to the last real page
	// instead of rendering an empty table under a pager claiming rows exist.
	let countQuery = supabase
		.from('calls')
		.select('id', { count: 'exact', head: true })
		.gte('occurred_at', startIso)
		.lt('occurred_at', endIso);
	if (typeParam) countQuery = countQuery.eq('call_type', typeParam);
	if (person) countQuery = countQuery.contains('attendee_user_ids', [person]);
	const { count: callsTotalRaw } = await countQuery;
	const callsTotal = callsTotalRaw ?? 0;
	const callsPageCount = Math.max(1, Math.ceil(callsTotal / CALLS_PAGE_SIZE));
	const callsPage = Math.min(pageParam, callsPageCount);
	const callsFrom = (callsPage - 1) * CALLS_PAGE_SIZE;

	// (occurred_at desc, id) — occurred_at is not unique (a batch ingest can
	// land several calls on the same timestamp), and a tie under a stable sort
	// silently drops or repeats rows across pages.
	let callsQuery = supabase
		.from('calls')
		.select('id, client_id, call_type, occurred_at, duration_minutes, attendee_user_ids')
		.gte('occurred_at', startIso)
		.lt('occurred_at', endIso)
		.order('occurred_at', { ascending: false })
		.order('id')
		.range(callsFrom, callsFrom + CALLS_PAGE_SIZE - 1);
	if (typeParam) callsQuery = callsQuery.eq('call_type', typeParam);
	if (person) callsQuery = callsQuery.contains('attendee_user_ids', [person]);

	const { data: callsData, error: callsError } = await callsQuery.returns<CallRow[]>();
	const calls = callsData ?? [];

	const callIds = calls.map((c) => c.id);
	const clientIds = [...new Set(calls.map((c) => c.client_id).filter((v): v is string => !!v))];
	const attendeeIds = [...new Set(calls.flatMap((c) => c.attendee_user_ids ?? []))];

	const [analysesRes, tasksRes, clientsRes, profilesRes] = await Promise.all([
		callIds.length
			? supabase
					.from('call_analyses')
					.select('call_id, overall_score, attention_points, created_at')
					.in('call_id', callIds)
					.returns<AnalysisRow[]>()
			: Promise.resolve({ data: [] as AnalysisRow[], error: null }),
		callIds.length
			? supabase
					.from('call_suggested_tasks')
					.select('call_id, status')
					.in('call_id', callIds)
					.returns<SuggestedTaskRow[]>()
			: Promise.resolve({ data: [] as SuggestedTaskRow[], error: null }),
		clientIds.length
			? supabase
					.from('clients_v2')
					.select('id, display_name')
					.in('id', clientIds)
					.returns<ClientRow[]>()
			: Promise.resolve({ data: [] as ClientRow[], error: null }),
		attendeeIds.length
			? supabase
					// photo_url/avatar_url dropped from the select — the table
					// renders first names only. Re-add when the avatar cluster ships.
					.from('profiles')
					.select('id, first_name, last_name')
					.in('id', attendeeIds)
					.returns<ProfileRow[]>()
			: Promise.resolve({ data: [] as ProfileRow[], error: null }),
	]);

	// A failed read must render its own message — never the reassuring empty
	// state (standing rule from a previous shipped bug).
	const error =
		callsError?.message ??
		analysesRes.error?.message ??
		tasksRes.error?.message ??
		clientsRes.error?.message ??
		profilesRes.error?.message ??
		null;

	// "Select by person": everyone who attended a call this month (not just on
	// this page), so the list does not shrink as you page. RLS already scopes
	// the calls read, so the options only ever name people the viewer may see.
	const { data: monthAttendeeRows } = await supabase
		.from('calls')
		.select('attendee_user_ids')
		.gte('occurred_at', startIso)
		.lt('occurred_at', endIso)
		.returns<{ attendee_user_ids: string[] | null }[]>();
	const monthAttendeeIds = [...new Set((monthAttendeeRows ?? []).flatMap((c) => c.attendee_user_ids ?? []))];
	const knownIds = new Set(attendeeIds);
	const extraIds = monthAttendeeIds.filter((id) => !knownIds.has(id));
	const { data: extraProfiles } = extraIds.length
		? await supabase.from('profiles').select('id, first_name, last_name').in('id', extraIds).returns<ProfileRow[]>()
		: { data: [] as ProfileRow[] };
	const attendeeOptions = [...(profilesRes.data ?? []), ...(extraProfiles ?? [])]
		.map((p) => ({ id: p.id, label: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown' }))
		.sort((a, b) => a.label.localeCompare(b.label));

	const latestByCall = latestAnalysisPerCall(analysesRes.data ?? []);

	const pendingByCall = new Map<string, number>();
	for (const t of tasksRes.data ?? []) {
		if (t.status !== 'pending') continue;
		pendingByCall.set(t.call_id, (pendingByCall.get(t.call_id) ?? 0) + 1);
	}

	const clientById = new Map((clientsRes.data ?? []).map((c) => [c.id, c.display_name]));
	const profileById = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));

	const rows: SessionRow[] = calls.map((c) => {
		const analysis = latestByCall.get(c.id);
		const pendingCount = pendingByCall.get(c.id) ?? 0;
		// `Needs attention` can't be a SQL filter: it depends on the LATEST
		// call_analyses row per call (an append-only table — "latest" is a
		// window function / distinct-on, not a plain WHERE) combined with a
		// pending-count join. Simplest and clearest to compute it here, in
		// memory, over the page window we already fetched — never attempted
		// as a query.
		const hasAttentionPoint = (analysis?.attention_points ?? []).some(
			(p) => p.severity === 'warning' || p.severity === 'critical',
		);
		const needsAttention = hasAttentionPoint || pendingCount > 0;

		const attendeeNames = (c.attendee_user_ids ?? [])
			.map((id) => profileById.get(id))
			.filter((p): p is ProfileRow => !!p)
			.map((p) => p.first_name || p.last_name || 'Unknown');

		return {
			id: c.id,
			occurredAt: c.occurred_at,
			callType: c.call_type,
			typeLabel: typeLabel(c.call_type),
			clientName: c.client_id ? (clientById.get(c.client_id) ?? 'Unknown client') : null,
			attendeeNames,
			durationMinutes: c.duration_minutes,
			score: analysis?.overall_score ?? null,
			pendingCount,
			needsAttention,
		};
	});

	const visibleRows = attention === '1' ? rows.filter((r) => r.needsAttention) : rows;

	// Chips reflect the types present in THIS month's window (before the type
	// filter narrows it to one) — not the full 13/14-value enum, so no dead
	// chips ever render.
	const typesInWindow = [...new Set(calls.map((c) => c.call_type))].sort();

	const attentionCount = rows.filter((r) => r.needsAttention).length;

	return (
		<>
			<PageHeader
				title="Sessions"
				description="Every recorded call, scored and actionable."
				actions={monthNav}
			/>

			{canRank && (
				<SessionsTabStrip
					active={tab}
					hrefFor={(t) => withParam({ type: typeParam, attention, month: ym, tab: t })}
				/>
			)}

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Could not load calls</strong> — reload the page.
					</p>
				</Card>
			)}

			{!error && (
				<>
					<div className="flex flex-wrap items-center gap-2 mb-4">
						{/* Count stays page-scoped, like the type chips beside it: with a
						    type filter active callsTotal is that type's month total, so
						    using it here would label "All" with a filtered number. The
						    month-wide total lives in the pager under the table. */}
						<ChipLink href={withParam({ attention })} active={!typeParam} count={rows.length}>
							All
						</ChipLink>
						{typesInWindow.map((t) => (
							<ChipLink key={t} href={withParam({ type: t, attention })} active={typeParam === t}>
								{typeLabel(t)}
							</ChipLink>
						))}
						<ChipLink
							href={withParam({
								type: typeParam,
								attention: attention === '1' ? undefined : '1',
							})}
							active={attention === '1'}
							tone="warning"
							count={attentionCount}
						>
							Needs attention
						</ChipLink>
						<span className="ml-auto">
							<Suspense fallback={null}>
								<AttendeeFilter people={attendeeOptions} selected={person} />
							</Suspense>
						</span>
					</div>

					{visibleRows.length === 0 ? (
						<Card>
							<p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
								{person
									? 'No calls this month with that attendee.'
									: 'No calls yet. The n8n pipeline delivers them here once it points at /api/ingest/sessions.'}
							</p>
						</Card>
					) : (
						<SessionsTable
							rows={visibleRows}
							// No pager while "Needs attention" is on: that filter runs in
							// memory over the fetched page, so the month-wide counts the
							// pager reports would describe a different set than the rows
							// on screen ("1–50 of 200" above three rows). Month nav still
							// reaches older calls in that mode.
							pager={
								attention === '1'
									? undefined
									: {
											page: callsPage,
											pageCount: callsPageCount,
											total: callsTotal,
											from: callsFrom + 1,
											prevHref:
												callsPage > 1
													? withParam({ type: typeParam, month: ym, page: callsPage - 1 })
													: null,
											nextHref:
												callsPage < callsPageCount
													? withParam({ type: typeParam, month: ym, page: callsPage + 1 })
													: null,
										}
							}
						/>
					)}
				</>
			)}
		</>
	);
}
