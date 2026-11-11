// /admin/calibration — Admin -> Calibration (0118).
//
//   - open / close the cycle (one open at a time, 0117 index);
//   - status board for everyone once a cycle is open: not started / waiting
//     on leader / waiting on exec / complete;
//   - link to the questions, rubric and weights editor;
//   - score distribution by leader: a histogram of the totals each leader
//     gave, flagged when skewed in either direction or too narrow;
//   - exec reconciler list (who scores the exec round);
//   - notify-all when a cycle opens (bell, 0039);
//   - "Notes for next quarter": the admin planning scratchpad (0119).

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Bell, Lock, Trash2 } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { departmentOf, departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { assessable, loadCalibrationPeople, type CalibrationPerson } from '@/lib/calibration/people';
import { groupBySubject, loadCalibrationNote, loadCycles, loadExecIds, loadScores } from '@/lib/calibration/server';
import NotesPanel from '@/components/calibration/NotesPanel';
import { assessedQuarterFor, distribution, fmtTotal, nextRound, STATUS_LABELS, type Round } from '@/lib/calibration/shared';
import { quarterLabel } from '@/lib/work/timeframe';
import { selectClass } from '../../team/_form';
import { addExecReconciler, notifyCalibrationOpen, openCalibrationCycle, removeExecReconciler, setCalibrationCycleStatus, setCalibrationExcluded } from './actions';

export const metadata = { title: 'Calibration · Admin' };
export const dynamic = 'force-dynamic';

const nameOf = (p: Pick<CalibrationPerson, 'first_name' | 'last_name'> | null | undefined) =>
	p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed' : 'Unknown';

const FLAG_LABELS = {
	skewed_high: 'Scores high',
	skewed_low: 'Scores low',
	narrow: 'Too little spread',
} as const;

export default async function AdminCalibrationPage({ searchParams }: { searchParams: Promise<{ error?: string; notified?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (profile.role !== 'admin' && profile.role !== 'exec') {
		return (
			<Card>
				<div className="text-center py-12 text-slate-500">
					<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
					<p className="text-sm">Calibration settings are managed by admin accounts.</p>
				</div>
			</Card>
		);
	}
	const supabase = await createClient();
	const [{ cycles, quarters, error }, execIds, { people: allPeople }, departmentTags, { note, available: notesAvailable }] = await Promise.all([
		loadCycles(supabase),
		loadExecIds(supabase),
		loadCalibrationPeople(supabase),
		loadDepartments(supabase),
		loadCalibrationNote(supabase),
	]);
	const qById = new Map(quarters.map((q) => [q.id, q]));
	const cycle = cycles.find((c) => c.status === 'open') ?? null;
	const cycleLabel = (c: { quarter_id: string }) => { const q = qById.get(c.quarter_id); return q ? quarterLabel(q) : 'Quarter'; };
	// "Open cycle" offers every quarter without a cycle (newest first) and
	// defaults to the one that just ENDED: calibration looks back, so the cycle
	// quarter is not the calendar quarter, and `quarters.is_current` (stale in
	// prod) is never consulted.
	const openable = quarters.filter((q) => !cycles.some((c) => c.quarter_id === q.id));
	const assessed = assessedQuarterFor(quarters);
	const defaultQuarterId = (assessed && openable.some((q) => q.id === assessed.id) ? assessed : openable[0])?.id ?? '';
	const byId = new Map(allPeople.map((p) => [p.id, p]));
	const roster = assessable(allPeople);
	const deptLabels = departmentLabelById(departmentTags);

	const { scores, scorecardAvailable } = cycle ? await loadScores(supabase, { cycleId: cycle.id }) : { scores: [], scorecardAvailable: true };
	const bySubject = groupBySubject(scores);
	const counts: Record<Round | 'done', number> = { self: 0, leader: 0, exec: 0, done: 0 };
	const statusOf = new Map<string, Round | 'done'>();
	for (const p of roster) {
		const s = nextRound(bySubject.get(p.id) ?? []);
		statusOf.set(p.id, s);
		counts[s] += 1;
	}

	// Distribution by leader: the submitted leader-round totals, grouped by scorer.
	const leaderTotals = new Map<string, number[]>();
	for (const s of scores) {
		if (s.round !== 'leader' || !s.submitted_at || s.total == null) continue;
		const l = leaderTotals.get(s.scorer_id) ?? [];
		l.push(Number(s.total));
		leaderTotals.set(s.scorer_id, l);
	}
	const allLeaderTotals = [...leaderTotals.values()].flat();
	const companyMean = allLeaderTotals.length ? allLeaderTotals.reduce((a, b) => a + b, 0) / allLeaderTotals.length : 0;
	const leaders = [...leaderTotals.entries()]
		.map(([id, totals]) => ({ id, name: nameOf(byId.get(id)), dist: distribution(totals, companyMean) }))
		.sort((a, b) => a.name.localeCompare(b.name));

	const execPeople = allPeople.filter((p) => execIds.has(p.id));

	return (
		<>
			<PageHeader
				title="Calibration"
				description="Cycle, status board, questions and weights, score distribution, exec reconcilers."
				actions={
					<div className="flex items-center gap-3">
						<Link href="/admin/calibration/questions" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Questions, rubric &amp; weights →</Link>
						<Link href="/team/vantage-point" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Vantage Point →</Link>
					</div>
				}
			/>
			<div className="space-y-4">
				{sp.error && <Callout tone="error">{sp.error}</Callout>}
				{sp.notified && !sp.error && <Callout tone="success">Notified {sp.notified} people.</Callout>}
				{error && <Callout tone="warning">Calibration isn&apos;t switched on yet (0085 not applied).</Callout>}
				{!scorecardAvailable && <Callout tone="warning">The scorecard needs migration <code>0118_calibration_scorecard.sql</code>, written but not applied. Opening a cycle now would not snapshot the questions.</Callout>}

				{/* cycle controls */}
				<Card>
					<div className="flex flex-wrap items-end gap-3">
						{cycle ? (
							<>
								<div>
									<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1">Open cycle</p>
									<p className="text-sm text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">{cycleLabel(cycle)} <Badge color="success">open</Badge> <span className="text-2xs text-slate-500">since {new Date(cycle.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></p>
								</div>
								<form action={notifyCalibrationOpen} className="ml-auto">
									<input type="hidden" name="cycle_id" value={cycle.id} />
									<Button type="submit" variant="outline" size="sm"><Bell className="w-3.5 h-3.5" /> Notify everyone</Button>
								</form>
								<form action={setCalibrationCycleStatus}>
									<input type="hidden" name="id" value={cycle.id} />
									<input type="hidden" name="status" value="closed" />
									<Button type="submit" variant="secondary" size="sm">Close cycle</Button>
								</form>
							</>
						) : (
							<form action={openCalibrationCycle} className="flex items-end gap-2">
								<div>
									<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1">Open a cycle for</p>
									<select name="quarter_id" className={selectClass} defaultValue={defaultQuarterId}>
										{openable.map((q) => (
											<option key={q.id} value={q.id}>{quarterLabel(q)}{assessed?.id === q.id ? ' (just ended)' : ''}</option>
										))}
									</select>
								</div>
								<Button type="submit" size="sm">Open cycle</Button>
								<span className="text-2xs text-slate-600 dark:text-slate-400">A cycle assesses the quarter that just ended (the default); pick another to override. Opening copies the current questions and weights into the cycle.</span>
							</form>
						)}
					</div>
					{cycles.filter((c) => c.status === 'closed').length > 0 && (
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-3">
							Past cycles: {cycles.filter((c) => c.status === 'closed').map((c) => cycleLabel(c)).join(', ')} — read them in Vantage Point.
							{!cycle && ' Reopen the latest one from its row below if it was closed by mistake.'}
						</p>
					)}
					{!cycle && cycles[0]?.status === 'closed' && (
						<form action={setCalibrationCycleStatus} className="mt-2">
							<input type="hidden" name="id" value={cycles[0].id} />
							<input type="hidden" name="status" value="open" />
							<button type="submit" className="text-xs text-slate-500 hover:text-primary-600 underline-offset-2 hover:underline">Reopen {cycleLabel(cycles[0])}</button>
						</form>
					)}
				</Card>

				{/* planning notes (0119) */}
				<NotesPanel
					noteKey="next_quarter"
					body={note?.body_md ?? ''}
					updatedAt={note?.updated_at ?? null}
					updatedByName={note?.updated_by_name ?? null}
					available={notesAvailable}
				/>

				{/* status board */}
				{cycle && (
					<Card padding="none">
						<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Status board · {cycleLabel(cycle)}</h2>
							<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto tabular-nums">
								{counts.self} not started · {counts.leader} waiting on leader · {counts.exec} waiting on exec · {counts.done} complete
							</span>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-xs">
								<thead className="bg-slate-50/80 dark:bg-slate-900/30">
									<tr>
										<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Person</th>
										<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Dept</th>
										<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Leader</th>
										<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Self</th>
										<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Leader</th>
										<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Exec</th>
										<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
										<th className="w-16" />
									</tr>
								</thead>
								<tbody>
									{roster.map((p) => {
										const rows = bySubject.get(p.id) ?? [];
										const st = statusOf.get(p.id) ?? 'self';
										const cell = (r: Round) => {
											const s = rows.find((x) => x.round === r);
											if (s?.submitted_at) return <span className="tabular-nums text-slate-900 dark:text-slate-100">{s.model === 'ninebox' ? `${s.performance}/${s.potential}` : fmtTotal(s.total)}</span>;
											if (s) return <span className="text-slate-400">draft</span>;
											return <span className="text-slate-300">—</span>;
										};
										return (
											<tr key={p.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
												<td className="px-4 py-1.5 text-slate-900 dark:text-slate-100">{nameOf(p)}</td>
												<td className="px-3 py-1.5 text-slate-500">{departmentOf(p, deptLabels) ?? '—'}</td>
												<td className="px-3 py-1.5 text-slate-500">{p.manager_id ? nameOf(byId.get(p.manager_id)) : <span className="text-amber-600 dark:text-amber-400">not set</span>}</td>
												<td className="px-3 py-1.5 text-right">{cell('self')}</td>
												<td className="px-3 py-1.5 text-right">{cell('leader')}</td>
												<td className="px-3 py-1.5 text-right">{cell('exec')}</td>
												<td className="px-3 py-1.5">
													<Badge color={st === 'done' ? 'success' : st === 'exec' ? 'primary' : st === 'leader' ? 'warning' : 'default'}>{STATUS_LABELS[st]}</Badge>
												</td>
												<td className="px-3 py-1.5 text-right">
													<Link href={`/team/calibration/${p.id}`} className="text-2xs text-primary-600 hover:underline">open</Link>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</Card>
				)}

				{/* distribution by leader */}
				{cycle && (
					<Card>
						<div className="flex items-center justify-between gap-2 flex-wrap mb-3">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Score distribution by leader</h2>
							<span className="text-2xs text-slate-600 dark:text-slate-400">
								Leader-round totals. {allLeaderTotals.length ? `Company average ${fmtTotal(Math.round(companyMean * 10) / 10)} across ${allLeaderTotals.length}.` : 'Fills in as leaders submit.'} A healthy team is roughly bell-shaped around the average.
							</span>
						</div>
						{leaders.length === 0 ? (
							<p className="text-sm text-slate-500 py-4 text-center">No leader rounds submitted yet.</p>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
								{leaders.map((l) => {
									const max = Math.max(1, ...l.dist.histogram);
									return (
										<div key={l.id} className={`rounded-md border p-3 ${l.dist.flags.length ? 'border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
											<div className="flex items-center justify-between gap-2 flex-wrap mb-2">
												<p className="text-sm font-medium text-slate-900 dark:text-slate-100">{l.name}</p>
												<p className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{l.dist.n} scored · avg {l.dist.mean} · spread ±{l.dist.sd}</p>
											</div>
											<div className="flex items-end gap-0.5 h-16" aria-label={`Histogram of totals given by ${l.name}`}>
												{l.dist.histogram.map((n, i) => (
													<div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${n}`}>
														<div className={`w-full rounded-t-sm ${n ? 'bg-primary-400 dark:bg-primary-600' : 'bg-slate-100 dark:bg-slate-700'}`} style={{ height: `${n ? Math.max(8, (n / max) * 100) : 4}%` }} />
													</div>
												))}
											</div>
											<div className="flex justify-between text-2xs text-slate-400 mt-0.5"><span>0</span><span>50</span><span>100</span></div>
											{l.dist.flags.length > 0 && (
												<div className="flex gap-1 flex-wrap mt-2">
													{l.dist.flags.map((f) => <Badge key={f} color="warning">{FLAG_LABELS[f]}</Badge>)}
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</Card>
				)}

				{/* exclude list */}
				<Card>
					<div className="flex items-center justify-between gap-2 flex-wrap mb-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Excluded from calibration</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">Active in the org chart, never assessed. They never appear in forms, review lists, the status board, rankings, the grid or distributions.</span>
					</div>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
						{allPeople.filter((p) => p.calibration_excluded).map((p) => (
							<li key={p.id} className="py-1.5 flex items-center gap-3 text-sm">
								<span className="flex-1 text-slate-900 dark:text-slate-100">{nameOf(p)} <span className="text-2xs text-slate-500">{p.email}</span></span>
								<form action={setCalibrationExcluded}>
									<input type="hidden" name="user_id" value={p.id} />
									<input type="hidden" name="excluded" value="0" />
									<button type="submit" className="text-slate-400 hover:text-red-600" title="Remove from the exclude list" aria-label={`Include ${nameOf(p)} again`}><Trash2 className="w-3.5 h-3.5" /></button>
								</form>
							</li>
						))}
						{allPeople.every((p) => !p.calibration_excluded) && <li className="py-1.5 text-sm text-slate-500">Nobody is excluded.</li>}
					</ul>
					<form action={setCalibrationExcluded} className="flex items-end gap-2">
						<input type="hidden" name="excluded" value="1" />
						<select name="user_id" className={selectClass} defaultValue="">
							<option value="" disabled>Exclude a person…</option>
							{allPeople.filter((p) => !p.calibration_excluded).map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
						</select>
						<Button type="submit" variant="outline" size="sm">Exclude</Button>
					</form>
				</Card>

				{/* exec reconcilers */}
				<Card>
					<div className="flex items-center justify-between gap-2 flex-wrap mb-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Exec round · who scores it</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">They score together; any one of them can submit. Admins always can.</span>
					</div>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
						{execPeople.map((p) => (
							<li key={p.id} className="py-1.5 flex items-center gap-3 text-sm">
								<span className="flex-1 text-slate-900 dark:text-slate-100">{nameOf(p)}</span>
								<form action={removeExecReconciler}>
									<input type="hidden" name="user_id" value={p.id} />
									<button type="submit" className="text-slate-400 hover:text-red-600" title="Remove" aria-label={`Remove ${nameOf(p)}`}><Trash2 className="w-3.5 h-3.5" /></button>
								</form>
							</li>
						))}
						{execPeople.length === 0 && <li className="py-1.5 text-sm text-slate-500">Nobody yet — admins can still score the exec round.</li>}
					</ul>
					<form action={addExecReconciler} className="flex items-end gap-2">
						<select name="user_id" className={selectClass} defaultValue="">
							<option value="" disabled>Add a person…</option>
							{allPeople.filter((p) => !execIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
						</select>
						<Button type="submit" variant="outline" size="sm">Add</Button>
					</form>
				</Card>
			</div>
		</>
	);
}
