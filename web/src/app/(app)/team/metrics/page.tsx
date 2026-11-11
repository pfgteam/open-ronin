// /team/metrics — Performance Metrics (Alex, 2026-09-14).
//
// Two things on one page, kept visibly separate:
//
//   1. PERFORMANCE (PAP-sourced). One row per active person: the metrics
//      their PAP specialty (profiles.pap_position, pap_positions catalog,
//      0030) plus per-person overrides (0050) say they answer for, and how
//      many of them have a number for the month. Entry stays on the profile
//      (?tab=metrics) — this is the roster view of that, which the old
//      redirect at this URL did not provide.
//
//   2. TRACKED (non-performance). Definitions tagged with the `team` surface
//      on Admin -> Metrics (0082): numbers people should be tracking anyway
//      that are not part of anyone's PAP. Entered here per department for
//      the month (metrics rows with subject_type = 'team'), so a metric can
//      be tracked without being wired to a specialty or a bonus.
//
// Visibility follows the metrics RLS: a person sees their own row, a manager
// their reports', people-managers / exec / admin everyone; the coverage
// line says which it is (Rule 3: report coverage, never imply it).

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Gauge } from 'lucide-react';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { resolveMetricRows, type MetricOverride } from '@/lib/people/metricRows';
import { surfacesOf } from '@/lib/metrics/surfaces';
import { redirect } from 'next/navigation';
import { Field, FormError, inputClass, selectClass } from '../_form';
import { saveTeamMetrics } from './actions.team';

export const metadata = { title: 'Team Metrics' };
export const dynamic = 'force-dynamic';

interface Def {
	key: string;
	name: string;
	unit: string | null;
	pap_positions: string[];
	sort: number;
	requires_goal: boolean;
	source: string;
	surfaces?: string[] | null;
	calc_notes?: string | null;
	sheet_source_of_truth?: string | null;
}

interface Person {
	id: string;
	first_name: string | null;
	last_name: string | null;
	pap_position: string | null;
	department_tag_id: string | null;
}

interface ValueRow {
	metric_key: string;
	subject_type: string;
	subject_id: string | null;
	subject_ref: string | null;
	value: number | null;
	goal: number | null;
}

