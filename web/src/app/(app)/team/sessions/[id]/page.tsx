// /team/sessions/[id] — call detail (read-only). Every list row (task 3's
// SessionsTable) and the ranking page (task 6) link here.
//
// RLS on `calls`/`call_analyses`/`call_transcripts`/`call_suggested_tasks`
// (migration 0056) already scopes every read to attendee / direct manager of
// an attendee / exec-admin, via can_view_call(). This page adds NO extra
// permission logic: a single `.maybeSingle()` read on `calls` returns null
// both when the id does not exist and when RLS hides it — deliberately
// indistinguishable, both routes to notFound().
//
// A call ingested by the old thin endpoint (before 0056) has no analysis row
// at all: the page still renders the left panel/recording/transcript and
// shows an "Analysis pending" callout instead of the Summary/Rubric/
// Attention/Suggested-tasks tabs' content.
//
// Layout: fixed left panel (identity + participants) beside a tabbed main
// area, ?tab=-driven exactly like /team/sessions' own SessionsTabStrip — see
// the comment above SESSIONS_TABS below for why this mirrors that, not a new
// tab-strip style.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Link from 'next/link';
import { clsx } from 'clsx';
import { notFound } from 'next/navigation';
import { ChevronRight, ExternalLink, Download } from 'lucide-react';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import {
	scoreBand,
	SCORE_BAND_BADGE,
	type CallAnalysisDimension,
	type AttentionPoint,
} from '@/lib/sessions/analysis';
import SuggestionCards, { type SuggestionOwner } from './SuggestionCards';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ tab?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Treatment copied from /team/sessions' SessionsTabStrip (itself copied from
// ProfileTabs.tsx) per the brief — do not invent a third tab-strip style. An
// unknown/malformed ?tab= folds to the first tab, same fold-to-default rule.
const DETAIL_TABS = ['analysis', 'actions', 'summary'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const DETAIL_TAB_LABEL: Record<DetailTab, string> = {
	analysis: 'Analysis',
	actions: 'Actions',
	summary: 'Summary',
};

function parseDetailTab(raw: string | undefined): DetailTab {
	const match = DETAIL_TABS.find((t) => t === raw);
	return match ?? 'analysis';
}

interface CallRow {
	id: string;
	client_id: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	recording_url: string | null;
	attendee_user_ids: string[];
	attendee_external: string[];
}

interface AnalysisMetaRow {
	id: string;
	analyzer: string;
	prompt_version: string | null;
	overall_score: number;
	created_at: string;
}

interface AnalysisFullRow {
	summary_md: string;
	dimensions: CallAnalysisDimension[];
	attention_points: AttentionPoint[];
}

interface SuggestedTaskRow {
	id: string;
	title: string;
	detail_md: string | null;
	suggested_owner_email: string | null;
	status: 'pending' | 'accepted' | 'dismissed';
	created_task_id: string | null;
	decided_by: string | null;
	decided_at: string | null;
}

interface ProfileRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	photo_url: string | null;
	avatar_url: string | null;
}

/** Turns 'client_followup' into 'Client Followup' for the type badge. */
function typeLabel(callType: string): string {
	return callType
		.split('_')
		.map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
		.join(' ');
}

