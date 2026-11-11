'use client';

// Client half of the metric table: search, group filter, "hide idle rows" and
// collapsible sections. Every cell arrives pre-formatted from MetricTable, so
// this file only decides what is shown.
//
// Persistence: collapsed sections and the idle toggle live in localStorage per
// dashboard (a preference, not data — no round-trip to the server). The search
// box and the group filter are deliberately NOT persisted: coming back to a page
// that is silently filtered is how people end up reading the wrong number.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, X } from 'lucide-react';
import SearchInput from '@/components/ui/SearchInput';
import { clsx } from 'clsx';
import Link from 'next/link';

import Card from '@/components/ui/Card';
import Sparkline from '@/components/dashboard/Sparkline';
import type { DashboardPeriod } from '@/lib/dashboard/layout';
import type { TileDelta } from '@/lib/dashboard/types';

export interface RowView {
	key: string;
	label: string;
	dayText: string;
	dayDelta: TileDelta | null;
	weekText: string;
	weekDelta: TileDelta | null;
	series: (number | null)[] | null;
	/** No number (or a zero) in either period. */
	idle: boolean;
	/** Optional row links (KPIs page): edit the definition, open the sheet row. */
	editHref?: string | null;
	sheetHref?: string | null;
	/** Where the number comes from, shown under the label when set. */
	sourceNote?: string | null;
}

export interface SectionView {
	title: string;
	weeklyOnly: boolean;
	rows: RowView[];
}

interface Props {
	dashboardKey: string;
	sections: SectionView[];
	period: DashboardPeriod;
	dayLabel: string;
	prevDayLabel: string;
	weekLabel: string | null;
	prevWeekLabel: string | null;
	className?: string;
}

interface Prefs {
	collapsed: string[];
	hideIdle: boolean;
}

const storageKey = (dashboardKey: string) => `org.metrics.${dashboardKey}`;

function loadPrefs(dashboardKey: string): Prefs {
	if (typeof window === 'undefined') return { collapsed: [], hideIdle: false };
	try {
		const raw = window.localStorage.getItem(storageKey(dashboardKey));
		if (!raw) return { collapsed: [], hideIdle: false };
		const parsed = JSON.parse(raw) as Partial<Prefs>;
		return {
			collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed.filter((s) => typeof s === 'string') : [],
			hideIdle: parsed.hideIdle === true,
		};
	} catch {
		return { collapsed: [], hideIdle: false };
	}
}

function DeltaCell({ delta }: { delta: TileDelta | null }) {
	if (!delta) return <span className="text-slate-300 dark:text-slate-600">—</span>;
	return (
		<span
			className={clsx(
				'font-semibold tabular-nums',
				delta.tone === 'good' && 'text-green-600 dark:text-green-400',
				delta.tone === 'bad' && 'text-red-600 dark:text-red-400',
				delta.tone === 'neutral' && 'text-slate-400 dark:text-slate-500',
			)}
			title={delta.note}
		>
			{delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '·'} {delta.text}
		</span>
	);
}

