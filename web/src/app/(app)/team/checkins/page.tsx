// Team Check-ins — the manager view of the weekly check-in (PEOPLE_PLAN
// section 9.6 step 3, spec 9.3 item 7).

//
// Scope: your DIRECT reports (profiles.manager_id), or everyone expected when
// you are a people-manager / exec / admin. The counters derive from exactly
// the same dataset that renders the rows — never a separate query that could
// disagree (spec requirement).
//
// The period picker defaults to the latest OPEN week (0065): before Friday
// 9:15 AM Central that is last week; from Friday morning it is the week that
// just ended. Reviewing an in-flight week mid-week mostly shows people who
// haven't reached Friday yet. checkin_audience (0036) restricts who is
// EXPECTED when non-empty.
//
// Needs-attention signals land in the next step (9.6 step 4) — the counter
// row gains a fourth tile then, computed from the same dataset.
//
// Two tabs, URL state like /team/[id] (?tab=): "Check-ins" is the paged list
// of people (?p=, ?size= from lib/people/paging), "12-week pulse" is the
// person x week grid over EVERY filtered row — a comparison grid cut into
// pages stops being a comparison (Sam, 2026-09-21). The counters sit
// above both tabs and are computed over all filtered rows, never the page.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import { clsx } from 'clsx';
import { HeartPulse, LayoutGrid, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { formatWeekRange, recentWeeks } from '@/lib/people/checkinWeeks';
import { loadCheckinWindow } from '@/lib/people/checkinWindow';
import { computeAttentionSignals, type WeekPoint } from '@/lib/people/attentionSignals';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageSlice, parsePage, parsePageSize } from '@/lib/people/paging';
import { selectClass } from '../_form';
import CheckinThread, { type ThreadComment, type ThreadReview } from './CheckinThread';
import PulseGrid, { type PulseRow } from './PulseGrid';

export const metadata = { title: 'Team Check-ins' };

export const dynamic = 'force-dynamic';

/** History window for the pulse grid and the attention signals. */
const PULSE_WEEKS = 12;

type Tab = 'list' | 'pulse';
const TABS: { key: Tab; label: string; icon: typeof HeartPulse }[] = [
	{ key: 'list', label: 'Check-ins', icon: HeartPulse },
	{ key: 'pulse', label: `${PULSE_WEEKS}-week pulse`, icon: LayoutGrid },
];

interface PersonRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	department_tag_id: string | null;
}

interface CheckinRow {
	id: string;
	user_id: string;
	week_end: string;
	status: string;
	weekly_high: string | null;
	weekly_low: string | null;
	extra_comments: string | null;
	submitted_at: string | null;
}

interface ResponseRow {
	checkin_id: string;
	category_label: string;
	score: number;
	score_label: string;
	comment: string | null;
}

