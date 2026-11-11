// /team/vantage-point — Vantage Point (0118).
//
// Reads the exec round (the official score) of every cycle, past and present.
// ?quarter= picks a cycle (default: the latest with any exec round, else the
// open one). Three tabs:
//   rankings    everyone sorted by exec total, with self + leader beside it;
//   grid        Results (Performance group) x Behaviors (Core Pillars) with
//               Alex's six outcomes; the suggested one next to the one exec
//               chose;
//   compare     each person's totals and group subtotals across quarters
//               (starts at the first scorecard cycle; an import of the older
//               Google Form can add rows with model = 'import' later).
// Pre-0118 cycles (model = 'ninebox') render their pair in Rankings and skip
// the grid, which needs group subtotals.
// Everyone sees everyone once a round is submitted (0118 visibility).

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Chip from '@/components/ui/FilterChipLink';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { departmentOf, departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { assessable, isInternalStaff, loadCalibrationPeople, type CalibrationPerson } from '@/lib/calibration/people';
import NotStaffCard from '@/components/calibration/NotStaffCard';
import { groupBySubject, loadCycles, loadScores, type Cycle, type Quarter } from '@/lib/calibration/server';
import {
	GROUP_LABELS,
	GROUP_MAX,
	IMPORT_PILLARS,
	IMPORT_PILLAR_LABELS,
	OUTCOME_META,
	OUTCOMES,
	fmtTotal,
	gridCell,
	suggestOutcome,
	type Outcome,
	type ScoreRow,
} from '@/lib/calibration/shared';
import { quarterLabel } from '@/lib/work/timeframe';

export const metadata = { title: 'Vantage Point' };
export const dynamic = 'force-dynamic';

const TABS = ['rankings', 'grid', 'compare'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { rankings: 'Rankings', grid: 'Grid', compare: 'Quarterly comparisons' };

const nameOf = (p: Pick<CalibrationPerson, 'first_name' | 'last_name'> | null | undefined) =>
	p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed' : 'Unknown';

/** Rank order for an imported row: the form's overall label, Poor .. Epic. */
const IMPORT_SCALE = ['Poor', 'Needs Improvement', 'Below Average', 'Average', 'Above Average', 'Excellent', 'Epic'];
function importRank(s: ScoreRow): number | null {
	if (s.model !== 'import') return null;
	const i = IMPORT_SCALE.indexOf(s.import_payload?.overall ?? '');
	return i < 0 ? null : i;
}
function deftFilterSkip(e: { dept: string | null }, deptFilter: string | null): boolean {
	return !!deptFilter && e.dept !== deptFilter;
}

export default async function VantagePointPage({ searchParams }: { searchParams: Promise<{ quarter?: string; tab?: string; dept?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (!isInternalStaff(profile)) return <NotStaffCard />;
	const supabase = await createClient();
	const [{ cycles, quarters, error }, { people }, departmentTags] = await Promise.all([
		loadCycles(supabase),
		// inactive too: past quarters keep former staff by name
		loadCalibrationPeople(supabase, { includeInactive: true }),
		loadDepartments(supabase),
	]);

	const header = (desc: string) => (
		<PageHeader
			title="Vantage Point"
			description={desc}
			actions={
				<div className="flex items-center gap-3">
					<Link href="/team/calibration" className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">Calibration →</Link>
				</div>
			}
		/>
	);
	if (error) {
		return (
			<>
				{header('Rankings, the grid and quarter-over-quarter comparisons from the exec round.')}
				<Callout tone="warning">Vantage Point reads the calibration tables from migration <code>0085_calibration.sql</code>, which is not applied.</Callout>
			</>
		);
	}

	const qById = new Map<string, Quarter>(quarters.map((q) => [q.id, q]));
	const cycleQuarter = (c: Cycle) => qById.get(c.quarter_id);
	// oldest -> newest for the comparison columns
	const ordered = [...cycles].sort((a, b) => (cycleQuarter(a)?.starts_on ?? '').localeCompare(cycleQuarter(b)?.starts_on ?? ''));
	// The official score is the exec round. Imported history (the Leadership
	// 13 Week form, model = 'import') had no rounds; its one row per person
	// sits on 'leader' and counts as that quarter's official record.
	const [{ scores: execOnly, scorecardAvailable }, { scores: imported }] = await Promise.all([
		loadScores(supabase, { round: 'exec' }),
		loadScores(supabase, { round: 'leader' }),
	]);
	const allScores = execOnly.concat(imported.filter((s) => s.model === 'import'));
	// Excluded people and anyone outside internal staff never appear (0117/0118).
	const staff = new Set(assessable(people).map((p) => p.id));
	const excluded = new Set(people.filter((p) => !staff.has(p.id)).map((p) => p.id));
	const execRows = allScores.filter((s) => s.submitted_at && !excluded.has(s.subject_id));
	const cyclesWithExec = new Set(execRows.map((s) => s.cycle_id));
	const latestWith = [...ordered].reverse().find((c) => cyclesWithExec.has(c.id));
	const wanted = cycles.find((c) => c.id === sp.quarter) ?? latestWith ?? cycles.find((c) => c.status === 'open') ?? ordered[ordered.length - 1] ?? null;
	const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'rankings';
	const byId = new Map(people.map((p) => [p.id, p]));
	const deptLabels = departmentLabelById(departmentTags);
	const deptOf = (id: string) => { const p = byId.get(id); return p ? departmentOf(p, deptLabels) : null; };

	const href = (patch: { quarter?: string | null; tab?: Tab; dept?: string | null }) => {
		const usp = new URLSearchParams();
		const q = patch.quarter === undefined ? wanted?.id : patch.quarter;
		const t = patch.tab ?? tab;
		const d = patch.dept === undefined ? sp.dept : patch.dept;
		if (q) usp.set('quarter', q);
		if (t !== 'rankings') usp.set('tab', t);
		if (d) usp.set('dept', d);
		const s = usp.toString();
		return s ? `/team/vantage-point?${s}` : '/team/vantage-point';
	};

	if (!wanted) {
		return (
			<>
				{header('Rankings, the grid and quarter-over-quarter comparisons from the exec round.')}
				<Card><p className="text-sm text-slate-500 py-8 text-center">No calibration cycle yet. Vantage Point fills in once a cycle completes its exec round.</p></Card>
			</>
		);
	}

	// This cycle: all three rounds for the side-by-side, exec is the official one.
	const { scores: cycleScores } = await loadScores(supabase, { cycleId: wanted.id });
	const bySubject = groupBySubject(cycleScores.filter((s) => s.submitted_at && !excluded.has(s.subject_id)));
	const depts = [...new Set([...bySubject.keys()].map(deptOf).filter((d): d is string => !!d))].sort();
	const deptFilter = sp.dept && depts.includes(sp.dept) ? sp.dept : null;
	type Entry = { id: string; name: string; dept: string | null; self: ScoreRow | null; leader: ScoreRow | null; exec: ScoreRow | null };
	const entries: Entry[] = [...bySubject.entries()]
		.map(([id, rows]) => ({
			id,
			name: nameOf(byId.get(id)),
			dept: deptOf(id),
			self: rows.find((r) => r.round === 'self') ?? null,
			leader: rows.find((r) => r.round === 'leader' && r.model !== 'import') ?? null,
			exec: rows.find((r) => r.round === 'exec') ?? rows.find((r) => r.model === 'import') ?? null,
		}))
		.filter((e) => !deftFilterSkip(e, deptFilter));
	const ranked = entries
		.filter((e) => e.exec)
		.sort((a, b) => Number(b.exec!.total ?? importRank(b.exec!) ?? -1) - Number(a.exec!.total ?? importRank(a.exec!) ?? -1) || a.name.localeCompare(b.name));
	const inProgress = entries.filter((e) => !e.exec).sort((a, b) => a.name.localeCompare(b.name));

	// previous cycle's exec total per person (improvement signal)
	const idx = ordered.findIndex((c) => c.id === wanted.id);
	const prevCycle = idx > 0 ? ordered[idx - 1] : null;
	const prevTotal = new Map<string, number>();
	if (prevCycle) for (const s of execRows) if (s.cycle_id === prevCycle.id && s.total != null) prevTotal.set(s.subject_id, Number(s.total));

	const cycleLabel = (c: Cycle) => { const q = cycleQuarter(c); return q ? quarterLabel(q) : 'Quarter'; };
	const wantedLabel = cycleLabel(wanted);
	const isNinebox = ranked.length > 0 && ranked.every((e) => e.exec!.model === 'ninebox');
	const isImport = ranked.length > 0 && ranked.every((e) => e.exec!.model === 'import');
	const noGroups = isNinebox || isImport;

	const totalCell = (s: ScoreRow | null, strong = false) => {
		if (!s) return <span className="text-slate-300">—</span>;
		if (s.model === 'ninebox') return <span className="tabular-nums text-slate-700 dark:text-slate-300">{s.performance}/{s.potential}</span>;
		if (s.model === 'import') return <span className={strong ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}>{s.import_payload?.overall ?? '—'}</span>;
		return <span className={`tabular-nums ${strong ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>{fmtTotal(s.total)}</span>;
	};

	return (
		<>
			{header(`${wantedLabel} · ${ranked.length} scored by exec${inProgress.length ? ` · ${inProgress.length} in progress` : ''}`)}
			<div className="space-y-4">
				{!scorecardAvailable && <Callout tone="warning">Totals need migration <code>0118_calibration_scorecard.sql</code>, written but not applied; showing the earlier 1–3 pair.</Callout>}

				{/* quarter selector + tabs + dept filter */}
				<div className="flex flex-wrap items-center gap-2">
					{[...ordered].reverse().map((c) => (
						<Chip key={c.id} href={href({ quarter: c.id })} active={wanted.id === c.id} count={execRows.filter((r) => r.cycle_id === c.id).length}>
							{cycleLabel(c)}{c.status === 'open' ? ' · open' : ''}
						</Chip>
					))}
					{depts.length > 1 && (
						<>
							<span className="text-slate-300 mx-1">|</span>
							<Chip href={href({ dept: null })} active={!deptFilter}>All depts</Chip>
							{depts.map((d) => <Chip key={d} href={href({ dept: d })} active={deptFilter === d}>{d}</Chip>)}
						</>
					)}
				</div>
				<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
					{TABS.map((t) => (
						<Link
							key={t}
							href={href({ tab: t })}
							className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
						>
							{TAB_LABELS[t]}
						</Link>
					))}
				</div>

				{/* ----- rankings ----- */}
				{tab === 'rankings' && (
					<Card padding="none">
						{ranked.length === 0 ? (
							<p className="text-sm text-slate-500 py-8 text-center">No exec round submitted for {wantedLabel} yet.{inProgress.length ? ` ${inProgress.length} in progress.` : ''}</p>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-xs">
									<thead className="bg-slate-50/80 dark:bg-slate-900/30">
										<tr>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2 w-8">#</th>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Person</th>
											<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Dept</th>
											<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Exec</th>
											<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Self</th>
											<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Leader</th>
											{!noGroups && <>
												<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Core</th>
												<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Perf.</th>
												<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Prof.</th>
												<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Outcome</th>
											</>}
										</tr>
									</thead>
									<tbody>
										{ranked.map((e, i) => {
											const x = e.exec!;
											const chosen = x.outcome;
											const suggested = x.model === 'scorecard' && x.total != null
												? suggestOutcome({ performance_total: Number(x.performance_total ?? 0), core_total: Number(x.core_total ?? 0), total: Number(x.total), previous_total: prevTotal.get(e.id) ?? null })
												: null;
											return (
												<tr key={e.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
													<td className="px-4 py-1.5 tabular-nums text-slate-400">{i + 1}</td>
													<td className="px-3 py-1.5"><Link href={wanted.status === 'open' ? `/team/calibration/${e.id}` : `/team/${e.id}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600">{e.name}</Link></td>
													<td className="px-3 py-1.5 text-slate-500">{e.dept ?? '—'}</td>
													<td className="px-3 py-1.5 text-right">{totalCell(x, true)}</td>
													<td className="px-3 py-1.5 text-right">{totalCell(e.self)}</td>
													<td className="px-3 py-1.5 text-right">{totalCell(e.leader)}</td>
													{!noGroups && <>
														<td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtTotal(x.core_total)}</td>
														<td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtTotal(x.performance_total)}</td>
														<td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtTotal(x.professional_total)}</td>
														<td className="px-3 py-1.5">{(chosen ?? suggested) ? <Badge color={chosen ? 'primary' : 'default'}>{OUTCOME_META[(chosen ?? suggested) as Outcome].action}</Badge> : '—'}</td>
													</>}
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
						{inProgress.length > 0 && (
							<p className="px-4 py-2 text-2xs text-slate-500 border-t border-slate-200 dark:border-slate-700">In progress (no exec round yet): {inProgress.map((e) => e.name).join(', ')}</p>
						)}
					</Card>
				)}

				{/* ----- grid ----- */}
				{tab === 'grid' && (
					noGroups || ranked.length === 0 ? (
						<Card><p className="text-sm text-slate-500 py-8 text-center">{ranked.length === 0 ? `No exec round submitted for ${wantedLabel} yet.` : 'This quarter used an earlier model (the 1–3 pair or the Leadership 13 Week form); the grid needs the 100-point scorecard.'}</p></Card>
					) : (
						<GridTab ranked={ranked} prevTotal={prevTotal} wanted={wanted} />
					)
				)}

				{/* ----- compare ----- */}
				{tab === 'compare' && (
					<CompareTab ordered={ordered} execRows={execRows} byId={byId} cycleLabel={cycleLabel} deptFilter={deptFilter} deptOf={deptOf} />
				)}
			</div>
		</>
	);
}