export default function MetricExplorer({
	dashboardKey,
	sections,
	period,
	dayLabel,
	prevDayLabel,
	weekLabel,
	prevWeekLabel,
	className,
}: Props) {
	const [query, setQuery] = useState('');
	const [groups, setGroups] = useState<string[]>([]); // empty = every group
	const [hideIdle, setHideIdle] = useState(false);
	const [collapsed, setCollapsed] = useState<string[]>([]);
	const [ready, setReady] = useState(false);

	// Read the saved preferences after mount — server and first client render
	// must agree, so the stored state is applied in an effect, not during render.
	useEffect(() => {
		const prefs = loadPrefs(dashboardKey);
		setCollapsed(prefs.collapsed);
		setHideIdle(prefs.hideIdle);
		setReady(true);
	}, [dashboardKey]);

	useEffect(() => {
		if (!ready) return;
		try {
			window.localStorage.setItem(storageKey(dashboardKey), JSON.stringify({ collapsed, hideIdle }));
		} catch {
			// private mode / storage full — the page still works, it just won't remember
		}
	}, [ready, dashboardKey, collapsed, hideIdle]);

	const idleCount = useMemo(
		() => sections.reduce((n, s) => n + s.rows.filter((r) => r.idle).length, 0),
		[sections],
	);
	const totalCount = useMemo(() => sections.reduce((n, s) => n + s.rows.length, 0), [sections]);

	const q = query.trim().toLowerCase();
	const shown = useMemo(() => {
		return sections
			.filter((s) => groups.length === 0 || groups.includes(s.title))
			.map((s) => ({
				...s,
				rows: s.rows.filter(
					(r) =>
						(!hideIdle || !r.idle) &&
						(q === '' || r.label.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)),
				),
			}))
			.filter((s) => s.rows.length > 0);
	}, [sections, groups, hideIdle, q]);

	const shownCount = shown.reduce((n, s) => n + s.rows.length, 0);
	const filtering = q !== '' || groups.length > 0 || hideIdle;
	// A search is a question — don't answer it with a collapsed section.
	const isCollapsed = (title: string) => q === '' && collapsed.includes(title);
	const toggleSection = (title: string) =>
		setCollapsed((c) => (c.includes(title) ? c.filter((t) => t !== title) : [...c, title]));
	const toggleGroup = (title: string) =>
		setGroups((g) => (g.includes(title) ? g.filter((t) => t !== title) : [...g, title]));

	const dailyFocus = period === 'daily';
	const focusCol = 'bg-slate-50 dark:bg-slate-700/25';

	return (
		<div className={className}>
			{/* toolbar — one row above the data, per dashboard filter conventions */}
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<SearchInput
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search KPI…"
					aria-label="Search KPI"
					className="w-52"
				/>

				<button
					type="button"
					onClick={() => setHideIdle((v) => !v)}
					aria-pressed={hideIdle}
					className={clsx(
						'text-xs px-2.5 py-1.5 rounded-md border transition-colors',
						hideIdle
							? 'border-primary-500 text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/50'
							: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
					)}
					title="Hide metrics with no number (or a zero) in both periods"
				>
					<Filter className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
					Hide idle
					<span className="ml-1.5 tabular-nums text-slate-400 dark:text-slate-500">{idleCount}</span>
				</button>

				{filtering && (
					<button
						type="button"
						onClick={() => {
							setQuery('');
							setGroups([]);
							setHideIdle(false);
						}}
						className="text-xs px-2 py-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
					>
						<X className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
						Clear
					</button>
				)}

				<span className="text-2xs text-slate-400 dark:text-slate-500 tabular-nums ml-auto">
					{shownCount === totalCount ? `${totalCount} KPIs` : `${shownCount} of ${totalCount} KPIs`}
				</span>
			</div>

			{/* group filter */}
			{sections.length > 1 && (
				<div className="flex flex-wrap gap-1.5 mb-4">
					{sections.map((s) => {
						const on = groups.includes(s.title);
						return (
							<button
								key={s.title}
								type="button"
								onClick={() => toggleGroup(s.title)}
								aria-pressed={on}
								className={clsx(
									'text-xs px-2.5 py-1 rounded-full border transition-colors',
									on
										? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
										: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
								)}
							>
								{s.title}
								<span className="ml-1.5 tabular-nums opacity-60">{s.rows.length}</span>
							</button>
						);
					})}
				</div>
			)}

			{shown.length === 0 && (
				<Card className="mb-6">
					<p className="text-sm text-slate-500 dark:text-slate-400">
						No KPI matches the current filters.
					</p>
				</Card>
			)}

			{shown.map((section) => {
				const folded = isCollapsed(section.title);
				const bodyId = `metrics-${section.title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
				return (
					<section key={section.title} className="mb-5">
						<div className="flex items-center gap-2 mb-2">
							<button
								type="button"
								onClick={() => toggleSection(section.title)}
								aria-expanded={!folded}
								aria-controls={bodyId}
								className="group flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
							>
								<ChevronDown
									className={clsx(
										'w-3.5 h-3.5 transition-transform',
										folded && '-rotate-90',
									)}
								/>
								{section.title}
								<span className="font-normal tabular-nums text-slate-400 dark:text-slate-500">
									{section.rows.length}
								</span>
							</button>
							<div className="flex-1 h-px bg-slate-200 dark:bg-slate-700/60" />
						</div>

						{!folded && (
							<Card padding="none" className="overflow-x-auto" >
								<table id={bodyId} className="w-full text-xs table-fixed">
									<colgroup>
										<col />
										<col className={clsx('w-[14%]', dailyFocus && focusCol)} />
										<col className={clsx('w-[12%]', dailyFocus && focusCol)} />
										<col className={clsx('w-[14%]', !dailyFocus && focusCol)} />
										<col className={clsx('w-[12%]', !dailyFocus && focusCol)} />
										<col className="w-[10%]" />
									</colgroup>
									<thead>
										<tr className="text-slate-400 dark:text-slate-500 bg-slate-50/80 dark:bg-slate-900/30">
											<th className="text-left font-medium px-4 py-2">KPI</th>
											<th className="text-right font-medium px-3 py-2 whitespace-nowrap">
												Daily
												<span className="ml-1 font-normal tabular-nums">{dayLabel}</span>
											</th>
											<th className="text-right font-medium px-3 py-2 whitespace-nowrap">
												Δ daily
											</th>
											<th className="text-right font-medium px-3 py-2 whitespace-nowrap">
												Weekly
												<span className="ml-1 font-normal tabular-nums">{weekLabel ?? '—'}</span>
											</th>
											<th className="text-right font-medium px-3 py-2 whitespace-nowrap">
												Δ weekly
											</th>
											<th className="text-right font-medium px-4 py-2 whitespace-nowrap">
												Bi-weekly
											</th>
										</tr>
									</thead>
									<tbody>
										{section.rows.map((row) => (
											<tr
												key={row.key}
												className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
											>
												<td className="px-4 py-1.5 text-slate-700 dark:text-slate-300">
													<span className="inline-flex items-center gap-1.5 flex-wrap">
														{row.label}
														{row.editHref && (
															<Link
																href={row.editHref}
																className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 transition-colors"
																title="Edit definition"
															>
																edit
															</Link>
														)}
														{row.sheetHref && (
															<a
																href={row.sheetHref}
																target="_blank"
																rel="noreferrer"
																className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 transition-colors"
																title="Open in the CEO Metrics sheet"
															>
																sheet ↗
															</a>
														)}
													</span>
													{row.sourceNote && (
														<span className="block text-2xs text-slate-600 dark:text-slate-400 truncate" title={row.sourceNote}>{row.sourceNote}</span>
													)}
												</td>
												<td
													className={clsx(
														'px-3 py-1.5 text-right tabular-nums',
														dailyFocus
															? 'font-semibold text-slate-900 dark:text-slate-100'
															: 'text-slate-500 dark:text-slate-400',
													)}
												>
													{row.dayText}
												</td>
												<td className="px-3 py-1.5 text-right whitespace-nowrap">
													<DeltaCell delta={row.dayDelta} />
												</td>
												<td
													className={clsx(
														'px-3 py-1.5 text-right tabular-nums',
														!dailyFocus
															? 'font-semibold text-slate-900 dark:text-slate-100'
															: 'text-slate-500 dark:text-slate-400',
													)}
												>
													{row.weekText}
												</td>
												<td className="px-3 py-1.5 text-right whitespace-nowrap">
													<DeltaCell delta={row.weekDelta} />
												</td>
												<td className="px-4 py-1.5">
													<div className="flex justify-end">
														{row.series ? (
															<Sparkline series={row.series} title={`14 days to ${dayLabel}`} />
														) : null}
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</Card>
						)}
					</section>
				);
			})}

			<p className="text-2xs text-slate-400 dark:text-slate-500">
				Δ daily compares {dayLabel} with {prevDayLabel} · Δ weekly compares {weekLabel ?? '—'} with{' '}
				{prevWeekLabel ?? '—'} · Bi-weekly is the 14-day trend ending on {dayLabel}.
			</p>
		</div>
	);
}
