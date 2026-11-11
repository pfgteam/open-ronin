// /hiring/quality — quality of hire (0135, H8; decision 9). Hire success =
// still employed at 180 days + advancements + calibration scores +
// contributions (Work Engine projects). Grouped by role / source / recruiter
// / interviewer / manager / department. Plus the funnel per position
// (stage conversion, time to hire, cost per hire), source quality and
// interviewer accuracy. Everyone with a start date is a "hire" so the
// dashboard reads for today's team (source "legacy"); module hires carry
// the funnel data too. Hiring circle only (RLS inside the functions).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadHiringConfig, loadQuality, loadStaff } from '@/lib/hiring/server';
import { departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { FUNNEL_STAGES, GROUP_LABELS, funnelCounts, groupHires, pct, successScore, type GroupBy } from '@/lib/hiring/quality';
import { usd } from '@/lib/hiring/shared';
import { formatDate } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Quality of hire · Hiring' };
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_LABEL: Record<string, string> = { new: 'Applied', screening: 'Screened', culture_fit: 'Culture fit', job_fit: 'Job fit', final: 'Final', offer: 'Offer', hired: 'Hired' };

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ by?: string; from?: string; to?: string; view?: string; position?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const by: GroupBy = (Object.keys(GROUP_LABELS) as GroupBy[]).includes(sp.by as GroupBy) ? (sp.by as GroupBy) : 'role';
	const from = sp.from && DATE_RE.test(sp.from) ? sp.from : null;
	const to = sp.to && DATE_RE.test(sp.to) ? sp.to : null;
	const view = sp.view === 'funnel' || sp.view === 'sources' || sp.view === 'interviewers' || sp.view === 'people' ? sp.view : 'groups';
	const [q, staff, deptTags] = await Promise.all([loadQuality(supabase, { from, to }), loadStaff(supabase), loadDepartments(supabase)]);
	if (q.notApplied) return <>{header(by, view, from, to)}<Callout tone="warning">Quality of hire needs migration <code>0135_hiring_h8_quality.sql</code>, which is written but not applied yet.</Callout></>;
	if (q.error) return <>{header(by, view, from, to)}<Callout tone="error">{q.error.includes('not allowed') ? 'Quality of hire is for the hiring circle (people managers, execs, admins).' : q.error}</Callout></>;
	const names = new Map<string, string>(staff.map((s) => [s.id, s.name]));
	for (const [id, label] of departmentLabelById(deptTags)) names.set(`dept:${id}`, label);
	const nm = (id: string | null | undefined) => (id ? names.get(id) ?? '—' : '—');
	const hires = q.hires;
	const groups = groupHires(hires, by, names);
	const all = groupHires(hires, 'role', names).reduce((acc, g) => ({ hires: acc.hires + g.hires, active: acc.active + g.active, adv: acc.adv + g.advancements, contrib: acc.contrib + g.contributions }), { hires: 0, active: 0, adv: 0, contrib: 0 });
	const r180 = { n: hires.filter((h) => h.retained_180 === true).length, of: hires.filter((h) => h.retained_180 !== null).length };
	const r90 = { n: hires.filter((h) => h.retained_90 === true).length, of: hires.filter((h) => h.retained_90 !== null).length };
	const cal = hires.map((h) => h.calibration_latest).filter((x): x is number => x != null);
	const tth = hires.map((h) => h.time_to_hire_days).filter((x): x is number => x != null);
	const totalCost = q.funnel.reduce((a, f) => a + f.posting_cost_cents, 0);
	const totalHired = q.funnel.reduce((a, f) => a + f.hired, 0);
	const funnel = sp.position ? q.funnel.filter((f) => f.position_id === sp.position) : q.funnel;

	return (
		<>
			{header(by, view, from, to)}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 mb-4">
				<Stat label="Hires" value={String(all.hires)} hint={`${all.active} still with us`} />
				<Stat label="Retained 90 d" value={pct(r90.n, r90.of)} hint={`${r90.n} of ${r90.of} known`} />
				<Stat label="Retained 180 d" value={pct(r180.n, r180.of)} hint={`${r180.n} of ${r180.of} known`} />
				<Stat label="Advancements" value={String(all.adv)} hint="level / specialty moves since start" />
				<Stat label="Calibration avg" value={cal.length ? String(Math.round((cal.reduce((a, b) => a + b, 0) / cal.length) * 10) / 10) : '—'} hint={`${cal.length} scored · /100`} />
				<Stat label="Time to hire" value={tth.length ? `${Math.round(tth.reduce((a, b) => a + b, 0) / tth.length)} d` : '—'} hint={`${tth.length} module hires`} />
				<Stat label="Cost per hire" value={totalHired ? usd(Math.round(totalCost / totalHired)) : totalCost ? usd(totalCost) : '—'} hint={`${usd(totalCost)} posting spend · ${totalHired} hired`} />
			</div>

			<div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
				{(['groups', 'people', 'funnel', 'sources', 'interviewers'] as const).map((v) => (
					<Link key={v} href={qs({ by, view: v, from, to })} className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap capitalize ${view === v ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
						{v === 'groups' ? `By ${GROUP_LABELS[by].toLowerCase()}` : v}
					</Link>
				))}
			</div>

			{view === 'groups' && (
				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hire success by {GROUP_LABELS[by].toLowerCase()}</h2>
						<div className="ml-auto flex gap-1">
							{(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
								<Link key={g} href={qs({ by: g, view: 'groups', from, to })} className={`px-2 py-0.5 text-2xs rounded-md ${by === g ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>{GROUP_LABELS[g]}</Link>
							))}
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="text-left px-3 py-2 font-medium">{GROUP_LABELS[by]}</th>
									<th className="text-right px-3 py-2 font-medium">Hires</th>
									<th className="text-right px-3 py-2 font-medium">Active</th>
									<th className="text-right px-3 py-2 font-medium">30 d</th>
									<th className="text-right px-3 py-2 font-medium">90 d</th>
									<th className="text-right px-3 py-2 font-medium">180 d</th>
									<th className="text-right px-3 py-2 font-medium">Advanc.</th>
									<th className="text-right px-3 py-2 font-medium">Calib.</th>
									<th className="text-right px-3 py-2 font-medium">Contrib.</th>
									<th className="text-right px-3 py-2 font-medium">Scorecard</th>
									<th className="text-right px-3 py-2 font-medium">Time to hire</th>
									<th className="text-right px-3 py-2 font-medium">Success</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{groups.map((g) => (
									<tr key={g.key} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
										<td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{g.label}</td>
										<td className="px-3 py-2 text-right tabular-nums">{g.hires}</td>
										<td className="px-3 py-2 text-right tabular-nums">{g.active}</td>
										<td className="px-3 py-2 text-right tabular-nums" title={`${g.retained_30.n} of ${g.retained_30.of}`}>{pct(g.retained_30.n, g.retained_30.of)}</td>
										<td className="px-3 py-2 text-right tabular-nums" title={`${g.retained_90.n} of ${g.retained_90.of}`}>{pct(g.retained_90.n, g.retained_90.of)}</td>
										<td className="px-3 py-2 text-right tabular-nums" title={`${g.retained_180.n} of ${g.retained_180.of}`}>{pct(g.retained_180.n, g.retained_180.of)}</td>
										<td className="px-3 py-2 text-right tabular-nums">{g.advancements}</td>
										<td className="px-3 py-2 text-right tabular-nums" title={`${g.calibration_n} scored`}>{g.calibration_avg ?? '—'}</td>
										<td className="px-3 py-2 text-right tabular-nums">{g.contributions}</td>
										<td className="px-3 py-2 text-right tabular-nums">{g.scorecard_avg ?? '—'}</td>
										<td className="px-3 py-2 text-right tabular-nums">{g.time_to_hire_avg != null ? `${g.time_to_hire_avg} d` : '—'}</td>
										<td className="px-3 py-2 text-right tabular-nums"><Score v={g.success_score} /></td>
									</tr>
								))}
								{groups.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-500">No hires in this window.</td></tr>}
							</tbody>
						</table>
					</div>
					<p className="px-3 py-2 text-2xs text-slate-500">Retention = retained / people past the milestone (or exited). Success score 0-100: 40 retention (furthest known milestone) + 20 advancements (cap 2) + 25 latest calibration total + 15 completed Work Engine projects (cap 10); re-weighted when a component is unknown. &quot;legacy&quot; = on the team before the module (no funnel data).</p>
				</Card>
			)}

			{view === 'people' && (
				<Card padding="none">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="text-left px-3 py-2 font-medium">Person</th>
									<th className="text-left px-3 py-2 font-medium">Role</th>
									<th className="text-left px-3 py-2 font-medium">Started</th>
									<th className="text-right px-3 py-2 font-medium">Days</th>
									<th className="text-left px-3 py-2 font-medium">30/60/90/180</th>
									<th className="text-right px-3 py-2 font-medium">Adv.</th>
									<th className="text-right px-3 py-2 font-medium">Calib.</th>
									<th className="text-right px-3 py-2 font-medium">Contrib.</th>
									<th className="text-left px-3 py-2 font-medium">Source</th>
									<th className="text-left px-3 py-2 font-medium">Recruiter</th>
									<th className="text-left px-3 py-2 font-medium">Onboarding</th>
									<th className="text-right px-3 py-2 font-medium">Success</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{hires.map((h) => (
									<tr key={h.profile_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
										<td className="px-3 py-1.5">
											<Link href={`/team/${h.profile_id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">{h.full_name}</Link>
											{!h.is_active && <Badge className="ml-1">exited{h.exited_on ? ` ${formatDate(h.exited_on)}` : ''}</Badge>}
										</td>
										<td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{h.position_title ?? h.job_role ?? '—'}</td>
										<td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{formatDate(h.date_started)}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{h.days_employed}</td>
										<td className="px-3 py-1.5"><Milestones h={h} /></td>
										<td className="px-3 py-1.5 text-right tabular-nums">{h.advancements}</td>
										<td className="px-3 py-1.5 text-right tabular-nums" title={h.calibration_outcome ?? ''}>{h.calibration_latest ?? '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums" title={`${h.contributions_open} open`}>{h.contributions}</td>
										<td className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400">{h.board_key ?? h.source ?? 'legacy'}{h.time_to_hire_days != null ? ` · ${h.time_to_hire_days} d` : ''}</td>
										<td className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400">{nm(h.recruiter_id)}</td>
										<td className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400">{h.onboarding_total ? <Link href={`/team/onboarding/${h.profile_id}`} className="hover:underline">{h.onboarding_done}/{h.onboarding_total} · {h.onboarding_status}</Link> : '—'}</td>
										<td className="px-3 py-1.5 text-right"><Score v={successScore(h)} /></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			)}

			{view === 'funnel' && (
				<div className="space-y-3">
					{funnel.length === 0 && <Card><p className="text-sm text-slate-500 py-4 text-center">No positions past draft yet.</p></Card>}
					{funnel.map((f) => {
						const steps = funnelCounts(f);
						return (
							<Card key={f.position_id} padding="none">
								<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
									<Link href={`/hiring/positions/${f.position_id}/applications`} className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:underline">{f.title}</Link>
									<Badge>{f.status}</Badge>
									<span className="text-2xs text-slate-500">{f.department_label ?? ''} · manager {nm(f.hiring_manager_id)} · recruiter {nm(f.recruiter_id)}{f.opened_at ? ` · opened ${formatDate(f.opened_at)}` : ''}</span>
									<span className="ml-auto text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
										{f.hired}/{f.headcount} hired · {f.interviews} interviews ({f.no_shows} no-show) · {f.offers} offers ({f.offers_declined} declined) · {f.median_time_to_hire_days != null ? `median ${f.median_time_to_hire_days} d` : 'no hire yet'} · spend {usd(f.posting_cost_cents)}{f.cost_per_hire_cents != null ? ` · ${usd(f.cost_per_hire_cents)} / hire` : ''}
									</span>
								</div>
								<div className="px-3 py-3 grid grid-cols-7 gap-1">
									{steps.map((s, i) => {
										const w = steps[0].entered ? Math.max(4, Math.round((100 * s.entered) / steps[0].entered)) : 0;
										return (
											<div key={s.stage} className="text-center">
												<div className="h-16 flex items-end justify-center"><div className="w-full max-w-[64px] rounded-t-md bg-primary-600/80 dark:bg-primary-500/70" style={{ height: `${w}%` }} /></div>
												<div className="text-xs font-medium tabular-nums text-slate-900 dark:text-slate-100">{s.entered}</div>
												<div className="text-2xs text-slate-500">{STAGE_LABEL[FUNNEL_STAGES[i]]}</div>
												<div className="text-2xs text-slate-400 tabular-nums">{s.conv}</div>
											</div>
										);
									})}
								</div>
								<div className="px-3 pb-2 text-2xs text-slate-500">Avg overall score {f.avg_overall_score ?? '—'} all applicants · {f.avg_overall_hired ?? '—'} hired. Status now: {Object.entries(f.by_status).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</div>
							</Card>
						);
					})}
				</div>
			)}

			{view === 'sources' && (
				<Card padding="none">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="text-left px-3 py-2 font-medium">Position</th>
									<th className="text-left px-3 py-2 font-medium">Source</th>
									<th className="text-right px-3 py-2 font-medium">Link hits</th>
									<th className="text-right px-3 py-2 font-medium">Applied</th>
									<th className="text-right px-3 py-2 font-medium">Past screen</th>
									<th className="text-right px-3 py-2 font-medium">Interviewed</th>
									<th className="text-right px-3 py-2 font-medium">Offered</th>
									<th className="text-right px-3 py-2 font-medium">Hired</th>
									<th className="text-right px-3 py-2 font-medium">Kept 90 d</th>
									<th className="text-right px-3 py-2 font-medium">Avg score</th>
									<th className="text-right px-3 py-2 font-medium">Integrity</th>
									<th className="text-right px-3 py-2 font-medium">Flagged</th>
									<th className="text-right px-3 py-2 font-medium">Spend</th>
									<th className="text-right px-3 py-2 font-medium">/ hire</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{q.sources.map((s) => {
									const f = q.funnel.find((x) => x.position_id === s.position_id);
									return (
										<tr key={`${s.position_id}-${s.source}-${s.board_key}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
											<td className="px-3 py-1.5 text-slate-900 dark:text-slate-100">{f?.title ?? s.position_id.slice(0, 8)}</td>
											<td className="px-3 py-1.5"><Badge color="primary">{s.board_key ?? s.source}</Badge></td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.link_hits}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.applications}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.past_screening} <span className="text-slate-400">{pct(s.past_screening, s.applications)}</span></td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.interviewed}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.offered}</td>
											<td className="px-3 py-1.5 text-right tabular-nums font-medium">{s.hired} <span className="text-slate-400 font-normal">{pct(s.hired, s.applications)}</span></td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.retained_90}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.avg_overall ?? '—'}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.avg_integrity ?? '—'}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.flagged}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.posting_cost_cents ? usd(s.posting_cost_cents) : '—'}</td>
											<td className="px-3 py-1.5 text-right tabular-nums">{s.cost_per_hire_cents != null ? usd(s.cost_per_hire_cents) : '—'}</td>
										</tr>
									);
								})}
								{q.sources.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-slate-500">No applications yet.</td></tr>}
							</tbody>
						</table>
					</div>
				</Card>
			)}

			{view === 'interviewers' && (
				<Card padding="none">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="text-left px-3 py-2 font-medium">Interviewer</th>
									<th className="text-right px-3 py-2 font-medium">Cards</th>
									<th className="text-right px-3 py-2 font-medium">Avg score</th>
									<th className="text-left px-3 py-2 font-medium">Recommendations</th>
									<th className="text-right px-3 py-2 font-medium">Decided</th>
									<th className="text-right px-3 py-2 font-medium">Accuracy</th>
									<th className="text-right px-3 py-2 font-medium">Hired after yes</th>
									<th className="text-right px-3 py-2 font-medium">Hired after no</th>
									<th className="text-right px-3 py-2 font-medium">Rejected after yes</th>
									<th className="text-right px-3 py-2 font-medium">Score hired / rejected</th>
									<th className="text-right px-3 py-2 font-medium">Kept 90 d after yes</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{q.interviewers.map((i) => (
									<tr key={i.scorer_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
										<td className="px-3 py-1.5 font-medium text-slate-900 dark:text-slate-100">{nm(i.scorer_id)}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.cards} <span className="text-slate-400">/ {i.interviews}</span></td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.avg_score ?? '—'}</td>
										<td className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400">{i.strong_hire} strong · {i.advance} advance · {i.conditional} conditional · {i.no_hire} no hire</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.decided}</td>
										<td className="px-3 py-1.5 text-right tabular-nums font-medium">{i.accuracy_pct != null ? `${i.accuracy_pct}%` : '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.hired_after_yes}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.hired_after_no}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.rejected_after_yes}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.avg_score_hired ?? '—'} / {i.avg_score_rejected ?? '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{i.retained_90_after_yes}</td>
									</tr>
								))}
								{q.interviewers.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">No submitted scorecards yet.</td></tr>}
							</tbody>
						</table>
					</div>
					<p className="px-3 py-2 text-2xs text-slate-500">Accuracy = cards where the recommendation (strong hire / advance = yes, no hire = no) matched the final decision (hired / rejected), over decided cards. Conditional is neither. AI prefill cards are excluded.</p>
				</Card>
			)}
		</>
	);
}

function qs(p: { by: GroupBy; view: string; from: string | null; to: string | null }) {
	const u = new URLSearchParams();
	u.set('by', p.by);
	if (p.view !== 'groups') u.set('view', p.view);
	if (p.from) u.set('from', p.from);
	if (p.to) u.set('to', p.to);
	return `/hiring/quality?${u.toString()}`;
}

function header(by: GroupBy, view: string, from: string | null, to: string | null) {
	return (
		<PageHeader
			title="Quality of hire"
			description="Still employed at 180 days, advancements, calibration, contributions — by role, source, recruiter, interviewer. Funnel, stage conversion, time to hire, cost per hire, source quality, interviewer accuracy."
			actions={
				<form className="flex items-center gap-2 text-xs" action="/hiring/quality" method="get">
					<input type="hidden" name="by" value={by} />
					{view !== 'groups' && <input type="hidden" name="view" value={view} />}
					<label className="text-slate-500">Started from</label>
					<input type="date" name="from" defaultValue={from ?? ''} className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs" />
					<label className="text-slate-500">to</label>
					<input type="date" name="to" defaultValue={to ?? ''} className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs" />
					<button type="submit" className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45">Apply</button>
					{(from || to) && <Link href={qs({ by, view, from: null, to: null })} className="text-primary-600 hover:underline">clear</Link>}
				</form>
			}
		/>
	);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<Card>
			<div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div>
			<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
			{hint && <div className="text-2xs text-slate-500 truncate">{hint}</div>}
		</Card>
	);
}

function Score({ v }: { v: number | null }) {
	if (v == null) return <span className="text-slate-400">—</span>;
	const color = v >= 70 ? 'success' : v >= 40 ? 'warning' : 'danger';
	return <Badge color={color}>{v}</Badge>;
}

function Milestones({ h }: { h: { retained_30: boolean | null; retained_60: boolean | null; retained_90: boolean | null; retained_180: boolean | null } }) {
	const dot = (v: boolean | null, label: string) => (
		<span key={label} title={`${label}: ${v === null ? 'not yet' : v ? 'retained' : 'exited before'}`} className={`inline-block w-2.5 h-2.5 rounded-full ${v === null ? 'bg-slate-200 dark:bg-slate-600' : v ? 'bg-green-500' : 'bg-red-500'}`} />
	);
	return <span className="inline-flex gap-1 items-center">{dot(h.retained_30, '30 d')}{dot(h.retained_60, '60 d')}{dot(h.retained_90, '90 d')}{dot(h.retained_180, '180 d')}</span>;
}
