// /social/time-study — Time Study (Tools; Alex, 2026-09-14).
//
// One page, three views, driven by the URL:
//   default            the viewer's own entry grid for the current study
//                      (10-minute slots, two weeks, auto-saves, pulls their
//                      own Google Calendar events, submit step)
//   ?view=review       leaders: submissions to review + the team view with
//                      department breakdowns (people-managers / exec / admin)
//   ?person=<id>       a leader reading one person's grid, read-only
//   ?study=<id>        any past study (defaults to the most recent open one)
// Kick-off, categories and status live on /admin/time-study (admin only).
// Tables: 0083 (time_studies, time_study_entries, time_study_submissions).

import Link from 'next/link';
import { departmentLabelById, loadDepartments } from '@/lib/people/departments';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { redirect } from 'next/navigation';
import { Clock } from 'lucide-react';
import { STATUS_LABELS, type StudyCategory, type StudyEntry, type TimeStudy } from '@/lib/timeStudy/shared';
import TimeStudyGrid from './TimeStudyGrid';
import TimeStudyReview, { type DeptRollup, type PersonRollup } from './TimeStudyReview';

export const metadata = { title: 'Time Study' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function TimeStudyPage({
	searchParams,
}: {
	searchParams: Promise<{ study?: string; view?: string; person?: string }>;
}) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const ctx = await loadSensitiveAccessContext();
	const canReview = canManagePeople(ctx);
	const isAdmin = profile.role === 'admin';

	const supabase = await createClient();
	const { data: studyRows, error: studyError } = await supabase
		.from('time_studies')
		.select('id, name, starts_on, ends_on, status, day_start_hour, day_end_hour, opened_at, closed_at')
		.neq('status', 'draft')
		.order('starts_on', { ascending: false })
		.limit(24);

	if (studyError) {
		return (
			<>
				<PageHeader title="Time Study" description="Two-week, 10-minute time studies for the whole team." />
				<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
					<p className="text-sm text-amber-800 dark:text-amber-300">
						Time Study isn&apos;t switched on yet. Ask Ops to enable it.
					</p>
				</Card>
			</>
		);
	}
	const studies = (studyRows ?? []) as TimeStudy[];
	const study = (UUID.test(sp.study ?? '') ? studies.find((s) => s.id === sp.study) : null) ?? studies.find((s) => s.status === 'open') ?? studies[0] ?? null;

	if (!study) {
		return (
			<>
				<PageHeader title="Time Study" description="Two-week, 10-minute time studies for the whole team." />
				<Card>
					<div className="text-center py-10">
						<Clock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">No time study is open</h3>
						<p className="text-sm text-slate-500 max-w-md mx-auto">
							A time study is kicked off for the whole team by an admin. When one opens it appears here with your two-week grid.
						</p>
						{isAdmin && (
							<Link href="/admin/time-study" className="inline-block mt-4 text-sm text-primary-600 hover:underline">Kick one off in Admin → Time Study →</Link>
						)}
					</div>
				</Card>
			</>
		);
	}

	const { data: catRows } = await supabase.from('time_study_categories').select('slug, label, color, sort, is_active').order('sort');
	const categories = (catRows ?? []) as StudyCategory[];

	const view = sp.view === 'review' && canReview ? 'review' : 'entry';
	const personId = UUID.test(sp.person ?? '') && canReview ? (sp.person as string) : profile.id;

	const studyPicker = (
		<div className="flex items-center gap-2 flex-wrap">
			{studies.length > 1 && (
				<form method="get" className="inline-flex items-center gap-1">
					{view === 'review' && <input type="hidden" name="view" value="review" />}
					<select
						name="study"
						defaultValue={study.id}
						className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
						aria-label="Which study"
					>
						{studies.map((s) => (
							<option key={s.id} value={s.id}>{s.name} · {s.starts_on} → {s.ends_on}</option>
						))}
					</select>
					<button type="submit" className="text-xs text-slate-500 hover:text-primary-600">Go</button>
				</form>
			)}
			{canReview && (
				<Link
					href={view === 'review' ? `/social/time-study?study=${study.id}` : `/social/time-study?study=${study.id}&view=review`}
					className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap"
				>
					{view === 'review' ? 'My entry →' : 'Leader review + team view →'}
				</Link>
			)}
			{isAdmin && (
				<Link href="/admin/time-study" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Admin →</Link>
			)}
		</div>
	);

	if (view === 'review') {
		const [{ data: personTotals }, { data: deptTotals }, { data: subs }, { data: people }, departmentTags] = await Promise.all([
			supabase.from('v_time_study_person_totals').select('user_id, category, minutes, calendar_minutes').eq('study_id', study.id),
			supabase.from('v_time_study_dept_totals').select('department, category, minutes, people').eq('study_id', study.id),
			supabase.from('time_study_submissions').select('user_id, submitted_at, reviewed_at, review_note').eq('study_id', study.id),
			supabase.from('profiles').select('id, first_name, last_name, department_tag_id').eq('is_active', true).order('first_name'),
			loadDepartments(supabase),
		]);
		// 0089: department label resolves through tags, not the retired text column.
		const deptLabels = departmentLabelById(departmentTags);
		const subByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s]));
		const totalsByUser = new Map<string, { minutes: number; calendar: number; byCategory: Record<string, number> }>();
		for (const t of personTotals ?? []) {
			const cur = totalsByUser.get(t.user_id as string) ?? { minutes: 0, calendar: 0, byCategory: {} };
			cur.minutes += Number(t.minutes);
			cur.calendar += Number(t.calendar_minutes);
			cur.byCategory[t.category as string] = (cur.byCategory[t.category as string] ?? 0) + Number(t.minutes);
			totalsByUser.set(t.user_id as string, cur);
		}
		const rollup: PersonRollup[] = (people ?? [])
			.map((p) => {
				const t = totalsByUser.get(p.id as string);
				const s = subByUser.get(p.id as string);
				return {
					userId: p.id as string,
					name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed',
					department: deptLabels.get((p.department_tag_id as string | null) ?? '') ?? null,
					minutes: t?.minutes ?? 0,
					calendarMinutes: t?.calendar ?? 0,
					byCategory: t?.byCategory ?? {},
					submittedAt: (s?.submitted_at as string | undefined) ?? null,
					reviewedAt: (s?.reviewed_at as string | undefined) ?? null,
					reviewNote: (s?.review_note as string | undefined) ?? null,
				};
			})
			.filter((r) => r.minutes > 0 || r.submittedAt)
			.sort((a, b) => b.minutes - a.minutes);
		const deptMap = new Map<string, DeptRollup>();
		for (const d of deptTotals ?? []) {
			const cur = deptMap.get(d.department as string) ?? { department: d.department as string, people: 0, minutes: 0, byCategory: {} };
			cur.minutes += Number(d.minutes);
			cur.people = Math.max(cur.people, Number(d.people));
			cur.byCategory[d.category as string] = (cur.byCategory[d.category as string] ?? 0) + Number(d.minutes);
			deptMap.set(d.department as string, cur);
		}
		const departments = [...deptMap.values()].sort((a, b) => b.minutes - a.minutes);

		return (
			<>
				<PageHeader
					title={`Time Study · ${study.name}`}
					description={`${study.starts_on} → ${study.ends_on} · ${STATUS_LABELS[study.status]} · leader review and team breakdown`}
					actions={studyPicker}
				/>
				<TimeStudyReview studyId={study.id} categories={categories} people={rollup} departments={departments} canReview={canReview} isAdmin={isAdmin} />
			</>
		);
	}

	const [{ data: entryRows }, { data: sub }, { data: cal }, { data: subject }] = await Promise.all([
		supabase.from('time_study_entries').select('day, slot, category, source, note').eq('study_id', study.id).eq('user_id', personId),
		supabase.from('time_study_submissions').select('submitted_at').eq('study_id', study.id).eq('user_id', personId).maybeSingle(),
		supabase.from('google_calendar_connections').select('id').eq('user_id', profile.id).limit(1),
		personId !== profile.id ? supabase.from('profiles').select('first_name, last_name').eq('id', personId).maybeSingle() : Promise.resolve({ data: null }),
	]);
	const entries = (entryRows ?? []) as StudyEntry[];
	const readingSomeoneElse = personId !== profile.id;
	const subjectName = subject ? [subject.first_name, subject.last_name].filter(Boolean).join(' ') : null;

	return (
		<>
			<PageHeader
				title={`Time Study · ${study.name}`}
				description={
					<span className="inline-flex items-center gap-2 flex-wrap">
						{study.starts_on} → {study.ends_on}
						<Badge color={study.status === 'open' ? 'success' : 'default'}>{STATUS_LABELS[study.status]}</Badge>
						{readingSomeoneElse ? `· reading ${subjectName ?? 'a teammate'}'s entry` : '· 10-minute slots, saves as you go'}
					</span>
				}
				actions={studyPicker}
			/>
			{readingSomeoneElse ? (
				<Card>
					<p className="text-sm text-slate-500 mb-3">Read-only view of {subjectName ?? 'this person'}&apos;s entries.</p>
					<TimeStudyGrid study={{ ...study, status: 'closed' }} categories={categories} initialEntries={entries} submittedAt={(sub?.submitted_at as string | undefined) ?? null} hasCalendar={false} />
				</Card>
			) : (
				<TimeStudyGrid study={study} categories={categories} initialEntries={entries} submittedAt={(sub?.submitted_at as string | undefined) ?? null} hasCalendar={(cal ?? []).length > 0} />
			)}
		</>
	);
}
