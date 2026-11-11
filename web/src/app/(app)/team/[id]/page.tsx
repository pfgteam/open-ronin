// /team/[id] - Team member profile detail.
// Sensitive sections (PAP, comp, HR notes) are visibility-gated via
// can_view_sensitive (matches the Supabase RLS function).

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import RequestButton from '@/components/nav/RequestButton';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canViewSensitive, canManagePeople, canEditFourR } from '@/lib/people/permissions';
import {
	ChevronLeft, Mail, MapPin, Calendar as CalIcon, User as UserIcon, Briefcase,
	Award, FileText, ExternalLink, AlertCircle, DollarSign, Lock, Pencil, ClipboardList,
} from 'lucide-react';
import { formatDate, formatCurrency, businessToday } from '@/lib/format';
import { Field as FormField, FormError, inputClass, selectClass } from '../_form';
import { addProfileDoc, removeProfileDoc } from './docs-actions';
import MetricsSection from './MetricsSection';
import CheckinSection from './CheckinSection';
import FourRSection from './FourRSection';
import {
	draftFromTemplate, emptyDraft, isInLeadershipChain, pickFourRTemplate,
	type FourRRevision, type FourRTemplate, type ProfileFourR,
} from '@/lib/people/fourR';
import { DOC_KINDS } from '@/lib/people/constants';
import { formatPosition } from '@/lib/people/position';
import AvatarUpload from './AvatarUpload';
import { resolveMetricRows, type MetricOverride } from '@/lib/people/metricRows';
import { loadCheckinState } from '@/lib/home/signals';
import { buildProfileStats, type ProfileStat } from '@/lib/people/profileStats';
import ProfileTabs, { parseProfileTab, type ProfileTab } from './ProfileTabs';
import { loadProfileWork, WorkNowCard, WorkTab } from './ProfileWork';
import TabHashRedirect from './TabHashRedirect';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
	searchParams: Promise<{
		tab?: string;
		docsError?: string;
		month?: string;
		metricsSaved?: string;
		metricsError?: string;
		metricsSet?: string;
		metricsSetSaved?: string;
		week?: string;
		checkinSaved?: string;
		checkinError?: string;
	}>;
}

interface MetricValueRow {
	metric_key: string;
	value: number | null;
	goal: number | null;
	source: string;
}

/** Columns of `metric_definitions` (0025 + 0028's pap_positions) that the
 *  header strip AND MetricsSection between them need. Read once here. */
interface MetricDefRow {
	key: string;
	name: string;
	description: string | null;
	pap_positions: string[];
	unit: string | null;
	requires_goal: boolean;
	source: string;
	sort: number;
}

/** A `staff_requests` row of kind 'time_off' (0043). */
interface TimeOffRow {
	id: string;
	title: string;
	payload: { starts_on?: string; ends_on?: string; time_off_kind?: string };
	status: string;
	decision_note_md: string | null;
	created_at: string;
}

interface ProfileDocRow {
	id: string;
	kind: string;
	title: string;
	drive_url: string;
	created_at: string;
}

const DOC_KIND_LABELS: Record<string, string> = {
	'4r': '4R',
	pap: 'PAP',
	other: 'Doc',
};

