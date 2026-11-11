// /media/lead-scraper — the Apollo layout.
//
// Filters left (1/4), results centre (3/4), and every executed search a chip
// in the run bar above the results. The three stacked full-width cards it
// replaced made you scroll past a form and a jobs table to reach the leads,
// which is the thing you actually came to read.
//
// Filters describe the NEXT search and never silently re-fetch: selecting a
// run swaps the dataset, editing filters changes nothing until Run search.
// That is the whole contract, and the dirty notice in the rail is what keeps
// it honest — the failure it prevents is approving leads believing they came
// from the filters currently on screen.
//
// Progress is read on page load rather than pushed over Realtime — the
// portability contract does not take a Realtime dependency, and cron-driven
// jobs only change every few minutes anyway, so a refresh is honest.
//
// Gated by capability, not role: the route's layout (./layout.tsx) checks
// hasCapability('run_scrapers') and renders a refusal card for anyone not
// granted, so this page body runs only for grantees. /media itself has no
// module gate — it is open to every role — and can_run_scrapers() (0055)
// enforces the same rule in RLS as a second layer, not the boundary itself.
// This moved off /admin (and off ModuleGate's admin-only check) in the
// 2026-08-26 capability-gating change; see the layout for the full rationale.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectAllCheckbox from '@/components/ui/SelectAllCheckbox';
import PageHeader from '@/components/ui/PageHeader';
import ToolSettingsGear from '@/components/nav/ToolSettingsGear';
import { Play, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { reviewRecords, reviewAcquisitionRecords, cancelJob, advanceNow } from './actions';
import AutoRefresh from './AutoRefresh';
import RunBar from './RunBar';
import FilterRail, { type ScrapeMode } from './FilterRail';
import {
	type JobRow,
	STATUS_TONE,
	actionableUrl,
	describeParams,
	narrowingWarnings,
	isActive,
	isAcquisition,
} from './jobDisplay';
import {
	parseFilterParams,
	filtersFromJobParams,
	filtersEqual,
	filtersToSearchParams,
} from '@/lib/scrapers/filterParams';
import { getScraperConfig, usd } from '@/lib/scrapers/settings';
import Callout from '@/components/ui/Callout';

export const metadata = { title: 'Lead Scraper' };

export const dynamic = 'force-dynamic';

// One page of the pending-review table. Deliberately under the 500-id cap
// reviewRecords enforces (actions.ts), so "Approve checked" on a full page
// can never exceed what the action accepts.
const PAGE_SIZE = 100;

interface RecordRow {
	id: string;
	full_name: string | null;
	email: string | null;
	job_title: string | null;
	company_name: string | null;
	company_domain: string | null;
	company_industry: string | null;
	// Trade-show preset extras (0048): written since the preset shipped but
	// never shown anywhere — the first question anyone asks of an exhibitor
	// row is "which show?".
	booth: string | null;
	source_url: string | null;
	company_size: string | null;
	location: string | null;
	linkedin_url: string | null;
	status: string;
	// Acquisition preset (0060): the firm columns the review table swaps in.
	agency_services: string | null;
	company_revenue: string | null;
	company_founded_year: string | null;
	company_city: string | null;
	company_state: string | null;
	company_country: string | null;
	owner_signal: string | null;
	rev_deal_id: string | null;
}

const RECORD_COLUMNS =
	'id, full_name, email, job_title, company_name, company_domain, company_industry, company_size, location, linkedin_url, status, booth, source_url, agency_services, company_revenue, company_founded_year, company_city, company_state, company_country, owner_signal, rev_deal_id';

const th = 'text-left text-xs font-medium text-slate-400 dark:text-slate-500 px-3 py-2';

/** Firm location for an acquisition row: the company trio, then the contact's. */
function firmLocation(r: RecordRow): string | null {
	const parts = [r.company_city, r.company_state, r.company_country].filter(Boolean);
	return parts.length ? parts.join(', ') : r.location;
}

export default async function LeadScraperPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const sp = await searchParams;
	const jobParam = typeof sp.job === 'string' ? sp.job : undefined;

	// Which tab families this viewer holds. The layout already refused anyone
	// with neither; here it decides what renders. Capability, never role
	// (0060: no is_admin() shortcut for acquisitions).
	const [canLeads, canAcquisitions] = await Promise.all([
		hasCapability('run_scrapers'),
		hasCapability('acquisitions'),
	]);
	const access = { leads: canLeads, acquisitions: canAcquisitions };

	// ?mode=show, ?mode=linkedin and ?mode=acquisition are named; anything
	// else (including absent) is the default B2B database search — so a stale
	// or mistyped ?mode= value falls back to search instead of rendering
	// nothing. A mode the viewer may not use falls back to one they may.
	const rawMode = typeof sp.mode === 'string' ? sp.mode : undefined;
	let mode: ScrapeMode =
		rawMode === 'show' ? 'show' : rawMode === 'linkedin' ? 'linkedin' : rawMode === 'acquisition' ? 'acquisition' : 'search';
	if (mode === 'acquisition' && !canAcquisitions) mode = 'search';
	if (mode !== 'acquisition' && !canLeads) mode = 'acquisition';
	const acquisitionMode = mode === 'acquisition';

	// ?p= is the pending-review page, 1-based. Anything unparseable is page 1
	// rather than an error — it is a view offset, not input worth refusing.
	const pageParam = Math.max(1, Number.parseInt(typeof sp.p === 'string' ? sp.p : '', 10) || 1);
	const supabase = await createClient();

	// The run bar shows the runs of the mode you are in: lead presets share
	// one bar, acquisition runs get their own (they are a different kind and
	// RLS fences them separately, so mixing them would show a grantee of one
	// capability chips for the other that select an empty table).
	const { data: jobRows } = await supabase
		.from('scrape_jobs')
		.select('id, kind, status, preset, max_results, params, found, imported, duplicates, error, created_at, finished_at')
		.eq('kind', acquisitionMode ? 'acquisition' : 'lead')
		.order('created_at', { ascending: false })
		.limit(25);
	const jobs = (jobRows ?? []) as JobRow[];

	// Review the selected job, or the newest one that actually has records.
	const selectedId = jobParam ?? jobs.find((j) => j.imported > 0)?.id ?? jobs[0]?.id ?? null;
	const selected = jobs.find((j) => j.id === selectedId) ?? null;

	// Anything the state machine still has work for. Drives both the auto-refresh
	// and whether "Run now" has something to do.
	const active = jobs.some((j) => isActive(j.status));

	// The rail shows what the URL carries; with no f.* params it falls back to
	// the selected run's filters, which is what makes clicking a chip preload
	// the search that produced it.
	const hasFilterParams = Object.keys(sp).some((k) => k.startsWith('f.'));
	const selectedFilters = selected
		? filtersFromJobParams(selected.params, selected.max_results)
		: null;
	// A fresh search starts from the admin's default max_results
	// (scraper_settings, 0072) rather than the hard coded 250.
	const config = await getScraperConfig();
	const filters = hasFilterParams
		? parseFilterParams(sp)
		: (selectedFilters ?? { ...parseFilterParams({}), maxResults: config.settings.defaultMaxResults });

	// Dirty ONLY compares against a real selected run: with nothing selected
	// there is no claim being contradicted, so there is nothing to warn about.
	const dirty = selectedFilters !== null && !filtersEqual(filters, selectedFilters);

	// Serialised params the chips and mode tabs carry, so navigating between
	// runs or modes never discards what the other half holds.
	const filterQuery = hasFilterParams
		? (() => {
				const q = filtersToSearchParams(filters);
				if (mode !== 'search') q.set('mode', mode);
				return q.toString();
			})()
		: mode !== 'search'
			? `mode=${mode}`
			: '';
	const jobQuery = selectedId ? `job=${selectedId}` : '';

	let pending: RecordRow[] = [];
	let pendingTotal = 0;
	let approvedCount = 0;
	let page = 1;
	if (selectedId) {
		// Count first, so an out-of-range ?p= can be clamped BEFORE the row
		// read — otherwise a stale bookmark (or a page emptied by approving it)
		// asks for a range past the end and renders an empty table under a
		// pager claiming rows exist.
		const [{ count: pendingExact }, { count: approvedExact }] = await Promise.all([
			supabase
				.from('scraped_records')
				.select('id', { count: 'exact', head: true })
				.eq('job_id', selectedId)
				.eq('status', 'pending'),
			supabase
				.from('scraped_records')
				.select('id', { count: 'exact', head: true })
				.eq('job_id', selectedId)
				.eq('status', 'approved'),
		]);
		pendingTotal = pendingExact ?? 0;
		approvedCount = approvedExact ?? 0;
		page = Math.min(pageParam, Math.max(1, Math.ceil(pendingTotal / PAGE_SIZE)));

		if (pendingTotal > 0) {
			// `order` is (company_name, id): company_name alone is not unique and
			// repeats across pages under a stable sort, which silently drops or
			// duplicates rows between pages — the id breaks every tie.
			const from = (page - 1) * PAGE_SIZE;
			const { data: pendingRows } = await supabase
				.from('scraped_records')
				.select(RECORD_COLUMNS)
				.eq('job_id', selectedId)
				.eq('status', 'pending')
				.order('company_name')
				.order('id')
				.range(from, from + PAGE_SIZE - 1);
			pending = (pendingRows ?? []) as RecordRow[];
		}
	}
	const pageCount = Math.max(1, Math.ceil(pendingTotal / PAGE_SIZE));
	const pageStart = (page - 1) * PAGE_SIZE;

	/** This page's URL with a different pending page, preserving everything else. */
	function pageHref(target: number): string {
		const q = new URLSearchParams();
		if (selectedId) q.set('job', selectedId);
		if (hasFilterParams) for (const [k, v] of filtersToSearchParams(filters)) q.set(k, v);
		if (mode !== 'search') q.set('mode', mode);
		if (target > 1) q.set('p', String(target));
		const s = q.toString();
		return s ? `/media/lead-scraper?${s}` : '/media/lead-scraper';
	}

	const warnings = selected && !isAcquisition(selected) ? narrowingWarnings(selected.params) : [];
	// The selected run decides the table shape and the approve action, not the
	// rail mode: they normally agree, but a stale ?job= must never let a lead
	// row be approved into acquisition_targets or vice versa.
	const selectedIsAcquisition = selected !== null && isAcquisition(selected);
	const exportBase = selectedIsAcquisition
		? `/media/lead-scraper/export/acquisitions?job=${selected.id}`
		: `/media/lead-scraper/export?job=${selected?.id}`;

	return (
		<>
			<PageHeader
				title={acquisitionMode ? 'Acquisition Scraper' : 'Lead Scraper'}
				description={
					acquisitionMode
						? 'Agency owners and firm data → staged for review → acquisition targets → CSV for the deal model. Confidential: visible only to holders of the acquisitions capability.'
						: 'Apify B2B database → staged for review → approved leads enter Prospects → Lead Gen (Sourced) and stay exportable as CSV. Running jobs and reviewing leads is restricted to admin/exec — others can look, not touch.'
				}
				actions={
					<div className="flex items-center gap-2">
						<ToolSettingsGear tool="/media/lead-scraper" />
						<AutoRefresh active={active} />
						{/* Vercel cron only fires on production deployments, so on localhost
						    this button is the ONLY thing that moves the queue. In production
						    it saves waiting up to 5 minutes for the next tick. */}
						<form action={advanceNow}>
							<Button type="submit" variant="outline" size="sm" title="Advance queued and running jobs now instead of waiting for the cron">
								<Play className="w-3 h-3" /> Run now
							</Button>
						</form>
						<Link href="/media/lead-scraper">
							<Button variant="ghost" size="sm">
								<RefreshCw className="w-3 h-3" /> Refresh
							</Button>
						</Link>
					</div>
				}
			/>

			{/* Budget cap (0072). The guard in SQL holds queued jobs past the cap;
			    this is the clear message the done test asks for, where the person
			    pressing Run now will actually read it. */}
			{config.budget.overCap && (
				<Callout tone="error" className="mb-4">
					Monthly scraper budget cap reached: {usd(config.budget.spentUsd)} of{' '}
					{usd(config.budget.monthlyBudgetUsd ?? 0)} used this month. New searches queue but
					will not dispatch until the cap is raised on{' '}
					<Link href="/admin/lead-scraper" className="underline hover:no-underline">
						Admin → Lead Scraper
					</Link>{' '}
					or the month rolls over.
				</Callout>
			)}
			{!config.budget.overCap && config.budget.monthlyBudgetUsd !== null && (
				<p className="mb-4 text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
					Budget this month: {usd(config.budget.spentUsd)} of {usd(config.budget.monthlyBudgetUsd)} used,{' '}
					{usd(config.budget.remainingUsd ?? 0)} remaining. Estimates from run sizes; the Apify invoice is the truth.
				</p>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
				{/* ---------------- Filters (1/4) ---------------- */}
				<Card className="lg:col-span-1 lg:sticky lg:top-4">
					<FilterRail mode={mode} filters={filters} dirty={dirty} jobQuery={jobQuery} access={access} />
				</Card>

				{/* ---------------- Results (3/4) ---------------- */}
				<div className="lg:col-span-3 min-w-0">
					<RunBar jobs={jobs} selectedId={selectedId} filterQuery={filterQuery} />

					{!selected ? (
						<Card>
							<p className="py-8 text-center text-sm text-slate-500">
								{jobs.length === 0
									? 'No searches yet. Compose one on the left and press Run search.'
									: 'Pick a run above to review its leads.'}
							</p>
						</Card>
					) : (
						<Card padding="none">
							{/* Selected run header — everything the jobs table used to carry
							    for this row, in the place the row now lives. */}
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
								<div className="flex items-center gap-2 flex-wrap">
									<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_TONE[selected.status] ?? 'bg-slate-400'}`} />
									<span
										className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate max-w-md"
										title={describeParams(selected.params)}
									>
										{describeParams(selected.params)}
									</span>
									<Badge color="default">{pendingTotal} pending</Badge>
									{approvedCount > 0 && <Badge color="primary">{approvedCount} approved</Badge>}
									<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
										{selected.imported} staged · {selected.duplicates} skipped · ceiling{' '}
										{selected.max_results}
									</span>

									<span className="ml-auto flex items-center gap-3">
										{pendingTotal > 0 && (
											<a
												href={`${exportBase}&status=pending`}
												className="text-2xs text-primary-600 hover:underline"
											>
												Download all pending CSV
											</a>
										)}
										{approvedCount > 0 && (
											<a
												href={exportBase}
												className="text-2xs text-primary-600 hover:underline"
											>
												{selectedIsAcquisition ? 'Download deal-model CSV' : 'Download approved CSV'}
											</a>
										)}
										{/* Not droppable with the jobs table: this is the only way
										    to stop a runaway job. */}
										{isActive(selected.status) && (
											<form action={cancelJob} className="inline">
												<input type="hidden" name="job_id" value={selected.id} />
												<button type="submit" className="text-2xs text-slate-600 dark:text-slate-400 hover:text-red-600 transition-colors">
													Cancel run
												</button>
											</form>
										)}
									</span>
								</div>

								{selected.error && (
									<p className={`mt-1 text-2xs ${selected.status === 'queued' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
										{selected.error}
										{actionableUrl(selected.error) && (
											<a
												href={actionableUrl(selected.error)!}
												target="_blank"
												rel="noreferrer"
												className="ml-1 underline hover:no-underline"
											>
												Open Apify to approve →
											</a>
										)}
									</p>
								)}

								{/* Why a run came back thin, next to the run itself. */}
								{selected.status === 'done' && selected.imported < 10 && warnings.length > 0 && (
									<ul className="mt-1 text-2xs text-amber-600 dark:text-amber-400 space-y-0.5">
										{warnings.map((w) => (
											<li key={w}>{w}</li>
										))}
									</ul>
								)}
							</div>

							{pending.length === 0 ? (
								<p className="px-3 py-8 text-center text-sm text-slate-500">
									{isActive(selected.status)
										? 'Waiting on the scrape — the cron advances it every few minutes, or press Run now.'
										: selected.status === 'done'
											? approvedCount > 0
												? 'All reviewed. The CSV above has the approved leads.'
												: 'This run staged nothing to review.'
											: `This run ended as ${selected.status}.`}
								</p>
							) : (
								<form action={selectedIsAcquisition ? reviewAcquisitionRecords : reviewRecords}>
									<div className="overflow-x-auto">
										{/* Stays a table: reviewing leads is column comparison, which
										    is exactly where the spec keeps tables. */}
										{selectedIsAcquisition ? (
											/* Acquisition columns (0060 brief §4): the firm, not the
											   contact, is the unit of review here. */
											<div className="overflow-x-auto">
											<table className="w-full text-sm">
												<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
													<tr>
														<th className="px-3 py-2 w-8">
															<SelectAllCheckbox name="record_id" label="Select or clear every row on this page" />
														</th>
														<th className={th}>Company</th>
														<th className={th}>Owner</th>
														<th className={th}>Services</th>
														<th className={th}>Size</th>
														<th className={th}>Revenue</th>
														<th className={th}>Founded</th>
														<th className={th}>Location</th>
														<th className={th}>Signal</th>
													</tr>
												</thead>
												<tbody>
													{pending.map((r) => (
														<tr
															key={r.id}
															className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
														>
															<td className="px-3 py-2">
																<Checkbox
																	name="record_id"
																	value={r.id}
																	defaultChecked
																	aria-label={`Include ${r.company_name ?? r.full_name ?? 'firm'}`}
																/>
															</td>
															<td className="px-3 py-2 text-slate-900 dark:text-slate-100">
																{r.company_name ?? '—'}
																{r.company_domain && (
																	<a
																		href={`https://${r.company_domain}`}
																		target="_blank"
																		rel="noreferrer"
																		className="block text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600"
																	>
																		{r.company_domain}
																	</a>
																)}
															</td>
															<td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
																{r.linkedin_url ? (
																	<a href={r.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-primary-600">
																		{r.full_name ?? '—'}
																	</a>
																) : (
																	(r.full_name ?? '—')
																)}
																{r.job_title && <span className="block text-2xs text-slate-600 dark:text-slate-400">{r.job_title}</span>}
															</td>
															<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-300">{r.agency_services ?? '—'}</td>
															<td className="px-3 py-2 text-slate-600 dark:text-slate-300 tabular-nums">{r.company_size ?? '—'}</td>
															<td className="px-3 py-2 text-slate-600 dark:text-slate-300 tabular-nums">{r.company_revenue ?? '—'}</td>
															<td className="px-3 py-2 text-slate-600 dark:text-slate-300 tabular-nums">{r.company_founded_year ?? '—'}</td>
															<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">{firmLocation(r) ?? '—'}</td>
															<td className="px-3 py-2 text-2xs text-amber-700 dark:text-amber-400 max-w-56" title={r.owner_signal ?? undefined}>
																{r.owner_signal ? <span className="line-clamp-2">{r.owner_signal}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}
															</td>
														</tr>
													))}
												</tbody>
											</table>
											</div>
										) : (
										<div className="overflow-x-auto">
										<table className="w-full text-sm">
											<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
												<tr>
													<th className="px-3 py-2 w-8">
														<SelectAllCheckbox name="record_id" label="Select or clear every row on this page" />
													</th>
													<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Name</th>
													<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Title</th>
													<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Company</th>
													<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Email</th>
													<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Location</th>
													<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Prospects</th>
												</tr>
											</thead>
											<tbody>
												{pending.map((r) => (
													<tr
														key={r.id}
														className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
													>
														<td className="px-3 py-2">
															<Checkbox
																name="record_id"
																value={r.id}
																defaultChecked
																aria-label={`Include ${r.full_name ?? r.email ?? 'lead'}`}
															/>
														</td>
														<td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">
															{r.linkedin_url ? (
																<a href={r.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-primary-600">
																	{r.full_name ?? '—'}
																</a>
															) : (
																(r.full_name ?? '—')
															)}
														</td>
														<td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.job_title ?? '—'}</td>
														<td className="px-3 py-2 text-slate-600 dark:text-slate-300">
															{r.company_name ?? '—'}
															{r.company_domain && (
																<span className="block text-2xs text-slate-600 dark:text-slate-400">{r.company_domain}</span>
															)}
														</td>
														<td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.email ?? '—'}</td>
														<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">
															{r.location ?? '—'}
															{r.booth && <span className="block text-slate-400">Booth {r.booth}</span>}
															{r.source_url && (
																<a
																	href={r.source_url}
																	target="_blank"
																	rel="noreferrer"
																	className="block text-slate-400 hover:text-primary-600 truncate max-w-44"
																>
																	source ↗
																</a>
															)}
														</td>
														<td className="px-3 py-2 text-2xs whitespace-nowrap">
															{r.rev_deal_id ? (
																<Link href={`/prospects/deals/${r.rev_deal_id}`} className="text-primary-700 dark:text-primary-300 hover:underline">
																	In Prospects
																</Link>
															) : (
																<span className="text-slate-400">—</span>
															)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
										</div>
										)}
									</div>
									<div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
										<Button type="submit" name="decision" value="approved" size="sm">
											Approve checked
										</Button>
										<Button type="submit" name="decision" value="rejected" variant="outline" size="sm">
											Reject checked
										</Button>
										<span className="text-2xs text-slate-600 dark:text-slate-400">
											{pendingTotal > PAGE_SIZE
												? `Rows ${pageStart + 1}–${pageStart + pending.length} of ${pendingTotal} pending. Approve/Reject applies to this page only.`
												: `Showing all ${pending.length} pending rows.`}{' '}
											{selectedIsAcquisition
												? 'Approved rows go to acquisition targets (status identified) — never to Clients or Prospects.'
												: 'Approved leads enter Prospects → Lead Gen (Sourced) and stay exportable as CSV for the sequence.'}
										</span>

										{/* Pager. Links, not buttons: the page is a server component
										    driven by ?p=, so paging is navigation and stays
										    bookmarkable/back-button-correct. It sits inside the
										    review form but Links do not submit it. */}
										{pageCount > 1 && (
											<span className="ml-auto flex items-center gap-1 shrink-0">
												{page > 1 ? (
													<Link
														href={pageHref(page - 1)}
														className="px-2 py-1 text-2xs rounded-md text-slate-600 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
													>
														← Prev
													</Link>
												) : (
													<span className="px-2 py-1 text-2xs text-slate-300 dark:text-slate-600">← Prev</span>
												)}
												<span className="px-1 text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
													{page} / {pageCount}
												</span>
												{page < pageCount ? (
													<Link
														href={pageHref(page + 1)}
														className="px-2 py-1 text-2xs rounded-md text-slate-600 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
													>
														Next →
													</Link>
												) : (
													<span className="px-2 py-1 text-2xs text-slate-300 dark:text-slate-600">Next →</span>
												)}
											</span>
										)}
									</div>
								</form>
							)}
						</Card>
					)}
				</div>
			</div>
		</>
	);
}
