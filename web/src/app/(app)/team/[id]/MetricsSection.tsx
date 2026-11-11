// Individual Metrics — embedded in the PROFILE page (Alex, 18/08: "or just
// in their profiles, no need for a second screen"). Replaces the standalone
// /team/metrics screen: monthly Goal/Achieved entry against the person's
// metric set, saved via saveMonthlyMetrics (same action, same RLS).
//
// Visibility mirrors metrics RLS (can_view_profile_docs): the person, their
// direct manager, people-managers, exec/admin. Writing: the person (manual
// rows) + people-managers — a direct manager sees read-only.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { BarChart3, SlidersHorizontal } from 'lucide-react';
import { checkboxClass, inputClass, selectClass } from '../_form';
import ModalCard from '@/components/ui/ModalCard';
import { resolveMetricRows, specialtyFingerprint, type MetricOverride } from '@/lib/people/metricRows';
import { saveMonthlyMetrics, saveMetricSet } from '../metrics/actions';
import Callout from '@/components/ui/Callout';

interface MetricDef {
	key: string;
	name: string;
	description: string | null;
	pap_positions: string[];
	unit: string | null;
	requires_goal: boolean;
	source: string;
	sort: number;
}

interface MetricRow {
	metric_key: string;
	value: number | null;
	goal: number | null;
	source: string;
}

function monthStart(ym: string): string {
	return `${ym}-01`;
}

