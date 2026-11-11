// /hiring/calendar — every scheduled interview across roles (0132): upcoming
// by day, mine only toggle, no-shows and completed in the last two weeks.
// Booking itself happens on Calendly (Alex) / GHL calendars (team) via the
// links on the stage; this is the one view of what is on the books.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadHiringConfig, loadInterviewCalendar, loadStaff } from '@/lib/hiring/server';
import { INTERVIEW_KIND_LABELS, INTERVIEW_STATUS_COLORS, LOCATION_KIND_LABELS } from '@/lib/hiring/pipeline';
import { formatDate } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Hiring calendar' };
export const dynamic = 'force-dynamic';

export default async function HiringCalendarPage({ searchParams }: { searchParams: Promise<{ mine?: string; past?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const from = sp.past === '1' ? new Date(Date.now() - 14 * 86_400_000).toISOString() : new Date(Date.now() - 2 * 3_600_000).toISOString();
	const [rows, staff] = await Promise.all([loadInterviewCalendar(supabase, { from, mine: sp.mine === '1' ? profile.id : null }), loadStaff(supabase)]);
	const name = new Map(staff.map((s) => [s.id, s.name]));
	const unscheduled = rows.filter((r) => !r.scheduled_at);
	const scheduled = rows.filter((r) => r.scheduled_at);
	const byDay = new Map<string, typeof scheduled>();
	for (const r of scheduled) {
		const day = formatDate(r.scheduled_at!, 'EEEE, MMM d');
		byDay.set(day, [...(byDay.get(day) ?? []), r]);
	}
	return (
		<>
			<PageHeader title="Hiring calendar" description={`${scheduled.length} on the books · ${unscheduled.length} proposed without a time · reminders go 24 h and 1 h before (SMS via the hiring number, email fallback) · no-shows are marked 30 min after start when nobody completes the interview`} />
			<div className="flex gap-1.5 mb-3">
				<FilterChipLink href="/hiring/calendar" active={sp.mine !== '1' && sp.past !== '1'}>
					Upcoming
				</FilterChipLink>
				<FilterChipLink href="/hiring/calendar?mine=1" active={sp.mine === '1'}>
					Mine
				</FilterChipLink>
				<FilterChipLink href="/hiring/calendar?past=1" active={sp.past === '1'}>
					Last 14 days
				</FilterChipLink>
			</div>
			{unscheduled.length > 0 && (
				<Card className="mb-4 space-y-1">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Waiting for a time</h2>
					{unscheduled.map((r) => (
						<div key={r.id} className="text-xs text-slate-600 dark:text-slate-400">
							<Link href={`/hiring/positions/${r.position_id}/applications/${r.application_id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
								{r.candidate_name}
							</Link>{' '}
							· {r.position_title} · {INTERVIEW_KIND_LABELS[r.kind]}
							{r.booking_url ? ' · booking link sent' : ' · no booking link'}
						</div>
					))}
				</Card>
			)}
			{byDay.size === 0 && <Card className="text-sm text-slate-500">Nothing scheduled{sp.mine === '1' ? ' for you' : ''}.</Card>}
			<div className="space-y-4">
				{[...byDay.entries()].map(([day, list]) => (
					<Card key={day} padding="none">
						<div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">{day}</div>
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{list.map((r) => (
								<li key={r.id} className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
									<span className="font-mono text-slate-700 dark:text-slate-300 w-20">{formatDate(r.scheduled_at!, 'h:mm a')}</span>
									<Link href={`/hiring/positions/${r.position_id}/applications/${r.application_id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
										{r.candidate_name}
									</Link>
									<span className="text-slate-500">{r.position_title}</span>
									<Badge>{INTERVIEW_KIND_LABELS[r.kind]}</Badge>
									<Badge color={INTERVIEW_STATUS_COLORS[r.status]}>{r.status.replace('_', ' ')}</Badge>
									<span className="text-xs text-slate-500">
										{r.duration_min} min · {LOCATION_KIND_LABELS[r.location_kind]} · {r.interviewer_ids.map((id) => name.get(id) ?? '').filter(Boolean).join(', ') || 'no interviewers'}
									</span>
									{r.location_text && (
										<a href={r.location_text} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline ml-auto">
											Join
										</a>
									)}
								</li>
							))}
						</ul>
					</Card>
				))}
			</div>
		</>
	);
}
