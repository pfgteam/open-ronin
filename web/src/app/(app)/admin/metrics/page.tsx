// /admin/metrics — the metric catalog manager (public.metric_definitions,
// migrations 0025 + 0028). Counting rules and metric sets are DATA, managed
// here — the Beacon lookup-table pattern — so a new metric or a rule change
// is a form, not a deploy. Values are entered/computed elsewhere
// (/team/metrics and, from M2 on, the capture connectors).
//
// 19/08/2026 (Alex): FLAT list — no grouping. One editor table with
// Department + Specialties columns and filters; metrics attach to specialties
// (0028/0030/0034) and entry happens on the profile page. Inline edit stays
// (?edit=key) now opens as a card over the screen (ModalCard), "New metric"
// stays a header button (?new=1).

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import ModalCard from '@/components/ui/ModalCard';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { METRIC_SOURCES, BONUS_TYPES } from '@/lib/people/constants';
import { Field, FormError, checkboxClass, inputClass, selectClass } from '../../team/_form';
import { createMetricDefinition, updateMetricDefinition, toggleMetricActive } from './actions';
import { METRIC_SURFACES, SURFACE_HINTS, SURFACE_LABELS, surfacesOf } from '@/lib/metrics/surfaces';

export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ error?: string; dept?: string; inactive?: string; edit?: string; new?: string; surface?: string }>;
}

interface Def {
	key: string;
	name: string;
	description: string | null;
	pap_positions: string[];
	department_tag_id: string | null;
	bonus_type: string | null;
	unit: string | null;
	source: string;
	requires_goal: boolean;
	is_active: boolean;
	sort: number;
	calc_notes?: string | null;
	surfaces?: string[] | null;
	sheet_definition?: string | null;
	sheet_source_of_truth?: string | null;
}

interface DeptTag {
	id: string;
	slug: string;
	label: string;
	color: string | null;
}

interface PositionRow {
	slug: string;
	label: string;
}

const BONUS_LABELS: Record<string, string> = {
	pay_per: 'Pay per',
	threshold_80_100: '80/100 ×10%',
	mom_pct: '% m/m',
	avg_time_tiered: 'Avg time tiered',
};

const UNASSIGNED = 'Unassigned';

/** Shared create/edit form body — positions are multi-select checkboxes. */
function MetricForm({ def, departments, positions }: { def?: Def; departments: DeptTag[]; positions: PositionRow[] }) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
			{def && <input type="hidden" name="key" value={def.key} />}
			<Field label="Name">
				<input name="name" defaultValue={def?.name ?? ''} placeholder="Number of Podcasts Live" className={inputClass} />
			</Field>
			<Field label="Unit">
				<input name="unit" defaultValue={def?.unit ?? ''} placeholder="#, %, per client…" className={inputClass} />
			</Field>
			<Field label="Source" hint="manual = typed monthly; others become read-only once the connector ships.">
				<select name="source" defaultValue={def?.source ?? 'manual'} className={selectClass}>
					{METRIC_SOURCES.map((s) => (
						<option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
					))}
				</select>
			</Field>
			<Field label="Department" hint="Groups the catalog. Managed in Admin → Departments & Sub-Teams (the canon).">
				<select name="department_tag_id" defaultValue={def?.department_tag_id ?? ''} className={selectClass}>
					<option value="">— None —</option>
					{departments.map((d) => (
						<option key={d.id} value={d.id}>{d.label}</option>
					))}
				</select>
			</Field>
			<Field label="Specialties" hint="A metric can belong to several specialties (e.g. Media Ops → Media + Publicist). Specialties are managed in Admin → Positions & Specialties. None = person-specific." wide>
				<div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
					{positions.map((p) => (
						<label key={p.slug} className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
							<input
								type="checkbox"
								name="pap_positions"
								value={p.slug}
								defaultChecked={def?.pap_positions?.includes(p.slug) ?? false}
								className={checkboxClass}
							/>
							{p.label}
						</label>
					))}
				</div>
			</Field>
			<Field label="Bonus type">
				<select name="bonus_type" defaultValue={def?.bonus_type ?? ''} className={selectClass}>
					<option value="">— None —</option>
					{BONUS_TYPES.map((b) => (
						<option key={b} value={b}>{BONUS_LABELS[b]}</option>
					))}
				</select>
			</Field>
			<div className="pt-6">
				<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
					<input type="checkbox" name="requires_goal" defaultChecked={def?.requires_goal ?? false} className={checkboxClass} />
					Person sets a monthly goal
				</label>
			</div>
			<Field label="How to count" wide>
				<textarea name="description" rows={2} defaultValue={def?.description ?? ''} placeholder="Exactly what counts toward this metric…" className={inputClass} />
			</Field>
			<Field label="How it is calculated" hint="Formula, rollup rule, target note. Free text today; the Inputs module (0077) turns ratios into real formulas." wide>
				<textarea name="calc_notes" rows={2} defaultValue={def?.calc_notes ?? ''} placeholder="e.g. Show rate = calls held / calls booked, per week" className={inputClass} />
			</Field>
			<Field label="Definition (CEO sheet)" hint="Verbatim from the CEO Metrics sheet when this metric mirrors one." wide>
				<textarea name="sheet_definition" rows={2} defaultValue={def?.sheet_definition ?? ''} className={inputClass} />
			</Field>
			<Field label="Source of truth" hint="Where the number comes from: system › tab, or the person who owns it.">
				<input name="sheet_source_of_truth" defaultValue={def?.sheet_source_of_truth ?? ''} placeholder="GHL › Reporting › Calls" className={inputClass} />
			</Field>
			<Field label="Surfaces on" hint="Beyond the profile grid. Unchecked = PAP/profile only." wide>
				<div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
					{METRIC_SURFACES.map((s) => (
						<label key={s} className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300" title={SURFACE_HINTS[s]}>
							<input type="checkbox" name="surfaces" value={s} defaultChecked={def ? surfacesOf(def).includes(s) : false} className={checkboxClass} />
							{SURFACE_LABELS[s]}
						</label>
					))}
				</div>
			</Field>
			<div className="flex items-end gap-2">
				<Button type="submit">{def ? 'Save changes' : 'Create metric'}</Button>
				<Link href="/admin/metrics">
					<Button variant="outline" type="button">Cancel</Button>
				</Link>
			</div>
		</div>
	);
}