function monthShift(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	const d = new Date(Date.UTC(y, m - 1 + delta, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function TeamMetricsPage({
	searchParams,
}: {
	searchParams: Promise<{ month?: string; dept?: string; person?: string; period?: string; error?: string; saved?: string }>;
}) {
	const sp = await searchParams;
	// Old links (/team/metrics?person=&period=) still land on that person's
	// profile month — the redirect this page used to be.
	if (sp.person) {
		const month = /^\d{4}-\d{2}$/.test(sp.period ?? '') ? `&month=${sp.period}` : '';
		redirect(`/team/${sp.person}?tab=metrics${month}`);
	}
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const ctx = await loadSensitiveAccessContext();
	const isManager = canManagePeople(ctx);

	const now = new Date();
	const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
	const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : currentMonth;
	const period = `${month}-01`;
	const monthLabel = new Date(`${period}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

	const supabase = await createClient();
	const [{ data: defRows }, { data: people }, { data: values }, { data: overrideRows }, { data: deptRows }] = await Promise.all([
		supabase.from('metric_definitions').select('*').eq('is_active', true).order('sort'),
		supabase.from('profiles').select('id, first_name, last_name, pap_position, department_tag_id').eq('is_active', true).order('first_name'),
		supabase.from('metrics').select('metric_key, subject_type, subject_id, subject_ref, value, goal').eq('period', period),
		supabase.from('profile_metric_overrides').select('profile_id, metric_key, mode'),
		supabase.from('tags').select('id, slug, label').eq('category', 'department').order('position'),
	]);
	const defs = (defRows ?? []) as Def[];
	const roster = (people ?? []) as Person[];
	const rows = (values ?? []) as ValueRow[];
	const departments = (deptRows ?? []) as { id: string; slug: string; label: string }[];

	// --- 1. Performance: per-person PAP set + coverage ------------------------
	const overridesByPerson = new Map<string, MetricOverride[]>();
	for (const o of overrideRows ?? []) {
		const list = overridesByPerson.get(o.profile_id as string) ?? [];
		list.push({ metric_key: o.metric_key as string, mode: o.mode as MetricOverride['mode'] });
		overridesByPerson.set(o.profile_id as string, list);
	}
	const valuesByPerson = new Map<string, ValueRow[]>();
	for (const r of rows) {
		if (r.subject_type !== 'user' || !r.subject_id) continue;
		const list = valuesByPerson.get(r.subject_id) ?? [];
		list.push(r);
		valuesByPerson.set(r.subject_id, list);
	}
	const deptFilter = sp.dept && departments.some((d) => d.slug === sp.dept) ? (sp.dept as string) : null;
	const deptLabelOf = (slug: string | null) => departments.find((d) => d.slug === slug)?.label ?? slug ?? '—';
	const deptIdBySlug = new Map(departments.map((d) => [d.slug, d.id]));
	const deptLabelById = new Map(departments.map((d) => [d.id, d.label]));
	const performance = roster
		// Matches on department_tag_id now (0089 retired the free-text column),
		// which also drops the old slug-or-label double comparison.
		.filter((p) => !deptFilter || p.department_tag_id === deptIdBySlug.get(deptFilter))
		.map((p) => {
			const mine = valuesByPerson.get(p.id) ?? [];
			const resolved = resolveMetricRows({
				defs,
				papPosition: p.pap_position,
				overrides: overridesByPerson.get(p.id) ?? [],
				keysWithValues: mine.map((r) => r.metric_key),
			});
			const filled = resolved.filter((r) => mine.some((v) => v.metric_key === r.def.key && v.value != null)).length;
			return { person: p, total: resolved.length, filled };
		})
		.filter((r) => r.total > 0 || isManager);

	// --- 2. Tracked (non-performance): `team` surface, per department ---------
	const tracked = defs.filter((d) => surfacesOf(d).includes('team'));
	const trackedDept = deptFilter ?? departments[0]?.slug ?? null;
	const teamValues = new Map<string, ValueRow>();
	for (const r of rows) {
		if (r.subject_type === 'team' && r.subject_ref === trackedDept) teamValues.set(r.metric_key, r);
	}

	const withMonth = (m: string, extra: Record<string, string | undefined> = {}) => {
		const usp = new URLSearchParams({ month: m });
		if (deptFilter) usp.set('dept', deptFilter);
		for (const [k, v] of Object.entries(extra)) if (v) usp.set(k, v);
		return `/team/metrics?${usp.toString()}`;
	};

	return (
		<>
			<div className="space-y-4">
				<PageHeader
					title="Team Metrics"
					description="Performance metrics from each person's PAP, plus the non-performance numbers the team tracks anyway."
					actions={
						<div className="flex items-center gap-1 text-sm">
							<Link href={withMonth(monthShift(month, -1))} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/45" aria-label="Previous month">
								<ChevronLeft className="w-4 h-4" />
							</Link>
							<span className="font-medium text-slate-900 dark:text-slate-100 min-w-32 text-center">{monthLabel}</span>
							<Link href={withMonth(monthShift(month, 1))} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/45" aria-label="Next month">
								<ChevronRight className="w-4 h-4" />
							</Link>
						</div>
					}
				/>
				<FormError message={sp.error} />
				{sp.saved && !sp.error && (
					<Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
						<p className="text-sm text-green-800 dark:text-green-300">Saved {sp.saved} team metric{sp.saved === '1' ? '' : 's'} for {monthLabel}.</p>
					</Card>
				)}

				<Card>
					<form method="get" className="flex items-end gap-3 flex-wrap">
						<input type="hidden" name="month" value={month} />
						<Field label="Department">
							<select name="dept" defaultValue={deptFilter ?? ''} className={selectClass}>
								<option value="">All</option>
								{departments.map((d) => (
									<option key={d.slug} value={d.slug}>{d.label}</option>
								))}
							</select>
						</Field>
						<button type="submit" className="rounded-md border border-slate-300 dark:border-slate-600 text-sm font-medium px-3 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45">
							Filter
						</button>
						<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto inline-flex items-center gap-1.5">
							<Gauge className="w-3.5 h-3.5" />
							Scoped to what your role can see — your own numbers, your reports&apos;, or everyone&apos;s for people-managers and exec/admin.
						</span>
					</form>
				</Card>

				{/* 1. Performance (PAP) */}
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Performance metrics · from PAPs</h2>
						<span className="text-xs text-slate-400 tabular-nums">{performance.length}</span>
						<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto">specialty set + per-person overrides · entry on each profile</span>
					</div>
					{performance.length === 0 ? (
						<p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Nobody visible to you has PAP metrics this month.</p>
					) : (
						<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Person</th>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Specialty</th>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Department</th>
									<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Filled</th>
									<th className="w-24" />
								</tr>
							</thead>
							<tbody>
								{performance.map(({ person, total, filled }) => (
									<tr key={person.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-1.5 text-slate-900 dark:text-slate-100">
											<Link href={`/team/${person.id}?tab=metrics&month=${month}`} className="hover:text-primary-600">
												{[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unnamed'}
											</Link>
										</td>
										<td className="px-3 py-1.5 text-slate-500">{person.pap_position ? <Badge color="default">{person.pap_position}</Badge> : '—'}</td>
										<td className="px-3 py-1.5 text-slate-500">{(person.department_tag_id ? deptLabelById.get(person.department_tag_id) : null) ?? '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">
											<span className={filled === total && total > 0 ? 'text-green-600 dark:text-green-400' : filled === 0 && total > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
												{filled} of {total}
											</span>
										</td>
										<td className="px-3 py-1.5 text-right">
											<Link href={`/team/${person.id}?tab=metrics&month=${month}`} className="text-2xs text-primary-600 hover:underline">
												{total === 0 ? 'set up' : 'open'}
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						</div>
					)}
				</Card>

				{/* 2. Tracked (non-performance) */}
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tracked metrics · not tied to a PAP</h2>
						<span className="text-xs text-slate-400 tabular-nums">{tracked.length}</span>
						<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto">
							per department · {trackedDept ? deptLabelOf(trackedDept) : 'no department'} · {monthLabel}
						</span>
					</div>
					{tracked.length === 0 ? (
						<p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
							Nothing is tagged for team tracking yet. Tick <em>Team → Metrics</em> under “Surfaces on” in{' '}
							<Link href="/admin/metrics" className="text-primary-600 hover:underline">Admin → Metrics</Link> to track a metric here without
							attaching it to anyone&apos;s PAP.
						</p>
					) : !trackedDept ? (
						<p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Pick a department above to enter its numbers.</p>
					) : (
						<form action={saveTeamMetrics.bind(null, trackedDept, period)}>
							<div className="overflow-x-auto">
							<table className="w-full text-xs">
								<thead className="bg-slate-50/80 dark:bg-slate-900/30">
									<tr>
										<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Metric</th>
										<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Source</th>
										<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-32">Value</th>
										<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-32">Goal</th>
									</tr>
								</thead>
								<tbody>
									{tracked.map((d) => {
										const v = teamValues.get(d.key);
										return (
											<tr key={d.key} className="border-t border-slate-200 dark:border-slate-700">
												<td className="px-4 py-1.5 text-slate-700 dark:text-slate-300">
													{d.name}
													{d.unit && <span className="text-2xs text-slate-600 dark:text-slate-400 ml-1">{d.unit}</span>}
													{d.calc_notes && <span className="block text-2xs text-slate-600 dark:text-slate-400 truncate" title={d.calc_notes}>{d.calc_notes}</span>}
												</td>
												<td className="px-3 py-1.5 text-slate-500 truncate max-w-40" title={d.sheet_source_of_truth ?? ''}>{d.sheet_source_of_truth ?? d.source.replace(/_/g, ' ')}</td>
												<td className="px-3 py-1.5 text-right">
													{isManager ? (
														<input name={`value:${d.key}`} defaultValue={v?.value ?? ''} inputMode="decimal" className={`${inputClass} text-right tabular-nums`} />
													) : (
														<span className="tabular-nums">{v?.value ?? '—'}</span>
													)}
												</td>
												<td className="px-3 py-1.5 text-right">
													{isManager ? (
														<input name={`goal:${d.key}`} defaultValue={v?.goal ?? ''} inputMode="decimal" className={`${inputClass} text-right tabular-nums`} />
													) : (
														<span className="tabular-nums text-slate-500">{v?.goal ?? '—'}</span>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
							</div>
							{isManager && (
								<div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end">
									<button type="submit" className="rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2">
										Save {deptLabelOf(trackedDept)} · {monthLabel}
									</button>
								</div>
							)}
						</form>
					)}
				</Card>
			</div>
		</>
	);
}