export default async function ProfileDetailPage({ params, searchParams }: PageProps) {
	const { id } = await params;
	const {
		tab, docsError, month, metricsSaved, metricsError, metricsSet, metricsSetSaved,
		week, checkinSaved, checkinError,
	} = await searchParams;
	const supabase = await createClient();

	const [{ data: profile }, ctx] = await Promise.all([
		supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
		loadSensitiveAccessContext(),
	]);

	if (!profile) notFound();

	const canSeeSensitive = canViewSensitive(ctx, id);
	const canEditProfile = ctx.viewerId === id || canManagePeople(ctx);
	// 4R/PAP docs (decision 2026-08-18): the person, their DIRECT manager,
	// people-managers, exec/admin. Deliberately broader than comp — a direct
	// manager sees the 4R without seeing compensation. RLS mirrors this.
	const canSeeDocs =
		ctx.viewerId === id || canManagePeople(ctx) || (!!ctx.viewerId && profile.manager_id === ctx.viewerId);
	const canManageDocs = canManagePeople(ctx);

	// ----- which tab -----------------------------------------------------------
	// Overview / PAP / Docs / Time off are always offered (PAP shows the
	// lock placeholder to a viewer without access — the same thing the page has
	// always shown). Metrics and Check-ins exist only for the audience that can
	// read them, and asking for one you cannot see falls back to Overview rather
	// than rendering an empty page.
	// 4R (0093) is readable by every signed-in user, so it is always offered.
	const availableTabs: ProfileTab[] = canSeeDocs
		? ['overview', 'work', 'metrics', 'checkins', 'fourr', 'pap', 'docs', 'timeoff']
		: ['overview', 'work', 'fourr', 'pap', 'docs', 'timeoff'];
	const activeTab = parseProfileTab(tab, availableTabs);
	// Work card (Overview) and Work tab read the same thing; other tabs skip it.
	const workData = activeTab === 'overview' || activeTab === 'work' ? await loadProfileWork(id) : null;

	// Only the ACTIVE tab's data is fetched. That is the whole point of putting
	// the tab in the URL: an unvisited tab costs no queries.
	let profileDocs: ProfileDocRow[] = [];
	let sensitive: SensitiveRow | null = null;
	if (activeTab === 'docs' || activeTab === 'pap') {
		if (canSeeDocs && activeTab === 'docs') {
			const { data } = await supabase
				.from('profile_docs')
				.select('id, kind, title, drive_url, created_at')
				.eq('user_id', id)
				.order('created_at', { ascending: true });
			profileDocs = (data ?? []) as ProfileDocRow[];
		}
		if (canSeeSensitive && activeTab === 'pap') {
			const { data } = await supabase
				.from('profile_sensitive')
				.select('*')
				.eq('user_id', id)
				.maybeSingle();
			sensitive = (data ?? null) as SensitiveRow | null;
		}
	}

	// Time off (0043 staff_requests). RLS scopes these to the requester and the
	// Strategy Reviewers group, so a people-manager who is not a reviewer reads
	// zero rows — the empty state below says so instead of implying "never took
	// a day off".
	let timeOffRows: TimeOffRow[] = [];
	let timeOffLoadFailed = false;
	if (activeTab === 'timeoff') {
		const { data, error: timeOffError } = await supabase
			.from('staff_requests')
			.select('id, title, payload, status, decision_note_md, created_at')
			.eq('requester_id', id)
			.eq('kind', 'time_off')
			.order('created_at', { ascending: false });
		// A failed read and an RLS-empty read both arrive as zero rows, and they
		// mean opposite things — so keep them apart rather than showing the
		// reassuring empty state over a broken query.
		timeOffLoadFailed = !!timeOffError;
		timeOffRows = (data ?? []) as TimeOffRow[];
	}

	// 4R (0093): the saved row, its change log, and, for a person without one,
	// the best-matching position template as a draft. The leadership-chain
	// check for the edit right needs the (id -> manager_id) map; one query.
	let fourR: ProfileFourR | null = null;
	let fourRRevisions: FourRRevision[] = [];
	let fourRTemplate: FourRTemplate | null = null;
	let fourRUpdatedByName: string | null = null;
	let viewerLeadsSubject = false;
	if (activeTab === 'fourr') {
		const [{ data: fr }, { data: revs }, { data: tpls }, { data: chain }] = await Promise.all([
			supabase.from('profile_four_r').select('*').eq('user_id', id).maybeSingle(),
			supabase
				.from('profile_four_r_revisions')
				.select('id, revision, snapshot, changed_fields, change_note, changed_by, changed_at')
				.eq('user_id', id)
				.order('revision', { ascending: false })
				.limit(50),
			supabase
				.from('four_r_templates')
				.select('slug, position_label, department, reports_to, role_md, responsibilities_md, results_md, requirements_md, match_keywords, source_url, sort')
				.eq('is_active', true)
				.order('sort'),
			supabase.from('profiles').select('id, manager_id'),
		]);
		fourR = (fr ?? null) as ProfileFourR | null;
		const managerOf = new Map<string, string | null>(
			((chain ?? []) as { id: string; manager_id: string | null }[]).map((p) => [p.id, p.manager_id]),
		);
		viewerLeadsSubject = isInLeadershipChain(ctx.viewerId, id, managerOf);

		// Names for the log (and the "last saved by" line) in one lookup.
		const actorIds = Array.from(new Set([
			...((revs ?? []) as { changed_by: string | null }[]).map((r) => r.changed_by),
			fourR?.updated_by ?? null,
		].filter((x): x is string => !!x)));
		const names = new Map<string, string>();
		if (actorIds.length > 0) {
			const { data: actors } = await supabase
				.from('profiles')
				.select('id, first_name, last_name, email')
				.in('id', actorIds);
			for (const a of (actors ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string }[]) {
				names.set(a.id, [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email);
			}
		}
		fourRRevisions = ((revs ?? []) as Omit<FourRRevision, 'changed_by_name'>[]).map((r) => ({
			...r,
			changed_by_name: r.changed_by ? (names.get(r.changed_by) ?? null) : null,
		}));
		fourRUpdatedByName = fourR?.updated_by ? (names.get(fourR.updated_by) ?? null) : null;

		if (!fourR) {
			fourRTemplate = pickFourRTemplate(
				{
					job_role: profile.job_role,
					pap_position: profile.pap_position,
					position_track: profile.position_track,
					title: profile.title,
				},
				(tpls ?? []) as FourRTemplate[],
			);
		}
	}

	// Manager + position components (0033: dept tag / track labels) feed the
	// HEADER, so they are read on every tab. Direct reports are only rendered by
	// the Overview tab, so that one query follows the branch.
	const [{ data: manager }, { data: directReports }, { data: deptTag }, { data: trackRow }] =
		await Promise.all([
			profile.manager_id
				? supabase.from('profiles').select('id, first_name, last_name, title, email, avatar_url').eq('id', profile.manager_id).maybeSingle()
				: Promise.resolve({ data: null }),
			activeTab === 'overview'
				? supabase.from('profiles').select('id, first_name, last_name, title').eq('manager_id', id).eq('is_active', true)
				: Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; title: string | null }[] }),
			profile.department_tag_id
				? supabase.from('tags').select('label, color').eq('id', profile.department_tag_id).maybeSingle()
				: Promise.resolve({ data: null }),
			profile.position_track
				? supabase.from('position_tracks').select('label').eq('slug', profile.position_track).maybeSingle()
				: Promise.resolve({ data: null }),
		]);

	// Composed position (0033): {department} {track} {I/II/III}; legacy title is
	// the fallback until every profile has components set.
	const deptLabel = (deptTag as { label: string; color: string | null } | null)?.label ?? null;
	const composedPosition = formatPosition(
		deptLabel,
		(trackRow as { label: string } | null)?.label ?? profile.position_track,
		profile.position_level,
	);

	const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email;
	const initials = `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase() || profile.email[0].toUpperCase();

	// ----- the mini-stat strip -------------------------------------------------
	// Four facts, each from the source that already owns it:
	//   metrics   → resolveMetricRows (the SAME resolution MetricsSection uses:
	//               specialty ± the per-person deltas from 0050, NEVER a
	//               specialty-only filter — that bug shipped here once)
	//   check-in  → loadCheckinState in lib/home/signals (audience rule from
	//               0036, statuses from 0035), not a second query
	//   open work → projects, non-terminal per work_item_statuses.is_terminal,
	//               mirroring Home's per-report query
	//   tenure    → profiles.date_started
	// The month follows ?month, so the strip agrees with the metrics section.
	const ym = /^\d{4}-\d{2}$/.test(month ?? '')
		? (month as string)
		: businessToday().slice(0, 7);
	const period = `${ym}-01`;
	// Year included so the strip reads the same as the metrics section below it.
	const monthLabel = new Date(`${period}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});

	// These three reads are HOISTED: the header's metrics cell needs them on
	// every tab, and MetricsSection used to issue the same three itself — so on
	// the metrics tab they ran twice and could disagree. Now they are read once
	// here and handed down, which is also what makes the two consumers agree by
	// construction: same rows, same `ym`, same pure resolveMetricRows. A strip
	// reading "2 of 3 filled" over a table listing four metrics destroys trust
	// in both numbers, so the agreement is structural, not a convention.
	const [
		{ data: statDefRows },
		{ data: statValueRows },
		{ data: statOverrideRows, error: statOverrideError },
		{ data: terminalRows },
		checkin,
	] = await Promise.all([
		// Metrics are gated exactly like the section below them: without doc
		// access RLS would return nothing anyway, and metricsTotal === 0 makes
		// buildProfileStats drop the cell rather than print "0 of 0".
		canSeeDocs
			? supabase
					.from('metric_definitions')
					.select('key, name, description, pap_positions, unit, requires_goal, source, sort')
					.eq('is_active', true)
					.order('sort')
			: Promise.resolve({ data: [] as MetricDefRow[] }),
		canSeeDocs
			? supabase
					.from('metrics')
					.select('metric_key, value, goal, source')
					.eq('subject_type', 'user')
					.eq('subject_id', id)
					.eq('period', period)
			: Promise.resolve({ data: [] as MetricValueRow[] }),
		canSeeDocs
			? supabase.from('profile_metric_overrides').select('metric_key, mode').eq('profile_id', id)
			: Promise.resolve({ data: [] as MetricOverride[], error: null }),
		supabase.from('work_item_statuses').select('slug').eq('is_terminal', true),
		canSeeDocs
			? loadCheckinState(id)
			: Promise.resolve({ state: 'not-expected' as const, week: null }),
	]);

	const statDefs = (statDefRows ?? []) as MetricDefRow[];
	const statValues = (statValueRows ?? []) as MetricValueRow[];
	const statOverrides = (statOverrideRows ?? []) as MetricOverride[];
	const statResolved = resolveMetricRows({
		defs: statDefs,
		papPosition: profile.pap_position ?? null,
		overrides: statOverrides,
		// Same nuance as MetricsSection: a `remove` is only overruled by a
		// MANUAL row somebody reported, never by a computed one.
		keysWithValues: statValues
			.filter((v) => v.source !== 'the_work' && (v.value != null || v.goal != null))
			.map((v) => v.metric_key),
	});
	// A metric the compute engine filled counts as filled — the question is
	// "is this number known", not "did a human type it".
	const filledKeys = new Set(statValues.filter((v) => v.value != null).map((v) => v.metric_key));

	const terminalStatuses = Array.from(new Set((terminalRows ?? []).map((r) => r.slug as string)));
	// The business day, not the server's. Vercel runs UTC, so a UTC day would
	// call HQ's evening work "overdue" from 19:00 local onward — and
	// HomeView buckets due dates in the viewer's LOCAL day, so the two surfaces
	// would disagree about the same item for five hours every night.
	// `en-CA` is the locale that formats as YYYY-MM-DD, which is what `ends_at`
	// is compared against as a string. Precedent: lib/metrics/daily.ts.
	const todayYmd = businessToday();
	const openWorkQuery = () => {
		const q = supabase
			.from('projects')
			.select('id', { count: 'exact', head: true })
			.eq('owner_id', id)
			.eq('archived', false);
		// An empty IN list is not valid SQL — skip the filter rather than send `()`.
		return terminalStatuses.length > 0
			? q.not('status', 'in', `(${terminalStatuses.join(',')})`)
			: q;
	};
	const [{ count: openCount }, { count: overdueCount }] = await Promise.all([
		openWorkQuery(),
		// `projects.ends_at` is a bare date, so this is a string comparison
		// against the business day resolved above.
		openWorkQuery().not('ends_at', 'is', null).lt('ends_at', todayYmd),
	]);

	const stats = buildProfileStats({
		metricsFilled: statResolved.filter((r) => filledKeys.has(r.def.key)).length,
		metricsTotal: statResolved.length,
		monthLabel,
		checkinState: checkin.state,
		openTasks: openCount ?? 0,
		overdueTasks: overdueCount ?? 0,
		tenureStart: profile.date_started ?? null,
		asOf: todayYmd,
	});

	const locationLabel = profile.in_office ? 'HQ office' : 'Remote';
	const managerName = manager
		? [manager.first_name, manager.last_name].filter(Boolean).join(' ') || manager.email
		: null;
	const facts: React.ReactNode[] = [
		composedPosition ?? profile.title ?? profile.role,
		managerName ? (
			<>
				Reports to{' '}
				<Link href={`/team/${manager!.id}`} className="text-primary-600 hover:underline">
					{managerName}
				</Link>
			</>
		) : null,
		<a key="email" href={`mailto:${profile.email}`} className="hover:underline">
			{profile.email}
		</a>,
		locationLabel,
	].filter(Boolean);

	// What a tab link carries across. `month` and `week` are STATE — the month
	// you arrived on must survive a hop to another tab and back, and the header's
	// metrics cell reads the same `?month`. The flash params (metricsSaved,
	// metricsError, metricsSet, metricsSetSaved, checkinSaved, checkinError,
	// docsError) are deliberately dropped: a "Saved 3 metrics" banner following
	// you onto the Check-ins tab would be a lie about what just happened.
	const tabKeep: [string, string][] = [];
	if (month) tabKeep.push(['month', month]);
	if (week) tabKeep.push(['week', week]);

	return (
		<>
			<Link href="/team" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Team Directory
			</Link>

			{/* ── Identity header ──────────────────────────────────────────────
			    One self-contained block: identity row on top, mini-stat strip
			    beneath. A tab strip goes UNDER this card (Task 5) — nothing in
			    here needs to move for that. */}
			<Card padding="none" className="mb-6 overflow-hidden">
				<div className="flex flex-col sm:flex-row items-start gap-4 p-4">
					{canEditProfile ? (
						// The avatar IS the upload target (spec). AvatarUpload writes
						// photo_url itself, so it needs no form around it — and the
						// `photo_url` text input stays OFF here: the edit form owns
						// the one and only input for that field.
						<AvatarUpload
							profileId={id}
							currentUrl={profile.photo_url ?? profile.avatar_url ?? null}
							canEdit
							initials={initials}
							showUrlField={false}
							compact
						/>
					) : (
						<div className="w-20 h-20 rounded-full bg-primary-600 flex items-center justify-center text-white text-xl font-bold shrink-0 overflow-hidden">
							{profile.photo_url || profile.avatar_url ? (
								// eslint-disable-next-line @next/next/no-img-element
								<img src={profile.photo_url ?? profile.avatar_url ?? ''} alt={fullName} className="w-full h-full object-cover" />
							) : initials}
						</div>
					)}

					<div className="flex-1 min-w-0">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{fullName}</h1>
							{(deptLabel ?? profile.department) && (
								<Badge color="primary">{deptLabel ?? profile.department}</Badge>
							)}
							{profile.pap_position && <Badge color="default">{profile.pap_position}</Badge>}
							{profile.role && profile.role !== 'contributor' && <Badge color="default">{profile.role}</Badge>}
							{profile.employment_status && profile.employment_status !== 'Active' && (
								<Badge color="warning">{profile.employment_status}</Badge>
							)}
						</div>

						{/* The facts line: everything you used to scroll for. */}
						<p className="mt-1 text-sm text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
							{facts.map((fact, i) => (
								<span key={i} className="inline-flex items-center gap-1">
									{i > 0 && <span className="text-slate-300 dark:text-slate-600">·</span>}
									{i === facts.length - 1 && <MapPin className="w-3 h-3 text-slate-400" />}
									{fact}
								</span>
							))}
						</p>
						{profile.job_role && (
							<p className="mt-0.5 text-2xs text-slate-600 dark:text-slate-400">{profile.job_role}</p>
						)}
						{ctx.viewerIsPeopleManager && ctx.viewerId !== profile.id && (
							<p className="mt-1.5">
								<Badge color="warning" className="text-2xs">You can see sensitive info on this profile</Badge>
							</p>
						)}
					</div>

					<div className="flex items-center gap-2 shrink-0">
						<a
							href={`mailto:${profile.email}`}
							className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors"
						>
							<Mail className="w-3 h-3" /> Email
						</a>
						{canEditProfile && (
							<Link
								href={`/team/${id}/edit`}
								className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors"
							>
								<Pencil className="w-3 h-3" /> {ctx.viewerId === id ? 'Edit my profile' : 'Edit profile'}
							</Link>
						)}
						{/* Contextual request (menu sheet): your own profile → Request time off. */}
						{ctx.viewerId === id && <RequestButton label="Request time off" option="Time off" variant="outline" />}
					</div>
				</div>

				{/* gap-px over a slate background draws the dividers: a `divide-x`
				    on a wrapping grid leaves a stray rule on the first cell of the
				    second row. */}
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 dark:bg-slate-700 border-t border-slate-200 dark:border-slate-700">
					{stats.map((stat) => (
						<StatCell key={stat.label} stat={stat} />
					))}
				</div>
			</Card>

			{/* Rewrites a pre-?tab= deep link (#metrics / #checkin) that is already
			    sitting in somebody's notifications. Renders nothing. */}
			<TabHashRedirect />
			<ProfileTabs
				basePath={`/team/${id}`}
				active={activeTab}
				available={availableTabs}
				keep={tabKeep}
			/>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				{/* LEFT: the active section. Overview keeps the sidebar beside it;
				    the metrics table and the check-in form take the full width. */}
				<div className={activeTab === 'overview' ? 'lg:col-span-2 space-y-4' : 'lg:col-span-3 space-y-4'}>
					{activeTab === 'overview' && (
					<Card>
						<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">About</h2>
						{profile.bio_md ? (
							<p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{profile.bio_md}</p>
						) : (
							<p className="text-sm text-slate-400">No bio added yet.</p>
						)}
						{profile.why_us_md && (
							<div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
								<p className="text-xs uppercase text-slate-400 mb-1">Why I love working with Open Ronin</p>
								<p className="text-sm text-slate-700 dark:text-slate-300 italic whitespace-pre-wrap">&quot;{profile.why_us_md}&quot;</p>
							</div>
						)}
					</Card>
					)}

					{activeTab === 'overview' && workData && (
						<WorkNowCard data={workData} today={todayYmd} personId={id} isSelf={ctx.viewerId === id} />
					)}
					{activeTab === 'work' && workData && (
						<WorkTab data={workData} today={todayYmd} firstName={profile.first_name || 'They'} isSelf={ctx.viewerId === id} />
					)}

					{/* Documents: 4R / PAP doc links — own RLS (profile_docs), broader than comp. Own tab since 2026-09-14. */}
					{activeTab === 'docs' && canSeeDocs && (
						<Card>
							<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3 flex items-center gap-1.5">
								<FileText className="w-3 h-3" /> Documents · 4R &amp; PAP
							</h2>
							<FormError message={docsError} />
							{profileDocs.length === 0 ? (
								<p className="text-sm text-slate-400">
									No documents linked yet
									{canManageDocs ? ' — add the 4R or PAP below.' : ' — your people-manager links the 4R and PAP here.'}
								</p>
							) : (
								<ul className="space-y-1.5">
									{profileDocs.map((doc) => (
										<li key={doc.id} className="flex items-center gap-2 text-sm">
											<Badge color={doc.kind === '4r' ? 'primary' : doc.kind === 'pap' ? 'warning' : 'default'}>
												{DOC_KIND_LABELS[doc.kind] ?? doc.kind}
											</Badge>
											<a
												href={doc.drive_url}
												target="_blank"
												rel="noreferrer"
												className="text-primary-600 hover:underline inline-flex items-center gap-1 truncate"
											>
												{doc.title} <ExternalLink className="w-3 h-3 shrink-0" />
											</a>
											{canManageDocs && (
												<form action={removeProfileDoc.bind(null, id)} className="ml-auto">
													<input type="hidden" name="doc_id" value={doc.id} />
													<button
														type="submit"
														className="text-2xs text-slate-600 dark:text-slate-400 hover:text-red-600 transition-colors"
														aria-label={`Remove ${doc.title}`}
														title="Remove link"
													>
														Remove
													</button>
												</form>
											)}
										</li>
									))}
								</ul>
							)}
							{canManageDocs && (
								<form
									action={addProfileDoc.bind(null, id)}
									className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-[7rem_1fr_1fr_auto] gap-2 items-end"
								>
									<FormField label="Type">
										<select name="kind" className={selectClass} defaultValue="4r">
											{DOC_KINDS.map((k) => (
												<option key={k} value={k}>
													{DOC_KIND_LABELS[k]}
												</option>
											))}
										</select>
									</FormField>
									<FormField label="Title">
										<input name="title" placeholder="4R — Job Description" className={inputClass} />
									</FormField>
									<FormField label="Drive link">
										<input name="drive_url" type="url" placeholder="https://docs.google.com/…" className={inputClass} />
									</FormField>
									<Button type="submit">Add</Button>
								</form>
							)}
						</Card>
					)}

					{/* Individual Metrics — monthly Goal/Achieved, lives IN the profile
				    (Alex 18/08: no second screen). Same visibility rule as docs:
				    self, direct manager, people-managers, exec/admin.
				    Its three reads are HOISTED above the tab branch (the header
				    needs them anyway) and passed in, so the strip's "N of M
				    filled" and this table cannot disagree. */}
					{activeTab === 'metrics' && canSeeDocs && (
						<MetricsSection
							subjectId={profile.id}
							subjectName={[profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email}
							papPosition={profile.pap_position ?? null}
							ym={ym}
							defs={statDefs}
							values={statValues}
							overrides={statOverrides}
							overrideLoadFailed={!!statOverrideError}
							canEnter={ctx.viewerId === profile.id || canManagePeople(ctx)}
							isManagerViewer={canManagePeople(ctx)}
							saved={metricsSaved}
							error={metricsError}
							editingSet={metricsSet === '1'}
							setSaved={metricsSetSaved === '1'}
						/>
					)}

					{/* Weekly Check-in — same audience as docs/metrics (can_view_checkin,
				    0035). Only the person themselves can write; everyone else in
				    that audience sees it read-only. */}
					{activeTab === 'checkins' && canSeeDocs && (
						<CheckinSection
							subjectId={profile.id}
							weekParam={week}
							isSelf={ctx.viewerId === profile.id}
							saved={checkinSaved}
							error={checkinError}
						/>
					)}

					{/* 4R — Role, Responsibilities, Results, Requirements (0093).
				    Readable by everyone; editable by the person, their leadership
				    chain, people-managers, exec/admin. */}
					{activeTab === 'fourr' && (() => {
						const profileForDraft = {
							job_role: profile.job_role,
							title: profile.title,
							department: deptLabel ?? null,
						};
						const draft = fourRTemplate
							? draftFromTemplate(fourRTemplate, profileForDraft, managerName)
							: emptyDraft(profileForDraft, managerName);
						return (
							<FourRSection
								subjectId={profile.id}
								subjectName={fullName}
								saved={fourR ? {
									position_label: fourR.position_label,
									department: fourR.department,
									reports_to: fourR.reports_to,
									role_md: fourR.role_md,
									responsibilities_md: fourR.responsibilities_md,
									results_md: fourR.results_md,
									requirements_md: fourR.requirements_md,
									revision: fourR.revision,
									updated_at: fourR.updated_at,
									updated_by_name: fourRUpdatedByName,
									source: fourR.source,
									template_slug: fourR.template_slug,
									source_url: fourR.source_url,
								} : null}
								draft={draft}
								draftTemplate={fourRTemplate ? { slug: fourRTemplate.slug, position_label: fourRTemplate.position_label, source_url: fourRTemplate.source_url } : null}
								revisions={fourRRevisions}
								canEdit={canEditFourR(ctx, profile.id, viewerLeadsSubject)}
								isSelf={ctx.viewerId === profile.id}
							/>
						);
					})()}

					{/* Sensitive: Compensation + PAP — its own tab since 2026-09-14 (was the "& PAP" half of Docs). */}
					{activeTab === 'pap' && (canSeeSensitive ? (
						<Card>
							<div className="flex items-center justify-between mb-3">
								<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
									<Lock className="w-3 h-3" /> Compensation &amp; PAP
								</h2>
								{canManagePeople(ctx) && (
									<Link href={`/team/${id}/edit-sensitive`} className="text-2xs text-primary-600 hover:underline">
										Edit
									</Link>
								)}
							</div>
							{sensitive ? (
								<div className="grid grid-cols-2 gap-3 text-sm">
									<Field icon={<DollarSign className="w-3 h-3" />} label="Base">
										{sensitive.comp_base_cents != null ? formatCurrency(sensitive.comp_base_cents / 100, sensitive.comp_currency ?? 'USD') : '—'}
									</Field>
									<Field label="Structure">{sensitive.pay_structure ?? '—'}</Field>
									<Field label="Review cycle">{sensitive.comp_review_cycle ?? '—'}</Field>
									<Field label="Next review">{formatDate(sensitive.comp_next_review_on)}</Field>
									<Field label="PAP status">
										<Badge color={papColor(sensitive.pap_status)}>{sensitive.pap_status ?? 'not_on_pap'}</Badge>
									</Field>
									<Field label="PAP started">{formatDate(sensitive.pap_started_on)}</Field>
									{sensitive.pap_doc_url && (
										<Field label="PAP doc" wide>
											<a href={sensitive.pap_doc_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
												<ExternalLink className="w-3 h-3" /> Open
											</a>
										</Field>
									)}
									{sensitive.gusto_employee_id && (
										<Field label="Gusto ID">{sensitive.gusto_employee_id}</Field>
									)}
									{sensitive.notes_md && (
										<Field label="HR notes" wide>
											<span className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{sensitive.notes_md}</span>
										</Field>
									)}
								</div>
							) : (
								<p className="text-sm text-slate-400">No sensitive record yet.</p>
							)}
						</Card>
					) : (
						<Card>
							<div className="text-center py-6 text-slate-400 text-sm flex items-center justify-center gap-2">
								<Lock className="w-3.5 h-3.5" /> Compensation &amp; PAP are visible to the team member, people-managers, exec, and admin only.
							</div>
						</Card>
					))}

					{/* Time off — staff_requests of kind 'time_off' (0043). */}
					{activeTab === 'timeoff' && (
						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
								<CalIcon className="w-3.5 h-3.5 text-slate-400" />
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Time off</h2>
								<Link href="/team/attendance" className="text-xs text-primary-600 hover:underline">Attendance tracker</Link>
								{ctx.viewerId === id && (
									<Link href="/the-work/innovation-desk" className="ml-auto text-xs text-primary-600 hover:underline">
										Request time off
									</Link>
								)}
							</div>
							{timeOffLoadFailed ? (
								<p className="px-3 py-6 text-sm text-center text-amber-700 dark:text-amber-400">
									Could not read time-off requests. Reload the page — if it keeps failing,
									tell an admin.
								</p>
							) : timeOffRows.length === 0 ? (
								<p className="px-3 py-6 text-sm text-slate-400 text-center">
									No time-off requests to show. Time off is filed on the{' '}
									<Link href="/the-work/innovation-desk" className="text-primary-600 hover:underline">Innovation Desk</Link>{' '}
									page, and only the person themselves and the Strategy Reviewers can read
									the requests here.
								</p>
							) : (
								<ul className="divide-y divide-slate-200 dark:divide-slate-700">
									{timeOffRows.map((r) => (
										<li key={r.id} className="px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
											<Badge color={TIME_OFF_STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>
											<span className="text-slate-900 dark:text-slate-100">{r.title}</span>
											{r.payload?.time_off_kind && (
												<Badge color="default">{r.payload.time_off_kind}</Badge>
											)}
											{r.payload?.starts_on && (
												<span className="text-2xs text-slate-600 dark:text-slate-400">
													{formatDate(r.payload.starts_on)}
													{r.payload.ends_on ? ` – ${formatDate(r.payload.ends_on)}` : ''}
												</span>
											)}
											{r.decision_note_md && (
												<span className="text-2xs text-slate-600 dark:text-slate-400 basis-full">{r.decision_note_md}</span>
											)}
										</li>
									))}
								</ul>
							)}
						</Card>
					)}
				</div>

				{/* RIGHT: reporting + dates. The Contact card that used to open this
				    column is gone — the header's facts line carries the email and
				    the Email button sits right beside it. */}
				{activeTab === 'overview' && (
				<div className="space-y-4">
					<Card>
						<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">Role &amp; Reporting</h2>
						<div className="space-y-2 text-sm">
							{profile.title && (
								<div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
									<Briefcase className="w-3.5 h-3.5 text-slate-400" />
									{profile.title}
								</div>
							)}
							{manager && (
								<div>
									<p className="text-2xs uppercase text-slate-600 dark:text-slate-400 mb-0.5">Reports to</p>
									<Link href={`/team/${manager.id}`} className="text-sm text-primary-600 hover:underline">
										{[manager.first_name, manager.last_name].filter(Boolean).join(' ') || manager.email}
									</Link>
									{manager.title && <p className="text-2xs text-slate-600 dark:text-slate-400">{manager.title}</p>}
								</div>
							)}
							{directReports && directReports.length > 0 && (
								<div>
									<p className="text-2xs uppercase text-slate-600 dark:text-slate-400 mb-0.5">Direct reports ({directReports.length})</p>
									<ul className="space-y-0.5">
										{directReports.map((r) => (
											<li key={r.id}>
												<Link href={`/team/${r.id}`} className="text-sm text-primary-600 hover:underline">
													{[r.first_name, r.last_name].filter(Boolean).join(' ')}
												</Link>
												{r.title && <span className="text-2xs text-slate-600 dark:text-slate-400"> · {r.title}</span>}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					</Card>

					<Card>
						<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">Personal</h2>
						<div className="space-y-1.5 text-sm">
							<div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
								<CalIcon className="w-3.5 h-3.5 text-slate-400" />
								Started: {formatDate(profile.date_started)}
							</div>
							{profile.birthday && (
								<div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
									<Award className="w-3.5 h-3.5 text-slate-400" />
									Birthday: {formatDate(profile.birthday, 'MMM d')}
								</div>
							)}
							{profile.disc && (
								<div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
									<UserIcon className="w-3.5 h-3.5 text-slate-400" />
									DISC: <span className="font-mono">{profile.disc}</span>
								</div>
							)}
							{/* Onboarding plan (0134): the page RLS-gates itself; shown to the person, their manager and people managers. */}
							{(ctx.viewerId === id || canManagePeople(ctx) || (!!ctx.viewerId && profile.manager_id === ctx.viewerId)) && (
								<Link href={`/team/onboarding/${id}`} className="inline-flex items-center gap-2 text-primary-600 hover:underline text-sm">
									<ClipboardList className="w-3.5 h-3.5" /> Onboarding plan &amp; DISC
								</Link>
							)}
						</div>
					</Card>
				</div>
				)}
			</div>
		</>
	);
}

interface SensitiveRow {
	user_id: string;
	comp_base_cents: number | null;
	comp_currency: string | null;
	comp_review_cycle: string | null;
	comp_next_review_on: string | null;
	pay_structure: string | null;
	pap_status: string | null;
	pap_started_on: string | null;
	pap_ends_on: string | null;
	pap_doc_url: string | null;
	pap_owner_id: string | null;
	gusto_employee_id: string | null;
	emergency_contact_md: string | null;
	notes_md: string | null;
}

/** Same status palette /team/requests uses, so a request reads the same colour
 *  on both screens. */
const TIME_OFF_STATUS_COLORS: Record<string, 'default' | 'success' | 'danger' | 'warning'> = {
	pending: 'warning',
	approved: 'success',
	denied: 'danger',
	withdrawn: 'default',
};

/** One cell of the mini-stat strip. Tinted per tone — every light color has
 *  its dark counterpart, and `default` stays neutral so the tinted cells are
 *  the ones that catch the eye. */
const STAT_TONE: Record<'default' | 'success' | 'warning' | 'danger', { cell: string; value: string }> = {
	default: {
		cell: 'bg-white dark:bg-slate-800',
		value: 'text-slate-900 dark:text-slate-100',
	},
	success: {
		cell: 'bg-green-50 dark:bg-green-950/30',
		value: 'text-green-700 dark:text-green-400',
	},
	warning: {
		cell: 'bg-amber-50 dark:bg-amber-950/30',
		value: 'text-amber-700 dark:text-amber-400',
	},
	danger: {
		cell: 'bg-red-50 dark:bg-red-950/30',
		value: 'text-red-700 dark:text-red-400',
	},
};

function StatCell({ stat }: { stat: ProfileStat }) {
	const tone = STAT_TONE[stat.tone ?? 'default'];
	return (
		<div className={`px-4 py-3 ${tone.cell}`}>
			<p className="text-2xs uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate">{stat.label}</p>
			<p className={`mt-0.5 text-sm font-semibold tabular-nums ${tone.value}`}>{stat.value}</p>
		</div>
	);
}

function Field({ icon, label, children, wide }: { icon?: React.ReactNode; label: string; children: React.ReactNode; wide?: boolean }) {
	return (
		<div className={wide ? 'col-span-2' : ''}>
			<p className="text-2xs uppercase text-slate-600 dark:text-slate-400 mb-0.5 flex items-center gap-1">{icon}{label}</p>
			<div className="text-sm text-slate-700 dark:text-slate-300">{children}</div>
		</div>
	);
}

function papColor(status: string | null | undefined): 'default' | 'success' | 'warning' | 'danger' | 'primary' {
	switch (status) {
		case 'active': return 'warning';
		case 'probation': return 'danger';
		case 'completed': return 'success';
		case 'separated': return 'danger';
		default: return 'default';
	}
}

// kept to satisfy the AlertCircle import if tree-shake is aggressive
void AlertCircle;