function profileName(p: Pick<ProfileRow, 'first_name' | 'last_name' | 'email'>): string {
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

function initialsOf(p: Pick<ProfileRow, 'first_name' | 'last_name' | 'email'>): string {
	return (
		`${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase() ||
		p.email[0]?.toUpperCase() ||
		'?'
	);
}

/** Small round avatar — photo_url over avatar_url, initials fallback. Plain
 *  <img>, not next/image: the Supabase storage host isn't in next.config's
 *  remotePatterns. Precedent: team/[id]/page.tsx (~L377), team/page.tsx (~L226). */
function Avatar({ profile, size = 'sm' }: { profile: ProfileRow; size?: 'sm' | 'md' }) {
	const photo = profile.photo_url ?? profile.avatar_url;
	const dim = size === 'md' ? 'w-9 h-9 text-xs' : 'w-7 h-7 text-2xs';
	return (
		<div
			className={clsx(
				'rounded-full bg-primary-600 flex items-center justify-center text-white font-bold shrink-0 overflow-hidden',
				dim,
			)}
		>
			{photo ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img src={photo} alt={profileName(profile)} className="w-full h-full object-cover" />
			) : (
				initialsOf(profile)
			)}
		</div>
	);
}

const ATTENTION_TONE: Record<AttentionPoint['severity'], 'info' | 'warning' | 'error'> = {
	info: 'info',
	warning: 'warning',
	critical: 'error',
};

const SUGGESTED_TASK_BADGE: Record<SuggestedTaskRow['status'], 'warning' | 'success' | 'default'> = {
	pending: 'warning',
	accepted: 'success',
	dismissed: 'default',
};

export default async function CallDetailPage({ params, searchParams }: PageProps) {
	const { id } = await params;
	const { tab: tabParam } = await searchParams;
	if (!UUID_RE.test(id)) notFound();

	const tab = parseDetailTab(tabParam);
	const supabase = await createClient();

	// A null `data` here is deliberately indistinguishable between "no such
	// call" and "RLS hides it" — both route to notFound() per the brief. A
	// non-null `error`, however, is neither of those: it's a failed read, and
	// must NOT be swallowed into a 404 (a 404 reads as "this never existed",
	// which is false and unhelpful when the real cause is transient).
	const { data: call, error: callError } = await supabase
		.from('calls')
		.select('id, client_id, call_type, occurred_at, duration_minutes, recording_url, attendee_user_ids, attendee_external')
		.eq('id', id)
		.maybeSingle<CallRow>();

	if (callError) {
		return (
			<>
				<Callout tone="error">Could not load this call — reload the page.</Callout>
			</>
		);
	}
	if (!call) notFound();

	const [
		{ data: clientRow, error: clientError },
		{ data: attendeeProfiles, error: attendeesError },
		{ data: analysesMeta, error: analysesMetaError },
	] = await Promise.all([
		call.client_id
			? supabase.from('clients_v2').select('display_name').eq('id', call.client_id).maybeSingle<{ display_name: string }>()
			: Promise.resolve({ data: null as { display_name: string } | null, error: null }),
		call.attendee_user_ids.length > 0
			? supabase
					.from('profiles')
					.select('id, first_name, last_name, email, photo_url, avatar_url')
					.in('id', call.attendee_user_ids)
					.returns<ProfileRow[]>()
			: Promise.resolve({ data: [] as ProfileRow[], error: null }),
		supabase
			.from('call_analyses')
			.select('id, analyzer, prompt_version, overall_score, created_at')
			.eq('call_id', call.id)
			.order('created_at', { ascending: false })
			.returns<AnalysisMetaRow[]>(),
	]);

	const attendees = attendeeProfiles ?? [];
	const allAnalysesMeta = analysesMeta ?? [];
	// Only trust "no analysis yet" (latestMeta === null) when the meta read
	// itself succeeded — a failed meta read must render as a failure below,
	// never as the legitimate "Analysis pending" empty state.
	const latestMeta = !analysesMetaError ? (allAnalysesMeta[0] ?? null) : null;
	const earlierCount = Math.max(allAnalysesMeta.length - 1, 0);

	const [
		{ data: latestAnalysis, error: latestAnalysisError },
		{ data: suggestedTasks, error: suggestedTasksError },
		{ data: transcript, error: transcriptError },
	] = await Promise.all([
		latestMeta
			? supabase
					.from('call_analyses')
					.select('summary_md, dimensions, attention_points')
					.eq('id', latestMeta.id)
					.maybeSingle<AnalysisFullRow>()
			: Promise.resolve({ data: null as AnalysisFullRow | null, error: null }),
		latestMeta
			? supabase
					.from('call_suggested_tasks')
					.select('id, title, detail_md, suggested_owner_email, status, created_task_id, decided_by, decided_at')
					.eq('call_id', call.id)
					.returns<SuggestedTaskRow[]>()
			: Promise.resolve({ data: [] as SuggestedTaskRow[], error: null }),
		supabase
			.from('call_transcripts')
			.select('content, word_count, language, source')
			.eq('call_id', call.id)
			.maybeSingle<{ content: string; word_count: number | null; language: string | null; source: string | null }>(),
	]);

	// The analysis section as a whole is broken if either its meta read or its
	// full-row read failed — the two are always fetched together and rendered
	// together, so one combined flag drives the analysis tab's top-level branch.
	const analysisSectionFailed = !!analysesMetaError || (!!latestMeta && (!!latestAnalysisError || !latestAnalysis));

	// Suggested owner resolution is scoped to THIS call's attendees only —
	// never a lookup against every profile by email.
	const attendeeByEmail = new Map(attendees.map((p) => [p.email.toLowerCase(), p]));
	const ownerLabel = (email: string | null): string | null => {
		if (!email) return null;
		const match = attendeeByEmail.get(email.toLowerCase());
		return match ? profileName(match) : email;
	};

	// "Internal" is a real, legitimate value (client_id is null) — a FAILED
	// client lookup must not collapse into it, or a transient error would
	// silently misreport a client call as internal.
	const clientName = clientError ? 'Client unavailable' : (clientRow?.display_name ?? 'Internal');

	// Task ids that have a decided suggestion pointing at them, so a link can
	// be rendered on the "accepted" status badge. Best-effort label only: a
	// failed lookup here just falls back to the generic "View task" label
	// already used when a title isn't found — the link itself (built from
	// `created_task_id`, not from this query) still works.
	const createdTaskIds = (suggestedTasks ?? [])
		.map((t) => t.created_task_id)
		.filter((v): v is string => !!v);
	const { data: createdTaskRows } = createdTaskIds.length > 0
		? await supabase.from('projects').select('id, name').in('id', createdTaskIds).returns<{ id: string; name: string }[]>()
		: { data: [] as { id: string; name: string }[] };
	const createdTaskById = new Map((createdTaskRows ?? []).map((t) => [t.id, t.name]));

	// Deciders (decided_by) are frequently NOT this call's attendees — a
	// manager or exec can decide a suggestion without having been on the call.
	// The attendee map above is the wrong source for their name, so resolve
	// separately, scoped to only the decider ids actually present. Best-effort:
	// a failed or incomplete lookup just shows nothing on that row rather than
	// a raw id (per the brief — never surface an id as a name).
	const deciderIds = [...new Set((suggestedTasks ?? []).map((t) => t.decided_by).filter((v): v is string => !!v))];
	const { data: deciderRows } = deciderIds.length > 0
		? await supabase
				.from('profiles')
				.select('id, first_name, last_name, email')
				.in('id', deciderIds)
				.returns<Pick<ProfileRow, 'id' | 'first_name' | 'last_name' | 'email'>[]>()
		: { data: [] as Pick<ProfileRow, 'id' | 'first_name' | 'last_name' | 'email'>[] };
	const deciderById = new Map((deciderRows ?? []).map((p) => [p.id, profileName(p)]));
	const deciderLabel = (userId: string | null): string | null => {
		if (!userId) return null;
		return deciderById.get(userId) ?? null;
	};

	// The accept modal's owner select is scoped to this call's internal
	// attendees. If there are none, the viewer themself still needs a way to
	// accept — fall back to "Me" rather than leaving the select empty and
	// accept unusable.
	let suggestionOwners: SuggestionOwner[] = attendees.map((p) => ({
		id: p.id,
		name: profileName(p),
		email: p.email,
	}));
	let defaultOwnerId: string | null = suggestionOwners[0]?.id ?? null;
	if (suggestionOwners.length === 0) {
		const viewer = await getAuthUser();
		if (viewer) {
			suggestionOwners = [{ id: viewer.id, name: 'Me', email: viewer.email ?? '' }];
			defaultOwnerId = viewer.id;
		}
	}

	const pendingSuggestions = (suggestedTasks ?? []).filter((t) => t.status === 'pending');
	const acceptedSuggestions = (suggestedTasks ?? []).filter((t) => t.status === 'accepted');
	const dismissedSuggestions = (suggestedTasks ?? []).filter((t) => t.status === 'dismissed');

	const tabHref = (t: DetailTab) => (t === 'analysis' ? `/team/sessions/${call.id}` : `/team/sessions/${call.id}?tab=${t}`);

	return (
		<>
			<div className="space-y-4">
				<div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
					<Link href="/team/sessions" className="hover:text-primary-600 transition-colors">Team</Link>
					<ChevronRight className="w-3 h-3" />
					<Link href="/team/sessions" className="hover:text-primary-600 transition-colors">Sessions</Link>
					<ChevronRight className="w-3 h-3" />
					<span className="text-slate-700 dark:text-slate-300 font-medium">
						{clientName} — {formatDate(call.occurred_at)}
					</span>
				</div>

				<div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
					{/* Left panel — identity + participants. Persistent across every
					    tab, per the reference app's fixed-left-panel layout. */}
					<div className="lg:col-span-1 space-y-4">
						<Card>
							<h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 break-words">
								{clientName}
							</h1>
							<p className="mt-1 text-sm text-slate-500">{formatDate(call.occurred_at)}</p>
							<div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mt-2">
								<Badge>{typeLabel(call.call_type)}</Badge>
								<span aria-hidden="true">·</span>
								<span>{call.duration_minutes != null ? `${call.duration_minutes} min` : 'Duration unknown'}</span>
							</div>
							{latestMeta && (
								<div className="mt-3">
									<Badge color={SCORE_BAND_BADGE[scoreBand(latestMeta.overall_score)]} className="text-base px-3 py-1">
										{latestMeta.overall_score.toFixed(1)}
									</Badge>
								</div>
							)}
						</Card>

						<Card>
							<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-2">Participants</div>
							{attendeesError ? (
								<Callout tone="error">Could not load attendees — reload the page.</Callout>
							) : attendees.length === 0 && call.attendee_external.length === 0 ? (
								<p className="text-sm text-slate-400">—</p>
							) : (
								<div className="space-y-2">
									{attendees.map((p) => (
										<Link
											key={p.id}
											href={`/team/${p.id}`}
											className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 hover:text-primary-600 transition-colors min-w-0"
										>
											<Avatar profile={p} />
											<span className="truncate">{profileName(p)}</span>
										</Link>
									))}
									{call.attendee_external.map((email) => (
										<div key={email} className="flex items-center gap-2 text-sm min-w-0">
											<div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" aria-hidden="true" />
											<span className="text-slate-500 dark:text-slate-400 truncate">{email}</span>
										</div>
									))}
								</div>
							)}
						</Card>

						<Card>
							<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1">Recording</div>
							{call.recording_url ? (
								<a
									href={call.recording_url}
									target="_blank"
									rel="noreferrer"
									className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1"
								>
									<ExternalLink className="w-3.5 h-3.5" /> Open recording
								</a>
							) : (
								<p className="text-sm text-slate-400">No recording</p>
							)}
						</Card>
					</div>

					{/* Main column — tabbed. */}
					<div className="lg:col-span-3 space-y-4">
						<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 -mx-1 px-1 overflow-x-auto">
							{DETAIL_TABS.map((key) => {
								const isActive = key === tab;
								return (
									<Link
										key={key}
										href={tabHref(key)}
										aria-current={isActive ? 'page' : undefined}
										className={clsx(
											'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
											isActive
												? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
												: 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
										)}
									>
										{DETAIL_TAB_LABEL[key]}
									</Link>
								);
							})}
						</div>

						{tab === 'analysis' && (
							<>
								{analysisSectionFailed ? (
									<Callout tone="error">Could not load the analysis — reload the page.</Callout>
								) : !latestAnalysis ? (
									<Callout tone="info">Analysis pending — this call has not been scored yet.</Callout>
								) : (
									<>
										<Card>
											<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-3">Rubric</div>
											<div className="space-y-3">
												{latestAnalysis.dimensions.map((d, i) => (
													<div key={i}>
														<div className="flex items-center justify-between gap-2 text-sm">
															<span className="text-slate-700 dark:text-slate-300 font-medium">{d.dimension}</span>
															<span className="text-slate-500 tabular-nums">{d.score.toFixed(1)}</span>
														</div>
														<div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
															<div
																className="h-full rounded-full bg-primary-500"
																style={{ width: `${d.score * 10}%` }}
															/>
														</div>
														{d.note && (
															<p className="mt-1 text-xs text-slate-500">{d.note}</p>
														)}
													</div>
												))}
											</div>
										</Card>

										<Card>
											<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-2">Attention points</div>
											{latestAnalysis.attention_points.length === 0 ? (
												<p className="text-sm text-slate-400">No attention points flagged.</p>
											) : (
												<div className="space-y-2">
													{latestAnalysis.attention_points.map((p, i) => (
														<Callout key={i} tone={ATTENTION_TONE[p.severity]}>
															{p.point}
														</Callout>
													))}
												</div>
											)}
										</Card>
									</>
								)}
							</>
						)}

						{tab === 'actions' && (
							<>
								{analysisSectionFailed ? (
									<Callout tone="error">Could not load the analysis — reload the page.</Callout>
								) : !latestAnalysis ? (
									<Callout tone="info">Analysis pending — this call has not been scored yet.</Callout>
								) : suggestedTasksError ? (
									<Card>
										<Callout tone="error">Could not load suggested tasks — reload the page.</Callout>
									</Card>
								) : (
									<>
										{/* Three lanes over the real status values (pending / accepted /
										    dismissed — the 0056 CHECK constraint's exact set). "To-Do",
										    "Accepted" and "Dismissed" are UI labels for those, not a
										    fourth status the DB can't store. Each lane always renders,
										    with a count, even when empty — never silently omitted. */}
										<Card>
											<div className="flex items-center justify-between mb-2">
												<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">To-Do</div>
												<span className="text-xs text-slate-400 tabular-nums">{pendingSuggestions.length}</span>
											</div>
											{pendingSuggestions.length === 0 ? (
												<p className="text-sm text-slate-400">Nothing pending — every suggestion from this analysis has been decided.</p>
											) : (
												<SuggestionCards
													suggestions={pendingSuggestions.map((t) => ({
														id: t.id,
														title: t.title,
														detail_md: t.detail_md,
														suggested_owner_email: t.suggested_owner_email,
													}))}
													defaultOwnerId={defaultOwnerId}
													owners={suggestionOwners}
													callId={call.id}
												/>
											)}
										</Card>

										<Card>
											<div className="flex items-center justify-between mb-2">
												<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Accepted</div>
												<span className="text-xs text-slate-400 tabular-nums">{acceptedSuggestions.length}</span>
											</div>
											{acceptedSuggestions.length === 0 ? (
												<p className="text-sm text-slate-400">No suggestions accepted yet.</p>
											) : (
												<div className="divide-y divide-slate-200 dark:divide-slate-700">
													{acceptedSuggestions.map((t) => (
														<div key={t.id} className="py-3 first:pt-0 last:pb-0">
															<div className="flex items-start justify-between gap-3">
																<div className="min-w-0">
																	<p className="text-sm font-medium text-slate-800 dark:text-slate-200 break-words">{t.title}</p>
																	{t.detail_md && (
																		<p className="mt-1 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
																			{t.detail_md}
																		</p>
																	)}
																	<p className="mt-1 text-xs text-slate-500">
																		Suggested owner: {ownerLabel(t.suggested_owner_email) ?? '—'}
																	</p>
																	<p className="mt-0.5 text-xs text-slate-400">
																		{deciderLabel(t.decided_by) ? `Accepted by ${deciderLabel(t.decided_by)}` : 'Accepted'}
																		{t.decided_at ? ` · ${formatDate(t.decided_at)}` : ''}
																	</p>
																</div>
																<div className="shrink-0">
																	{t.created_task_id ? (
																		<Link href={`/the-work/${t.created_task_id}`} className="hover:underline">
																			<Badge color={SUGGESTED_TASK_BADGE.accepted}>
																				{createdTaskById.get(t.created_task_id) ?? 'View task'}
																			</Badge>
																		</Link>
																	) : (
																		<Badge color={SUGGESTED_TASK_BADGE.accepted}>accepted</Badge>
																	)}
																</div>
															</div>
														</div>
													))}
												</div>
											)}
										</Card>

										<Card>
											<div className="flex items-center justify-between mb-2">
												<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Dismissed</div>
												<span className="text-xs text-slate-400 tabular-nums">{dismissedSuggestions.length}</span>
											</div>
											{dismissedSuggestions.length === 0 ? (
												<p className="text-sm text-slate-400">No suggestions dismissed.</p>
											) : (
												<div className="divide-y divide-slate-200 dark:divide-slate-700">
													{dismissedSuggestions.map((t) => (
														<div key={t.id} className="py-3 first:pt-0 last:pb-0">
															<div className="flex items-start justify-between gap-3">
																<div className="min-w-0">
																	<p className="text-sm font-medium text-slate-800 dark:text-slate-200 break-words">{t.title}</p>
																	{t.detail_md && (
																		<p className="mt-1 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
																			{t.detail_md}
																		</p>
																	)}
																	<p className="mt-1 text-xs text-slate-500">
																		Suggested owner: {ownerLabel(t.suggested_owner_email) ?? '—'}
																	</p>
																	<p className="mt-0.5 text-xs text-slate-400">
																		{deciderLabel(t.decided_by) ? `Dismissed by ${deciderLabel(t.decided_by)}` : 'Dismissed'}
																		{t.decided_at ? ` · ${formatDate(t.decided_at)}` : ''}
																	</p>
																</div>
																<div className="shrink-0">
																	<Badge color={SUGGESTED_TASK_BADGE.dismissed}>dismissed</Badge>
																</div>
															</div>
														</div>
													))}
												</div>
											)}
										</Card>
									</>
								)}
							</>
						)}

						{tab === 'summary' && (
							<>
								{analysisSectionFailed ? (
									<Callout tone="error">Could not load the analysis — reload the page.</Callout>
								) : !latestAnalysis ? (
									<Callout tone="info">Analysis pending — this call has not been scored yet.</Callout>
								) : (
									<Card>
										<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-2">Summary</div>
										<p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
											{latestAnalysis.summary_md}
										</p>
									</Card>
								)}

								{latestMeta && (
									<Card>
										<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1">Analysis</div>
										<div className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
											<div className="flex items-center justify-between py-1.5">
												<span className="text-slate-500">Analyzer</span>
												<span className="text-slate-700 dark:text-slate-300">{latestMeta.analyzer}</span>
											</div>
											{latestMeta.prompt_version && (
												<div className="flex items-center justify-between py-1.5">
													<span className="text-slate-500">Prompt version</span>
													<span className="text-slate-700 dark:text-slate-300">{latestMeta.prompt_version}</span>
												</div>
											)}
											<div className="flex items-center justify-between py-1.5">
												<span className="text-slate-500">Created</span>
												<span className="text-slate-700 dark:text-slate-300">{formatDate(latestMeta.created_at)}</span>
											</div>
										</div>
										{earlierCount > 0 && (
											<p className="mt-2 text-xs text-slate-500">
												{earlierCount} earlier {earlierCount === 1 ? 'analysis' : 'analyses'}
											</p>
										)}
									</Card>
								)}

								{transcriptError ? (
									<Callout tone="error">Could not load the transcript — reload the page.</Callout>
								) : transcript ? (
									<Card>
										<div className="flex items-start justify-between gap-3 flex-wrap">
											<div className="min-w-0">
												<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1">Transcript</div>
												<p className="text-xs text-slate-500">
													{transcript.word_count ?? 0} words
													{transcript.language ? ` · ${transcript.language}` : ''}
													{transcript.source ? ` · ${transcript.source}` : ''}
												</p>
											</div>
											<a
												href={`/team/sessions/${call.id}/transcript`}
												className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1 shrink-0"
											>
												<Download className="w-3.5 h-3.5" /> Download .txt
											</a>
										</div>
										<details className="mt-2">
											<summary className="text-xs text-slate-500 cursor-pointer">Preview</summary>
											<div className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
												{transcript.content}
											</div>
										</details>
									</Card>
								) : (
									<p className="text-xs text-slate-400">No transcript stored for this call.</p>
								)}
							</>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