const nameOf = (p: { first_name: string | null; last_name: string | null; email: string }) =>
	[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

export default async function TeamCheckinsPage({
	searchParams,
}: {
	searchParams: Promise<{ week?: string; dept?: string; status?: string; tab?: string; p?: string; size?: string }>;
}) {
	const { week: weekParam, dept: deptParam, status: statusParam, tab: tabParam, p: pageParam, size: sizeParam } = await searchParams;
	const tab: Tab = tabParam === 'pulse' ? 'pulse' : 'list';
	const size = parsePageSize(sizeParam);
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();

	if (!ctx.viewerId) return null; // middleware already redirects; belt-and-suspenders
	const viewerId = ctx.viewerId;

	const managerAll = canManagePeople(ctx);

	const [window, { data: reportRows }, { data: audienceRows }, { data: tagRows }] =
		await Promise.all([
			loadCheckinWindow(supabase),
			supabase
				.from('profiles')
				.select('id, first_name, last_name, email, department_tag_id')
				.eq('manager_id', ctx.viewerId)
				.eq('is_active', true),
			supabase.from('checkin_audience').select('department_tag_id'),
			supabase.from('tags').select('id, label'),
		]);

	const currentWeek = window?.currentWeekEnd ?? null;
	const latestOpenWeek = window?.latestOpenWeekEnd ?? null;
	const directReports = (reportRows ?? []) as PersonRow[];

	if (!currentWeek || !latestOpenWeek) {
		return (
			<>
				<div className="max-w-3xl">
					<PageHeader title="Team Check-ins" />
					<Card>
						<p className="text-sm text-slate-500">
							Not set up yet — <code>0035_weekly_checkins.sql</code> hasn&apos;t been applied.
						</p>
					</Card>
				</div>
			</>
		);
	}

	if (!managerAll && directReports.length === 0) {
		return (
			<>
				<div className="max-w-3xl">
					<PageHeader title="Team Check-ins" />
					<Card>
						<p className="text-sm text-slate-500 flex items-center gap-2">
							<Lock className="w-4 h-4 shrink-0" />
							This view is for managers: it lists the check-ins of your direct reports. Nobody
							reports to you in the org chart yet — your own check-in lives on{' '}
							<Link href={`/team/${ctx.viewerId}?tab=checkins`} className="text-primary-600 hover:underline">
								your profile
							</Link>
							.
						</p>
					</Card>
				</div>
			</>
		);
	}

	// ---- Scope: whose check-ins this page covers -----------------------------
	let scope: PersonRow[];
	if (managerAll) {
		const { data } = await supabase
			.from('profiles')
			.select('id, first_name, last_name, email, department_tag_id')
			.eq('is_active', true);
		scope = (data ?? []) as PersonRow[];
	} else {
		scope = directReports;
	}

	// checkin_audience: non-empty = only those departments are EXPECTED (0036).
	const audience = new Set((audienceRows ?? []).map((a) => a.department_tag_id as string));
	if (audience.size > 0) {
		scope = scope.filter((p) => p.department_tag_id && audience.has(p.department_tag_id));
	}

	const tagLabel = new Map((tagRows ?? []).map((t) => [t.id as string, t.label as string]));

	// ---- Period ---------------------------------------------------------------
	// PULSE_WEEKS is the history window: the picker offers the first 8, the
	// pulse grid and the attention signals read all 12. One contiguous series,
	// so a gap in it means "nobody submitted", never "no data fetched".
	const pulseSeries = recentWeeks(currentWeek, PULSE_WEEKS);
	const weeks = pulseSeries.slice(0, 8);
	const week = weekParam && weeks.includes(weekParam) ? weekParam : latestOpenWeek;

	// ---- 12 weeks of check-ins for the scope (ONE dataset feeds the rows, the
	//      counters, the signals and the grid — never a second query that could
	//      disagree with what is on screen).
	const scopeIds = scope.map((p) => p.id);
	const { data: historyRows } = await supabase
		.from('weekly_checkins')
		.select('id, user_id, week_end, status, weekly_high, weekly_low, extra_comments, submitted_at')
		.gte('week_end', pulseSeries[pulseSeries.length - 1])
		.lte('week_end', pulseSeries[0])
		.in('user_id', scopeIds.length > 0 ? scopeIds : ['00000000-0000-0000-0000-000000000000']);
	const history = ((historyRows ?? []) as CheckinRow[]).filter((c) => c.status === 'submitted');

	const checkins = history.filter((c) => c.week_end === week);
	const checkinByUser = new Map(checkins.map((c) => [c.user_id, c]));
	const checkinIds = checkins.map((c) => c.id);
	const idsOrSentinel = checkinIds.length > 0 ? checkinIds : ['00000000-0000-0000-0000-000000000000'];
	// Scores across the whole window, for the per-week averages the grid needs.
	const historyIds = history.map((c) => c.id);
	const { data: historyScoreRows } = await supabase
		.from('checkin_responses')
		.select('checkin_id, score')
		.in('checkin_id', historyIds.length > 0 ? historyIds : ['00000000-0000-0000-0000-000000000000']);
	const scoresByCheckin = new Map<string, number[]>();
	for (const r of historyScoreRows ?? []) {
		const list = scoresByCheckin.get(r.checkin_id as string) ?? [];
		list.push(r.score as number);
		scoresByCheckin.set(r.checkin_id as string, list);
	}
	/** Mean of a check-in's category scores, or null when it has no responses. */
	const averageFor = (checkinId: string): number | null => {
		const xs = scoresByCheckin.get(checkinId);
		if (!xs || xs.length === 0) return null;
		return xs.reduce((s, x) => s + x, 0) / xs.length;
	};

	const [{ data: respRows }, { data: reviewRows }, { data: commentRows }] = await Promise.all([
		supabase
			.from('checkin_responses')
			.select('checkin_id, category_label, score, score_label, comment')
			.in('checkin_id', idsOrSentinel),
		supabase
			.from('checkin_reviews')
			.select('checkin_id, reviewer_id, reviewed_at, reviewer:profiles!checkin_reviews_reviewer_id_fkey(first_name, last_name, email)')
			.in('checkin_id', idsOrSentinel),
		supabase
			.from('checkin_comments')
			.select('id, checkin_id, author_id, body, created_at, edited_at, author:profiles!checkin_comments_author_id_fkey(first_name, last_name, email)')
			.in('checkin_id', idsOrSentinel)
			.order('created_at'),
	]);

	const responses = (respRows ?? []) as ResponseRow[];
	const reviewsByCheckin = new Map<string, ThreadReview[]>();
	for (const r of reviewRows ?? []) {
		const reviewer = r.reviewer as unknown as PersonRow | null;
		const list = reviewsByCheckin.get(r.checkin_id as string) ?? [];
		list.push({
			reviewer_id: r.reviewer_id as string,
			reviewer_name: reviewer ? nameOf(reviewer) : 'someone',
			reviewed_at: r.reviewed_at as string,
		});
		reviewsByCheckin.set(r.checkin_id as string, list);
	}
	const commentsByCheckin = new Map<string, ThreadComment[]>();
	for (const c of commentRows ?? []) {
		const author = c.author as unknown as PersonRow | null;
		const list = commentsByCheckin.get(c.checkin_id as string) ?? [];
		list.push({
			id: c.id as string,
			author_id: c.author_id as string,
			author_name: author ? nameOf(author) : 'someone',
			body: c.body as string,
			created_at: c.created_at as string,
			edited_at: c.edited_at as string | null,
		});
		commentsByCheckin.set(c.checkin_id as string, list);
	}

	// ---- Rows + counters (same dataset, spec requirement) ----------------------
	// The per-person series is built from the SAME 12-week history: a week with
	// no submitted check-in becomes average: null — missing, never zero.
	const historyByUser = new Map<string, CheckinRow[]>();
	for (const c of history) {
		const list = historyByUser.get(c.user_id) ?? [];
		list.push(c);
		historyByUser.set(c.user_id, list);
	}

	const rows = scope
		.map((p) => {
			const checkin = checkinByUser.get(p.id) ?? null;
			const revs = checkin ? (reviewsByCheckin.get(checkin.id) ?? []) : [];
			const resp = checkin ? responses.filter((r) => r.checkin_id === checkin.id) : [];
			const avg = resp.length > 0 ? resp.reduce((s, r) => s + r.score, 0) / resp.length : null;

			const mine = historyByUser.get(p.id) ?? [];
			const byWeek = new Map(mine.map((c) => [c.week_end, c.id]));
			const series: WeekPoint[] = pulseSeries.map((w) => {
				const id = byWeek.get(w);
				return { weekEnd: w, average: id ? averageFor(id) : null };
			});

			return {
				person: p,
				checkin,
				reviews: revs,
				responses: resp,
				comments: checkin ? (commentsByCheckin.get(checkin.id) ?? []) : [],
				avg,
				reviewedByMe: revs.some((r) => r.reviewer_id === viewerId),
				series,
				signals: computeAttentionSignals(series),
			};
		})
		.sort((a, b) => nameOf(a.person).localeCompare(nameOf(b.person)));

	const counts = {
		expected: rows.length,
		submitted: rows.filter((r) => r.checkin).length,
		missing: rows.filter((r) => !r.checkin).length,
		unreviewed: rows.filter((r) => r.checkin && !r.reviewedByMe).length,
		attention: rows.filter((r) => r.signals.needsAttention).length,
	};

	// ---- Filters (searchParams-driven, rendered from the same rows) ------------
	const departments = [...new Set(rows.map((r) => r.person.department_tag_id).filter(Boolean))] as string[];
	const status = ['submitted', 'missing', 'unreviewed', 'attention'].includes(statusParam ?? '')
		? statusParam
		: undefined;
	const visible = rows.filter((r) => {
		if (deptParam && r.person.department_tag_id !== deptParam) return false;
		if (status === 'submitted') return !!r.checkin;
		if (status === 'missing') return !r.checkin;
		if (status === 'unreviewed') return !!r.checkin && !r.reviewedByMe;
		if (status === 'attention') return r.signals.needsAttention;
		return true;
	});

	// The list is the only paged thing; a ?p= past the end clamps to the last
	// page. Counters above were computed over `rows`/`visible`, never this slice.
	const slice = pageSlice(visible.length, parsePage(pageParam), size);
	const pageRows = visible.slice(slice.start, slice.end);

	// `p` is deliberately NOT carried by default: any filter, week or tab change
	// starts from page 1 — otherwise a filter that shrinks the list leaves you
	// on a page that no longer exists. The pager passes it explicitly.
	const qs = (patch: Record<string, string | undefined>) => {
		const params = new URLSearchParams();
		const merged = {
			week,
			dept: deptParam,
			status,
			tab: tab === 'pulse' ? 'pulse' : undefined,
			size: size !== DEFAULT_PAGE_SIZE ? String(size) : undefined,
			...patch,
		};
		for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
		const s = params.toString();
		return s ? `?${s}` : '';
	};
	const returnPath = '/team/checkins';

	const tile = (label: string, value: number, filter: string | undefined, active: boolean) => (
		<Link
			href={`/team/checkins${qs({ status: filter })}`}
			className={`flex-1 min-w-32 rounded-lg border px-4 py-3 transition-colors ${
				active
					? 'border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-950/20'
					: 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-hover'
			}`}
		>
			<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
			<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</div>
		</Link>
	);

	return (
		<>
			<div className="max-w-5xl">
				<PageHeader
					title="Team Check-ins"
					description={
						managerAll
							? 'Everyone expected to submit — you are a people-manager.'
							: 'Your direct reports.'
					}
				/>

				{/* Period picker */}
				<form method="get" action="/team/checkins" className="mb-4 flex items-center gap-2">
					{deptParam && <input type="hidden" name="dept" value={deptParam} />}
					{status && <input type="hidden" name="status" value={status} />}
					{tab === 'pulse' && <input type="hidden" name="tab" value="pulse" />}
					{size !== DEFAULT_PAGE_SIZE && <input type="hidden" name="size" value={String(size)} />}
					<select name="week" defaultValue={week} aria-label="Reporting week" className={`${selectClass} !w-64 text-xs`}>
						{weeks.map((w) => (
							<option key={w} value={w}>
								{formatWeekRange(w)}
								{w === currentWeek && w !== latestOpenWeek
									? ' · in progress (opens Fri 9:15 AM)'
									: w === latestOpenWeek
										? ' · latest'
										: ''}
							</option>
						))}
					</select>
					{departments.length > 1 && (
						<select name="dept" defaultValue={deptParam ?? ''} aria-label="Department" className={`${selectClass} !w-44 text-xs`}>
							<option value="">All departments</option>
							{departments.map((d) => (
								<option key={d} value={d}>{tagLabel.get(d) ?? 'Unknown'}</option>
							))}
						</select>
					)}
					<Button type="submit" variant="outline">Open</Button>
				</form>

				{/* Counters — clicking one filters the list below (same dataset). */}
				<div className="mb-6 flex gap-3 flex-wrap">
					{tile('Expected', counts.expected, undefined, !status)}
					{tile('Submitted', counts.submitted, 'submitted', status === 'submitted')}
					{tile('Missing', counts.missing, 'missing', status === 'missing')}
					{tile('Not reviewed by you', counts.unreviewed, 'unreviewed', status === 'unreviewed')}
					{tile('Needs attention', counts.attention, 'attention', status === 'attention')}
				</div>

				{/* Tabs — URL state (?tab=), the ProfileTabs treatment. */}
				<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 -mx-1 px-1 mb-4 overflow-x-auto">
					{TABS.map(({ key, label, icon: Icon }) => {
						const isActive = key === tab;
						return (
							<Link
								key={key}
								href={`/team/checkins${qs({ tab: key === 'pulse' ? 'pulse' : undefined })}`}
								aria-current={isActive ? 'page' : undefined}
								className={clsx(
									'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
									isActive
										? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
										: 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
								)}
							>
								<Icon className="w-4 h-4" />
								{label}
							</Link>
						);
					})}
				</div>

				{tab === 'pulse' ? (
					visible.length === 0 ? (
						<Card>
							<p className="text-sm text-slate-500 text-center py-6">
								Nothing matches this filter for the {formatWeekRange(week)} week.
							</p>
						</Card>
					) : (
						/* Person x week over EVERY filtered row — never paged. A week nobody
						   submitted stays an empty cell and is excluded from the average:
						   missing, not zero. */
						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
								<h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
									{PULSE_WEEKS}-week pulse · {visible.length} {visible.length === 1 ? 'person' : 'people'}
								</h2>
							</div>
							<PulseGrid
								rows={visible.map<PulseRow>((r) => ({
									personId: r.person.id,
									personName: nameOf(r.person),
									weeks: r.series,
									needsAttention: r.signals.needsAttention,
								}))}
								weekLabels={pulseSeries}
							/>
						</Card>
					)
				) : visible.length === 0 ? (
					<Card>
						<p className="text-sm text-slate-500 text-center py-6">
							Nothing matches this filter for the {formatWeekRange(week)} week.
						</p>
					</Card>
				) : (
					<>
					<div className="space-y-2">
						{pageRows.map(({ person, checkin, reviews, responses: resp, comments, avg, reviewedByMe, signals }) => (
							<Card key={person.id} padding="none">
								{checkin ? (
									<details>
										<summary className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-hover transition-colors list-none [&::-webkit-details-marker]:hidden">
											<HeartPulse className="w-3.5 h-3.5 text-slate-400 shrink-0" />
											<Link href={`/team/${person.id}?tab=checkins`} className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 transition-colors">
												{nameOf(person)}
											</Link>
											<span className="text-2xs text-slate-600 dark:text-slate-400">
												{person.department_tag_id ? (tagLabel.get(person.department_tag_id) ?? '') : ''}
											</span>
											{/* Factual, never a diagnosis (spec language rule). */}
											{signals.needsAttention && (
												<span className="text-2xs text-amber-600 dark:text-amber-400" title={signals.reasons.join(' · ')}>
													Needs attention
												</span>
											)}
											<span className="ml-auto flex items-center gap-3 text-2xs text-slate-600 dark:text-slate-400">
												{avg != null && <span className="tabular-nums">avg {avg.toFixed(1)}/5</span>}
												{comments.length > 0 && <span className="tabular-nums">{comments.length} 💬</span>}
												<span className="inline-flex items-center gap-1.5">
													<span className={`w-1.5 h-1.5 rounded-full ${reviewedByMe ? 'bg-green-500' : 'bg-amber-500'}`} />
													{reviewedByMe ? 'Reviewed' : 'Submitted'}
												</span>
											</span>
										</summary>
										<div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 space-y-4">
											{/* The immutable check-in (snapshots — never re-joined to the catalog) */}
											<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
												{resp.map((r) => (
													<div key={r.category_label} className="rounded-md bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
														<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{r.category_label}</div>
														<div className="text-sm text-slate-900 dark:text-slate-100 mt-0.5">
															<span className="tabular-nums font-semibold">{r.score}/5</span> · {r.score_label}
														</div>
														{r.comment && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{r.comment}</p>}
													</div>
												))}
											</div>
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
												<div>
													<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">High</div>
													<p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{checkin.weekly_high}</p>
												</div>
												<div>
													<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">Low</div>
													<p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{checkin.weekly_low}</p>
												</div>
											</div>
											{checkin.extra_comments && (
												<div className="text-sm">
													<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-1">For the leader</div>
													<p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{checkin.extra_comments}</p>
												</div>
											)}
											{signals.needsAttention && (
												<div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
													<div className="text-2xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
														Needs attention
													</div>
													<ul className="text-2xs text-amber-800 dark:text-amber-300 space-y-0.5">
														{signals.reasons.map((r) => (
															<li key={r}>{r}</li>
														))}
													</ul>
												</div>
											)}
											<CheckinThread
												checkinId={checkin.id}
												viewerId={viewerId}
												subjectId={person.id}
												comments={comments}
												reviews={reviews}
												returnPath={returnPath}
											/>
										</div>
									</details>
								) : (
									<div className="flex items-center gap-3 px-3 py-2.5">
										<HeartPulse className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
										<Link href={`/team/${person.id}?tab=checkins`} className="text-sm font-medium text-slate-500 hover:text-primary-600 transition-colors">
											{nameOf(person)}
										</Link>
										<span className="text-2xs text-slate-600 dark:text-slate-400">
											{person.department_tag_id ? (tagLabel.get(person.department_tag_id) ?? '') : ''}
										</span>
										<span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
											<span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
											Missing
										</span>
									</div>
								)}
							</Card>
						))}
					</div>

					{/* Pager + page size. A size link drops ?p= — page 1 of the new size. */}
					<div className="mt-3 flex flex-wrap items-center gap-3 text-2xs text-slate-600 dark:text-slate-400">
						<span className="tabular-nums">
							Showing {slice.start + 1}–{slice.end} of {visible.length}
						</span>
						<span className="inline-flex items-center gap-1" role="group" aria-label="People per page">
							<span>Per page:</span>
							{PAGE_SIZES.map((n) =>
								n === size ? (
									<span
										key={n}
										aria-current="true"
										className="px-1.5 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300 font-medium tabular-nums"
									>
										{n}
									</span>
								) : (
									<Link
										key={n}
										href={`/team/checkins${qs({ size: String(n) })}`}
										className="px-1.5 py-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary-600 transition-colors tabular-nums"
									>
										{n}
									</Link>
								),
							)}
						</span>
						{slice.pageCount > 1 && (
							<span className="ml-auto flex items-center gap-1 shrink-0" role="navigation" aria-label="Pagination">
								{slice.page > 1 ? (
									<Link href={`/team/checkins${qs({ p: String(slice.page - 1) })}`} className="px-2 py-1 text-2xs rounded-md text-slate-600 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
										← Prev
									</Link>
								) : (
									<span className="px-2 py-1 text-2xs text-slate-300 dark:text-slate-600">← Prev</span>
								)}
								<span className="px-1 tabular-nums">
									{slice.page} / {slice.pageCount}
								</span>
								{slice.page < slice.pageCount ? (
									<Link href={`/team/checkins${qs({ p: String(slice.page + 1) })}`} className="px-2 py-1 text-2xs rounded-md text-slate-600 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
										Next →
									</Link>
								) : (
									<span className="px-2 py-1 text-2xs text-slate-300 dark:text-slate-600">Next →</span>
								)}
							</span>
						)}
					</div>
					</>
				)}

			</div>
		</>
	);
}