// ----- grid --------------------------------------------------------------------------

function GridTab({ ranked, prevTotal, wanted }: { ranked: { id: string; name: string; dept: string | null; exec: ScoreRow | null }[]; prevTotal: Map<string, number>; wanted: Cycle }) {
	type Placed = { id: string; name: string; dept: string | null; total: number; results: 'strong' | 'weak'; behaviors: 'strong' | 'damaging' | 'mixed'; suggested: Outcome; chosen: Outcome | null };
	const placed: Placed[] = ranked
		.filter((e) => e.exec?.model === 'scorecard' && e.exec.total != null)
		.map((e) => {
			const x = e.exec!;
			const input = { performance_total: Number(x.performance_total ?? 0), core_total: Number(x.core_total ?? 0), total: Number(x.total), previous_total: prevTotal.get(e.id) ?? null };
			return { id: e.id, name: e.name, dept: e.dept, total: Number(x.total), ...gridCell(input), suggested: suggestOutcome(input), chosen: x.outcome };
		});
	const effective = (p: Placed) => p.chosen ?? p.suggested;
	const byOutcome = new Map<Outcome, Placed[]>();
	for (const p of placed) {
		const l = byOutcome.get(effective(p)) ?? [];
		l.push(p);
		byOutcome.set(effective(p), l);
	}
	const TONE: Record<Outcome, string> = {
		recognize: 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900',
		coach: 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900',
		develop: 'bg-primary-50/40 dark:bg-primary-950/20 border-primary-200 dark:border-primary-900',
		reassign: 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700',
		performance_decision: 'bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-900',
		repair_system: 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700',
	};
	const Cell = ({ o }: { o: Outcome }) => {
		const list = (byOutcome.get(o) ?? []).sort((a, b) => b.total - a.total);
		return (
			<div className={`border rounded-md p-2 min-h-28 ${TONE[o]}`}>
				<div className="flex items-start justify-between gap-2 mb-1">
					<div>
						<p className="text-2xs font-semibold text-slate-800 dark:text-slate-200">{OUTCOME_META[o].label}</p>
						<p className="text-2xs text-slate-600 dark:text-slate-400">→ {OUTCOME_META[o].action}</p>
					</div>
					<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{list.length}</span>
				</div>
				<ul className="space-y-0.5">
					{list.map((p) => (
						<li key={p.id} className="text-xs flex items-center gap-1.5 flex-wrap">
							<Link href={wanted.status === 'open' ? `/team/calibration/${p.id}` : `/team/${p.id}`} className="text-slate-800 dark:text-slate-200 hover:text-primary-600">{p.name}</Link>
							<span className="tabular-nums text-slate-500">{fmtTotal(p.total)}</span>
							{p.chosen && p.chosen !== p.suggested && (
								<span className="text-2xs text-slate-500 dark:text-slate-400" title={`Exec chose this; the scores suggested “${OUTCOME_META[p.suggested].label}”.`}>
									(exec call · suggested: {OUTCOME_META[p.suggested].action.split(' ')[0].toLowerCase()})
								</span>
							)}
						</li>
					))}
				</ul>
			</div>
		);
	};
	return (
		<div className="space-y-3">
			<Card>
				<p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
					<b>Results</b> = {GROUP_LABELS.performance} group (out of {GROUP_MAX.performance}); <b>Behaviors</b> = {GROUP_LABELS.core} (out of {GROUP_MAX.core}). Strong = 70% or more of the group; damaging = under 50%. Improvement = up 5+ points on the previous quarter. Placement is automatic from the exec total.
				</p>
				<div className="grid gap-2" style={{ gridTemplateColumns: '6rem repeat(2, minmax(0, 1fr))' }}>
					<div />
					<div className="text-center text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Strong behaviors</div>
					<div className="text-center text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Damaging / mixed behaviors</div>
					<div className="flex items-center justify-end pr-2 text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium text-right">Strong results</div>
					<Cell o="recognize" />
					<Cell o="coach" />
					<div className="flex items-center justify-end pr-2 text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium text-right">Weak results</div>
					<div className="col-span-2 grid grid-cols-2 xl:grid-cols-4 gap-2">
						<Cell o="develop" />
						<Cell o="reassign" />
						<Cell o="performance_decision" />
						<Cell o="repair_system" />
					</div>
				</div>
			</Card>
			<Card padding="none">
				<table className="w-full text-xs">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Person</th>
							<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Exec total</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Results</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Behaviors</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Suggested</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Exec chose</th>
						</tr>
					</thead>
					<tbody>
						{placed.sort((a, b) => b.total - a.total).map((p) => (
							<tr key={p.id} className="border-t border-slate-200 dark:border-slate-700">
								<td className="px-4 py-1.5 text-slate-900 dark:text-slate-100">{p.name}</td>
								<td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtTotal(p.total)}</td>
								<td className="px-3 py-1.5 capitalize text-slate-600 dark:text-slate-400">{p.results}</td>
								<td className="px-3 py-1.5 capitalize text-slate-600 dark:text-slate-400">{p.behaviors}</td>
								<td className="px-3 py-1.5 text-slate-600 dark:text-slate-400">{OUTCOME_META[p.suggested].action}</td>
								<td className="px-3 py-1.5">{p.chosen ? <Badge color={p.chosen === p.suggested ? 'default' : 'primary'}>{OUTCOME_META[p.chosen].action}</Badge> : <span className="text-slate-400">— (uses suggested)</span>}</td>
							</tr>
						))}
					</tbody>
				</table>
			</Card>
			<p className="text-2xs text-slate-500">Outcomes: {OUTCOMES.map((o) => OUTCOME_META[o].label).join(' · ')}.</p>
		</div>
	);
}