export default async function AdminMetricsPage({ searchParams }: PageProps) {
	const { error, dept: deptFilter, inactive, edit: editKey, new: showNew, surface: surfaceFilter } = await searchParams;
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const canEdit = canManagePeople(ctx);

	const [{ data: defRows, error: defError }, { data: deptRows }, { data: posRows }] = await Promise.all([
		// `*` so the 0082 columns (surfaces, sheet_definition, sheet_source_of_truth)
		// ride along when applied and the read still works when they are not.
		supabase.from('metric_definitions').select('*').order('sort'),
		supabase
			.from('tags')
			.select('id, slug, label, color')
			.eq('category', 'department')
			.order('position'),
		supabase
			.from('pap_positions')
			.select('slug, label')
			.eq('is_active', true)
			.order('sort'),
	]);

	const allDefs = (defRows ?? []) as Def[];
	const departments = (deptRows ?? []) as DeptTag[];
	const positions = (posRows ?? []) as PositionRow[];
	const deptById = new Map(departments.map((d) => [d.id, d]));

	if (allDefs.length === 0) {
		return (
			<>
				<PageHeader title="Metrics Catalog" description="Metric definitions and counting rules" />
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						The metric catalog hasn&apos;t been set up yet. Ask Ops to finish enabling it.{' '}
						<code>0028_metric_positions.sql</code> in the Supabase SQL Editor.
					</p>
				</Card>
			</>
		);
	}

	const showInactive = inactive === '1';
	const deptLabel = (d: Def) =>
		(d.department_tag_id ? deptById.get(d.department_tag_id)?.label : null) ?? UNASSIGNED;
	const surfacesApplied = !defError && allDefs.some((d) => 'surfaces' in d);
	const surfaceKey = METRIC_SURFACES.find((s) => s === surfaceFilter) ?? null;
	const defs = allDefs
		.filter((d) => (showInactive ? true : d.is_active))
		.filter((d) => (deptFilter ? deptLabel(d) === deptFilter : true))
		.filter((d) => (surfaceKey ? surfacesOf(d).includes(surfaceKey) : true));

	// FLAT list (Alex, 19/08: "get rid of the grouping") — sorted by the
	// canon department order (/admin/tags position), then catalog sort.
	const deptOrder = [...departments.map((d) => d.label), UNASSIGNED];
	const flatDefs = [...defs].sort((a, b) => {
		const byDept = deptOrder.indexOf(deptLabel(a)) - deptOrder.indexOf(deptLabel(b));
		return byDept !== 0 ? byDept : a.sort - b.sort;
	});
	const deptColor = new Map(departments.map((d) => [d.label, d.color]));
	const deptOptions = [...new Set(allDefs.map((d) => deptLabel(d)))].sort(
		(a, b) => deptOrder.indexOf(a) - deptOrder.indexOf(b),
	);
	const inactiveCount = allDefs.filter((d) => !d.is_active).length;
	const editDef = editKey ? allDefs.find((d) => d.key === editKey) : undefined;

	return (
		<>
			<PageHeader
				title="Metrics Catalog"
				description={`${allDefs.length} definitions · rules are data, not code — seeded from the Individual Performance Metrics sheet`}
				actions={
					canEdit ? (
						<Link href="/admin/metrics?new=1">
							<Button>
								<Plus className="w-3.5 h-3.5" /> New metric
							</Button>
						</Link>
					) : undefined
				}
			/>

			<div className="space-y-4">
				<FormError message={error} />
				{!surfacesApplied && (
					<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">
							Migration 0082 (metric surfaces + calculation/source columns) is not applied yet. Edits save
							everything except <em>Surfaces on</em>, <em>Definition (CEO sheet)</em> and{' '}
							<em>Source of truth</em>; the KPIs and Team → Metrics pages read those tags once it is.
						</p>
					</Card>
				)}

				{/* Create / edit form — a card over the screen (Sam, 19/08) */}
				{canEdit && (showNew === '1' || editDef) && (
					<ModalCard
						title={editDef ? `Edit metric · ${editDef.name}` : 'New metric'}
						subtitle={editDef ? `Stable key: ${editDef.key} — renames change the label only.` : 'Counting rules are data: a new metric is a form, not a deploy.'}
						closeHref="/admin/metrics"
						maxWidth="max-w-3xl"
					>
						<form action={editDef ? updateMetricDefinition : createMetricDefinition}>
							<MetricForm def={editDef} departments={departments} positions={positions} />
						</form>
					</ModalCard>
				)}

				{/* Filters (GET form) */}
				<Card>
					<form method="get" className="flex items-end gap-3 flex-wrap">
						<Field label="Department">
							<select name="dept" defaultValue={deptFilter ?? ''} className={selectClass}>
								<option value="">All</option>
								{deptOptions.map((p) => (
									<option key={p} value={p}>{p}</option>
								))}
							</select>
						</Field>
						<Field label="Surfaces on">
							<select name="surface" defaultValue={surfaceKey ?? ''} className={selectClass}>
								<option value="">Any</option>
								{METRIC_SURFACES.map((s) => (
									<option key={s} value={s}>{SURFACE_LABELS[s]}</option>
								))}
							</select>
						</Field>
						<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 pb-2">
							<input
								type="checkbox"
								name="inactive"
								value="1"
								defaultChecked={showInactive}
								className={checkboxClass}
							/>
							Show inactive ({inactiveCount})
						</label>
						<Button type="submit" variant="outline">Filter</Button>
					</form>
				</Card>

				{/* Flat editor table — no grouping (Alex, 19/08) */}
				<Card padding="none">
					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Metric</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-32">Department</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-36">Specialties</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-16">Unit</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-28">Bonus</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-28">Source</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-24">Surfaces</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-14">Goal?</th>
								{canEdit && <th className="w-32" />}
							</tr>
						</thead>
						<tbody>
							{flatDefs.map((d) => {
								const dept = deptLabel(d);
								return (
									<tr key={d.key} className={`border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors ${d.is_active ? '' : 'opacity-50'}`}>
										<td className="px-3 py-2 align-top">
											<div className="text-slate-900 dark:text-slate-100 font-medium">{d.name}</div>
											{d.description && (
												<div className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2" title={d.description}>{d.description}</div>
											)}
										</td>
										<td className="px-3 py-2 align-top">
											<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-300">
												{deptColor.get(dept) && (
													<span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: deptColor.get(dept)! }} />
												)}
												{dept}
											</span>
										</td>
										<td className="px-3 py-2 align-top text-2xs text-slate-600 dark:text-slate-400">
											{d.pap_positions.length > 0 ? d.pap_positions.join(' · ') : '—'}
										</td>
										<td className="px-3 py-2 align-top text-2xs text-slate-600 dark:text-slate-400">{d.unit ?? '—'}</td>
										<td className="px-3 py-2 align-top text-2xs text-slate-600 dark:text-slate-400">
											{d.bonus_type ? (BONUS_LABELS[d.bonus_type] ?? d.bonus_type) : '—'}
										</td>
										<td className="px-3 py-2 align-top">
											<Badge color={d.source === 'manual' ? 'default' : 'accent'}>{d.source.replace(/_/g, ' ')}</Badge>
											{d.sheet_source_of_truth && (
												<div className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 truncate max-w-32" title={d.sheet_source_of_truth}>{d.sheet_source_of_truth}</div>
											)}
										</td>
										<td className="px-3 py-2 align-top text-2xs">
											{surfacesOf(d).length > 0 ? (
												<span className="flex flex-wrap gap-1">
													{surfacesOf(d).map((s) => (
														<Badge key={s} color="primary">{s === 'kpis' ? 'KPIs' : 'Team'}</Badge>
													))}
												</span>
											) : (
												<span className="text-slate-300">—</span>
											)}
										</td>
										<td className="px-3 py-2 align-top text-2xs">
											{d.requires_goal ? <Badge color="warning">goal</Badge> : <span className="text-slate-300">—</span>}
										</td>
										{canEdit && (
											<td className="px-3 py-2 align-top text-right whitespace-nowrap">
												<Link
													href={`/admin/metrics?edit=${encodeURIComponent(d.key)}`}
													className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline transition-colors mr-3"
												>
													Edit
												</Link>
												<form action={toggleMetricActive} className="inline">
													<input type="hidden" name="key" value={d.key} />
													<button
														type="submit"
														className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline transition-colors"
													>
														{d.is_active ? 'Deactivate' : 'Reactivate'}
													</button>
												</form>
											</td>
										)}
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				</Card>
			</div>
		</>
	);
}