export default async function MetricsSection({
	subjectId,
	subjectName,
	papPosition,
	ym,
	defs,
	values,
	overrides,
	overrideLoadFailed,
	canEnter,
	isManagerViewer,
	saved,
	error,
	editingSet,
	setSaved,
}: {
	subjectId: string;
	subjectName: string;
	papPosition: string | null;
	/** Resolved month (YYYY-MM). The PAGE resolves it, because the profile
	 *  header's metrics cell reads the same `?month` and the two must not
	 *  default differently at a month boundary. */
	ym: string;
	/** Hoisted reads — the profile page issues these three queries for its
	 *  header strip and hands them down, so the strip and this table are the
	 *  same rows rather than two reads that can disagree. */
	defs: MetricDef[];
	values: MetricRow[];
	overrides: MetricOverride[];
	/** True when the overrides read FAILED (not when it was merely empty): a
	 *  failure must not look like "this person has no custom metrics". */
	overrideLoadFailed: boolean;
	canEnter: boolean;
	isManagerViewer: boolean;
	saved?: string;
	error?: string;
	/** ?metricsSet=1 — opens the "which metrics" picker over the page. */
	editingSet?: boolean;
	setSaved?: boolean;
}) {
	const period = monthStart(ym);

	// A manual row and a computed row coexist for the same metric+month — the
	// unique index from 0025 includes `source`. Keying one Map by metric_key
	// would silently drop one of them, so they are kept apart.
	const manualByKey = new Map(values.filter((v) => v.source !== 'the_work').map((v) => [v.metric_key, v]));
	const computedByKey = new Map(values.filter((v) => v.source === 'the_work').map((v) => [v.metric_key, v]));

	// Rows = the specialty's set, plus/minus the per-person deltas. The rule
	// itself lives in @/lib/people/metricRows so it can be unit-tested; this
	// component only feeds it — with the SAME inputs the header strip fed it,
	// so "N of M filled" up there and this table always list the same metrics.
	const resolved = resolveMetricRows({
		defs,
		papPosition,
		overrides,
		// Manual rows only: "don't hide a number someone reported" protects
		// human entries. Computed rows land every month for everyone with work,
		// so counting them would make a `remove` permanently ineffective on any
		// the_work metric.
		keysWithValues: values
			.filter((v) => v.source !== 'the_work' && (v.value != null || v.goal != null))
			.map((v) => v.metric_key),
	});
	const rows = resolved.map((r) => r.def);
	const flagByKey = new Map(resolved.map((r) => [r.def.key, r]));
	const grantedCount = resolved.filter((r) => r.granted).length;
	const withheldCount = overrides.filter((o) => o.mode === 'remove').length;

	// Picker order: what the person answers for TODAY first, then the rest of
	// the catalog. 110 metrics in catalog order buries the 10 that matter.
	const appliesNow = new Set(rows.map((r) => r.key));
	const pickerDefs = [
		...defs.filter((d) => appliesNow.has(d.key)),
		...defs.filter((d) => !appliesNow.has(d.key)),
	];

	// The computed column only earns its width when one of THESE rows is
	// computed — a specialty with no the_work metric would otherwise get a
	// column of dashes, and so would every profile before 0049 is applied.
	const hasComputed = rows.some((d) => d.source === 'the_work');

	// Month options: Apr/2026 (sheet start) through next month.
	const months: string[] = [];
	const start = new Date(Date.UTC(2026, 3, 1));
	const end = new Date();
	end.setUTCMonth(end.getUTCMonth() + 1);
	for (let d = start; d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
		months.push(d.toISOString().slice(0, 7));
	}
	const monthLabel = new Date(`${period}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});

	const saveAction = async (formData: FormData): Promise<void> => {
		'use server';
		await saveMonthlyMetrics(subjectId, period, formData);
	};

	const saveSetAction = async (formData: FormData): Promise<void> => {
		'use server';
		await saveMetricSet(subjectId, period, formData);
	};

	const backHref = `/team/${subjectId}?tab=metrics&month=${ym}`;

	return (
		<Card padding="none" id="metrics">
			<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
				<BarChart3 className="w-3.5 h-3.5 text-slate-400" />
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Individual Metrics</h2>
				{papPosition && <Badge color="primary">{papPosition}</Badge>}
				{(grantedCount > 0 || withheldCount > 0) && (
					<Badge color="warning">
						{[
							grantedCount > 0 ? `+${grantedCount}` : null,
							withheldCount > 0 ? `−${withheldCount}` : null,
						]
							.filter(Boolean)
							.join(' ')}{' '}
						vs {papPosition ?? 'catalog'}
					</Badge>
				)}
				{/* Month picker — a GET back to this profile. The hidden `tab` is
				    load-bearing: without it the form would drop ?tab=metrics and
				    submit you to the Overview tab. */}
				<form method="get" action={`/team/${subjectId}`} className="ml-auto flex items-center gap-2">
					<input type="hidden" name="tab" value="metrics" />
					<select name="month" defaultValue={ym} aria-label="Metrics month" className={`${selectClass} !w-40 text-xs`}>
						{months.map((m) => (
							<option key={m} value={m}>
								{new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
							</option>
						))}
					</select>
					<Button type="submit" variant="outline">Open</Button>
				</form>
				{isManagerViewer && (
					<Link
						href={`/team/${subjectId}?tab=metrics&month=${ym}&metricsSet=1`}
						className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
						title="Choose which metrics this person answers for"
					>
						<SlidersHorizontal className="w-3.5 h-3.5" />
						Which metrics
					</Link>
				)}
			</div>

			{editingSet && isManagerViewer && (
				<ModalCard
					title="Which metrics does this person answer for?"
					subtitle={`${subjectName} · specialty ${papPosition ?? 'not set'}. Unchecking a specialty metric withholds it; checking one from elsewhere grants it. Only the difference is stored, so future changes to the catalog still reach this profile.`}
					closeHref={backHref}
				>
					<form action={saveSetAction} className="space-y-4">
						{/* What the specialty granted when this form was rendered. The
						    action refuses the save if the catalog moved since, so a
						    page left open cannot silently undo a catalog change. */}
						<input type="hidden" name="baseline" value={specialtyFingerprint(defs, papPosition)} />
						<div className="max-h-[50vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
							{pickerDefs.map((d) => {
								const fromSpecialty = papPosition != null && d.pap_positions.includes(papPosition);
								const checked = rows.some((r) => r.key === d.key);
								return (
									<label
										key={d.key}
										className="flex items-start gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer"
									>
										<input
											type="checkbox"
											name="metric"
											value={d.key}
											defaultChecked={checked}
											className={`${checkboxClass} mt-0.5`}
										/>
										<span className="min-w-0 flex-1">
											<span className="text-sm text-slate-900 dark:text-slate-100">{d.name}</span>
											{fromSpecialty && (
												<Badge color="primary" className="ml-2 align-middle">{papPosition}</Badge>
											)}
											{d.source === 'the_work' && (
												<Badge color="accent" className="ml-1.5 align-middle">the work</Badge>
											)}
											{d.pap_positions.length > 0 && !fromSpecialty && (
												<span className="ml-2 text-2xs text-slate-600 dark:text-slate-400">{d.pap_positions.join(' · ')}</span>
											)}
											{d.pap_positions.length === 0 && (
												<span className="ml-2 text-2xs text-slate-600 dark:text-slate-400">no specialty</span>
											)}
										</span>
									</label>
								);
							})}
						</div>
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							A metric that already has a number saved for the open month stays visible even if you
							uncheck it — an entered value is not hidden, only stopped going forward. To change what a
							whole specialty measures, use{' '}
							<Link href="/admin/metrics" className="text-primary-600 hover:underline">the metric catalog</Link>{' '}
							instead of editing one person at a time.
						</p>
						<div className="flex items-center justify-end gap-2">
							<Link
								href={backHref}
								className="inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
							>
								Cancel
							</Link>
							<Button type="submit">Save metric set</Button>
						</div>
					</form>
				</ModalCard>
			)}

			{error && (
				<Callout tone="error" className="mx-3 mt-3">
					{error}
				</Callout>
			)}
			{saved && !error && (
				<Callout tone="success" className="mx-3 mt-3">
					{saved === '0' ? 'Nothing to save — all fields were empty.' : `Saved ${saved} metric${saved === '1' ? '' : 's'} for ${monthLabel}.`}
				</Callout>
			)}

			{overrideLoadFailed && (
				<Callout tone="warning" className="mx-3 mt-3">
					Could not read this person&rsquo;s metric customisations, so the list below is the{' '}
					{papPosition ?? 'catalog'} default and may be missing or showing metrics it should not.
					Reload before entering anything.
				</Callout>
			)}

			{setSaved && (
				<Callout tone="success" className="mx-3 mt-3">
					Metric set updated{papPosition ? ` — differences from ${papPosition} are stored, the rest follows the catalog.` : '.'}
				</Callout>
			)}

			{rows.length === 0 ? (
				<div className="text-center py-8 text-sm text-slate-500">
					No metrics apply yet.{' '}
					{isManagerViewer ? (
						<>Set the specialty in <Link href={`/team/${subjectId}/edit`} className="text-primary-600 hover:underline">Edit profile</Link>.</>
					) : (
						'Ask a people-manager to set your specialty.'
					)}
				</div>
			) : (
				<form action={saveAction}>
					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Metric · {monthLabel}</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-16">Unit</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-28">Goal</th>
								{hasComputed && (
									<th className="text-right text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-28">From The Work</th>
								)}
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-28">Achieved</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-24">Source</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((d) => {
								const v = manualByKey.get(d.key);
								const computed = computedByKey.get(d.key);
								// Transition period (Sam, 2026-08-24): the computed value is
								// shown BESIDE the manual input rather than replacing it. The
								// input goes away in a later slice.
								const readOnly = !canEnter;
								return (
									<tr key={d.key} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-3 py-2 align-top">
											<div className="text-slate-900 dark:text-slate-100 font-medium">
												{d.name}
												{/* Why is this row here / still here? Say so, so nobody
												    has to open the picker to find out. */}
												{flagByKey.get(d.key)?.granted && (
													<Badge color="warning" className="ml-2 align-middle">added for {subjectName.split(' ')[0]}</Badge>
												)}
												{flagByKey.get(d.key)?.keptForValue && (
													<Badge color="warning" className="ml-2 align-middle" >withheld · has a value</Badge>
												)}
											</div>
											{d.description && (
												<div className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2" title={d.description}>
													{d.description}
												</div>
											)}
										</td>
										<td className="px-3 py-2 align-top text-2xs text-slate-600 dark:text-slate-400">{d.unit ?? '—'}</td>
										<td className="px-3 py-2 align-top">
											{d.requires_goal ? (
												<input
													name={`goal:${d.key}`}
													type="number"
													step="any"
													defaultValue={v?.goal ?? ''}
													placeholder="Goal"
													aria-label={`${d.name} — goal`}
													className={inputClass}
													disabled={readOnly}
												/>
											) : (
												<span className="text-2xs text-slate-600 dark:text-slate-400">—</span>
											)}
										</td>
										{hasComputed && (
										<td className="px-3 py-2 align-top text-right">
											{d.source === 'the_work' ? (
												computed ? (
													<>
														<span className="text-slate-900 dark:text-slate-100 font-semibold tabular-nums">
															{computed.value ?? 0}
														</span>
														{v?.value != null && Number(v.value) !== Number(computed.value ?? 0) && (
															<div className="text-2xs text-amber-600 dark:text-amber-400 mt-0.5">
																typed {v.value}
															</div>
														)}
													</>
												) : (
													<span className="text-2xs text-slate-600 dark:text-slate-400" title="No item in The Work was attributed to this person in this month.">
														no data
													</span>
												)
											) : (
												<span className="text-2xs text-slate-300 dark:text-slate-600">—</span>
											)}
										</td>
										)}
										<td className="px-3 py-2 align-top">
											<input
												name={`value:${d.key}`}
												type="number"
												step="any"
												defaultValue={v?.value ?? ''}
												placeholder="Achieved"
												aria-label={`${d.name} — achieved`}
												className={inputClass}
												disabled={readOnly}
											/>
										</td>
										<td className="px-3 py-2 align-top">
											<Badge color={d.source === 'the_work' ? 'accent' : 'default'}>
												{d.source === 'the_work' ? 'the work' : (v?.source ?? 'manual').replace(/_/g, ' ')}
											</Badge>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
					<div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
						<p className="text-2xs text-slate-600 dark:text-slate-400">
							Goal is asked only where the metric requires one.{' '}
							{hasComputed && (
								<>
									<span className="text-slate-500 dark:text-slate-400">From The Work</span> is counted from
									completed items in The Work, not typed. Completion dates start on 24 Aug 2026, so this
									August is partial and September is the first whole month.
								</>
							)}
						</p>
						{canEnter && <Button type="submit">Save {monthLabel}</Button>}
					</div>
				</form>
			)}
		</Card>
	);
}