// ----- compare ------------------------------------------------------------------------

function CompareTab({
	ordered, execRows, byId, cycleLabel, deptFilter, deptOf,
}: {
	ordered: Cycle[];
	execRows: ScoreRow[];
	byId: Map<string, CalibrationPerson>;
	cycleLabel: (c: Cycle) => string;
	deptFilter: string | null;
	deptOf: (id: string) => string | null;
}) {
	// Cycles with an official record: a scorecard exec total, or imported
	// history (shown in its original Poor..Epic format, never converted).
	const hasRecord = (s: ScoreRow) => s.total != null || s.model === 'import';
	const cols = ordered.filter((c) => execRows.some((s) => s.cycle_id === c.id && hasRecord(s)));
	const kindOf = (c: Cycle): 'import' | 'scorecard' => (execRows.some((s) => s.cycle_id === c.id && s.model !== 'import' && s.total != null) ? 'scorecard' : 'import');
	const subjects = [...new Set(execRows.filter(hasRecord).map((s) => s.subject_id))]
		.filter((id) => !deptFilter || deptOf(id) === deptFilter)
		.map((id) => ({ id, name: nameOf(byId.get(id)) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const cell = (id: string, c: Cycle) => execRows.find((s) => s.subject_id === id && s.cycle_id === c.id && hasRecord(s)) ?? null;
	if (cols.length === 0) {
		return <Card><p className="text-sm text-slate-500 py-8 text-center">Comparisons start with the first 100-point cycle (26-4). Nothing to compare yet.</p></Card>;
	}
	const span = (c: Cycle) => (kindOf(c) === 'import' ? IMPORT_PILLARS.length + 1 : 4);
	return (
		<Card padding="none">
			<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2 sticky left-0 bg-slate-50/80 dark:bg-slate-900/30">Person</th>
							{cols.map((c) => (
								<th key={c.id} colSpan={span(c)} className="text-center font-medium text-slate-600 dark:text-slate-400 px-3 py-2 border-l border-slate-200 dark:border-slate-700">
									{cycleLabel(c)}{kindOf(c) === 'import' && <span className="block text-2xs font-normal text-slate-400">Leadership 13 Week form</span>}
								</th>
							))}
						</tr>
						<tr>
							<th className="sticky left-0 bg-slate-50/80 dark:bg-slate-900/30" />
							{cols.map((c) => (kindOf(c) === 'import' ? <ImportColHead key={c.id} /> : <ColHead key={c.id} />))}
						</tr>
					</thead>
					<tbody>
						{subjects.map((s) => (
							<tr key={s.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
								<td className="px-4 py-1.5 text-slate-900 dark:text-slate-100 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-800">{s.name}</td>
								{cols.map((c, i) => {
									const x = cell(s.id, c);
									if (kindOf(c) === 'import') return <ImportColCells key={c.id} x={x} />;
									const prev = i > 0 && kindOf(cols[i - 1]) === 'scorecard' ? cell(s.id, cols[i - 1]) : null;
									const delta = x && prev && prev.total != null ? Number(x.total) - Number(prev.total) : null;
									return <ColCells key={c.id} x={x} delta={delta} />;
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="px-4 py-2 text-2xs text-slate-500 border-t border-slate-200 dark:border-slate-700">
				100-point quarters show the exec total with the three group subtotals ({GROUP_LABELS.core} / {GROUP_LABELS.performance} / {GROUP_LABELS.professional}). Quarters scored on the Leadership 13 Week form show its seven pillars and overall exactly as rated (Poor → Epic); they are a different scale and are never converted. The 1–3 nine-box pair has no comparable total and is left out.
			</p>
		</Card>
	);
}

function ImportColHead() {
	return (
		<>
			{IMPORT_PILLARS.map((k, i) => (
				<th key={k} className={`text-center font-medium text-slate-600 dark:text-slate-400 px-1.5 py-1 ${i === 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''}`} title={IMPORT_PILLAR_LABELS[k]}>{IMPORT_PILLAR_LABELS[k].slice(0, 3)}</th>
			))}
			<th className="text-center font-medium text-slate-600 dark:text-slate-400 px-1.5 py-1">Overall</th>
		</>
	);
}

/** Poor..Epic as a short tag; bare numbers (the earliest responses) as-is. */
function shortLabel(v: string | null | undefined): string {
	if (!v) return '—';
	const map: Record<string, string> = { Poor: 'Poor', 'Needs Improvement': 'NI', 'Below Average': 'Bel', Average: 'Avg', 'Above Average': 'Abv', Excellent: 'Exc', Epic: 'Epic' };
	return map[v] ?? v;
}

function ImportColCells({ x }: { x: ScoreRow | null }) {
	const p = x?.import_payload;
	if (!x || !p) return <><td className="px-2 py-1.5 text-center text-slate-300 border-l border-slate-200 dark:border-slate-700" colSpan={IMPORT_PILLARS.length + 1}>—</td></>;
	const n = p.responses?.length ?? 1;
	return (
		<>
			{IMPORT_PILLARS.map((k, i) => (
				<td key={k} className={`px-1.5 py-1.5 text-center text-slate-600 dark:text-slate-400 whitespace-nowrap ${i === 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''}`} title={`${IMPORT_PILLAR_LABELS[k]}: ${p.pillars?.[k] ?? '—'}`}>{shortLabel(p.pillars?.[k])}</td>
			))}
			<td className="px-1.5 py-1.5 text-center font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap" title={`${p.overall ?? '—'} · by ${p.reviewer_email ?? '?'}${n > 1 ? ` · ${n} responses, latest shown` : ''}`}>
				{p.overall ?? '—'}{n > 1 && <span className="text-2xs text-slate-400"> ×{n}</span>}
			</td>
		</>
	);
}

function ColHead() {
	return (
		<>
			<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-1 border-l border-slate-200 dark:border-slate-700">Total</th>
			<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-1">Core</th>
			<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-1">Perf.</th>
			<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-1">Prof.</th>
		</>
	);
}

function ColCells({ x, delta }: { x: ScoreRow | null; delta: number | null }) {
	if (!x) return <><td className="px-2 py-1.5 text-right text-slate-300 border-l border-slate-200 dark:border-slate-700">—</td><td /><td /><td /></>;
	return (
		<>
			<td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100 border-l border-slate-200 dark:border-slate-700 whitespace-nowrap">
				{fmtTotal(x.total)}
				{delta != null && delta !== 0 && (
					<span className={`ml-1 text-2xs ${delta > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{delta > 0 ? '▲' : '▼'}{fmtTotal(Math.abs(delta))}</span>
				)}
			</td>
			<td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtTotal(x.core_total)}</td>
			<td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtTotal(x.performance_total)}</td>
			<td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-400">{fmtTotal(x.professional_total)}</td>
		</>
	);
}
