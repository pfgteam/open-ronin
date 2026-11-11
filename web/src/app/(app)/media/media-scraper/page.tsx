// /media/media-scraper — the Media Scraper (0102, SCRAPERS_PLAN phase 2).
//
// Same Apollo layout as /media/lead-scraper (filters left, results centre,
// run chips above) reusing that page's RunBar and display helpers, with a
// review table shaped for JOURNALISTS: name, outlet, email + status, beats,
// article evidence links, and a duplicate badge when a rerun found someone
// already staged or already in Contacts.
//
// Approve here is not a CSV: it merges into contacts (journalist role),
// media_outlets and media_contact_profiles through approve_media_records().
//
// Gated by the review_media_records capability in ./layout.tsx; RLS
// (can_review_media_records via can_access_scrape_kind('media')) is the
// real boundary.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectAllCheckbox from '@/components/ui/SelectAllCheckbox';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import { Play, RefreshCw, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getScraperConfig, usd } from '@/lib/scrapers/settings';
import AutoRefresh from '@/app/(app)/media/lead-scraper/AutoRefresh';
import RunBar from '@/app/(app)/media/lead-scraper/RunBar';
import { type JobRow, STATUS_TONE, actionableUrl, describeParams, isActive, mediaPreset } from '@/app/(app)/media/lead-scraper/jobDisplay';
import MediaFilterRail, { type MediaMode } from './MediaFilterRail';
import { reviewMediaRecords, cancelMediaJob, advanceMediaNow, createWaterfallFromJob } from './actions';

export const metadata = { title: 'Media Scraper' };
export const dynamic = 'force-dynamic';

const PATH = '/media/media-scraper';
const PAGE_SIZE = 100;

interface MediaRecordRow {
	id: string;
	kind: string;
	full_name: string | null;
	job_title: string | null;
	email: string | null;
	email_status: string | null;
	outlet_name: string | null;
	outlet_domain: string | null;
	beats: string[] | null;
	evidence: { title?: string | null; url?: string | null; date?: string | null }[] | null;
	linkedin_url: string | null;
	company_linkedin: string | null;
	source_url: string | null;
	dedup_status: string | null;
	status: string;
}

const RECORD_COLUMNS =
	'id, kind, full_name, job_title, email, email_status, outlet_name, outlet_domain, beats, evidence, linkedin_url, company_linkedin, source_url, dedup_status, status';

const th = 'text-left text-xs font-medium text-slate-400 dark:text-slate-500 px-3 py-2';

const EMAIL_STATUS_LABEL: Record<string, string> = {
	verified: 'verified',
	article_page: 'on article',
	author_or_contact_page: 'on author page',
	likely: 'likely',
	pattern_guess: 'pattern guess',
	not_found: 'no email',
};

function emailTone(status: string | null): 'success' | 'warning' | 'default' {
	if (status === 'verified' || status === 'article_page' || status === 'author_or_contact_page') return 'success';
	if (status === 'likely' || status === 'pattern_guess') return 'warning';
	return 'default';
}

function modeFor(job: JobRow | null, raw: string | undefined): MediaMode {
	if (raw === 'waterfall' || raw === 'outlets' || raw === 'journalists') return raw;
	const p = job ? mediaPreset(job) : null;
	return p === 'email_waterfall' ? 'waterfall' : p === 'outlet_crawl' ? 'outlets' : 'journalists';
}

export default async function MediaScraperPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const sp = await searchParams;
	const jobParam = typeof sp.job === 'string' ? sp.job : undefined;
	const pageParam = Math.max(1, Number.parseInt(typeof sp.p === 'string' ? sp.p : '', 10) || 1);
	const supabase = await createClient();

	const { data: jobRows } = await supabase
		.from('scrape_jobs')
		.select('id, kind, status, preset, max_results, params, found, imported, duplicates, error, created_at, finished_at')
		.eq('kind', 'media')
		.order('created_at', { ascending: false })
		.limit(25);
	const jobs = (jobRows ?? []) as JobRow[];
	const selectedId = jobParam ?? jobs.find((j) => j.imported > 0)?.id ?? jobs[0]?.id ?? null;
	const selected = jobs.find((j) => j.id === selectedId) ?? null;
	const active = jobs.some((j) => isActive(j.status));
	const mode = modeFor(selected, typeof sp.mode === 'string' ? sp.mode : undefined);
	const config = await getScraperConfig();

	const jobQuery = selectedId ? `job=${selectedId}` : '';
	const filterQuery = mode !== 'journalists' ? `mode=${mode}` : '';

	let pending: MediaRecordRow[] = [];
	let pendingTotal = 0;
	let approvedCount = 0;
	let noEmailCount = 0;
	let page = 1;
	if (selectedId) {
		const [{ count: pendingExact }, { count: approvedExact }, { count: noEmail }] = await Promise.all([
			supabase.from('scraped_records').select('id', { count: 'exact', head: true }).eq('job_id', selectedId).eq('status', 'pending'),
			supabase.from('scraped_records').select('id', { count: 'exact', head: true }).eq('job_id', selectedId).eq('status', 'approved'),
			supabase.from('scraped_records').select('id', { count: 'exact', head: true }).eq('job_id', selectedId).eq('kind', 'media_contact').is('email', null).in('status', ['pending', 'approved']),
		]);
		pendingTotal = pendingExact ?? 0;
		approvedCount = approvedExact ?? 0;
		noEmailCount = noEmail ?? 0;
		page = Math.min(pageParam, Math.max(1, Math.ceil(pendingTotal / PAGE_SIZE)));
		if (pendingTotal > 0) {
			const from = (page - 1) * PAGE_SIZE;
			const { data: rows } = await supabase
				.from('scraped_records')
				.select(RECORD_COLUMNS)
				.eq('job_id', selectedId)
				.eq('status', 'pending')
				.order('kind')
				.order('outlet_name')
				.order('id')
				.range(from, from + PAGE_SIZE - 1);
			pending = (rows ?? []) as unknown as MediaRecordRow[];
		}
	}
	const pageCount = Math.max(1, Math.ceil(pendingTotal / PAGE_SIZE));
	const pageStart = (page - 1) * PAGE_SIZE;
	const pageHref = (target: number) => {
		const q = new URLSearchParams();
		if (selectedId) q.set('job', selectedId);
		if (mode !== 'journalists') q.set('mode', mode);
		if (target > 1) q.set('p', String(target));
		const s = q.toString();
		return s ? `${PATH}?${s}` : PATH;
	};
	const selectedQueries = selected && Array.isArray((selected.params as { queries?: unknown }).queries) ? ((selected.params as { queries: string[] }).queries ?? []) : [];
	const selectedIsJournalists = selected !== null && mediaPreset(selected) === 'news_journalists';

	return (
		<>
			<PageHeader
				title="Media Scraper"
				description="Journalists by beat, email waterfall and outlet crawl → staged for review → Contacts (journalist role) and Media Outlets. Restricted to media reviewers."
				actions={
					<div className="flex items-center gap-2">
						<AutoRefresh active={active} />
						<form action={advanceMediaNow}>
							<Button type="submit" variant="outline" size="sm" title="Advance queued and running jobs now instead of waiting for the cron">
								<Play className="w-3 h-3" /> Run now
							</Button>
						</form>
						<Link href={PATH}>
							<Button variant="ghost" size="sm">
								<RefreshCw className="w-3 h-3" /> Refresh
							</Button>
						</Link>
					</div>
				}
			/>

			{config.budget.overCap && (
				<Callout tone="error" className="mb-4">
					Monthly scraper budget cap reached: {usd(config.budget.spentUsd)} of {usd(config.budget.monthlyBudgetUsd ?? 0)} used this month. New
					searches queue but will not dispatch until the cap is raised on{' '}
					<Link href="/admin/lead-scraper" className="underline hover:no-underline">
						Admin → Scraper settings
					</Link>{' '}
					or the month rolls over.
				</Callout>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
				<Card className="lg:col-span-1 lg:sticky lg:top-4">
					<MediaFilterRail mode={mode} jobQuery={jobQuery} defaultMaxResults={config.settings.defaultMaxResults} defaultQueries={selectedQueries} />
				</Card>

				<div className="lg:col-span-3 min-w-0">
					<RunBar jobs={jobs} selectedId={selectedId} filterQuery={filterQuery} basePath={PATH} />

					{!selected ? (
						<Card>
							<p className="py-8 text-center text-sm text-slate-500">
								{jobs.length === 0 ? 'No media runs yet. Add a beat on the left and press Run search.' : 'Pick a run above to review it.'}
							</p>
						</Card>
					) : (
						<Card padding="none">
							<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
								<div className="flex items-center gap-2 flex-wrap">
									<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_TONE[selected.status] ?? 'bg-slate-400'}`} />
									<span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate max-w-md" title={describeParams(selected.params)}>
										{describeParams(selected.params)}
									</span>
									<Badge color="default">{pendingTotal} pending</Badge>
									{approvedCount > 0 && <Badge color="primary">{approvedCount} approved</Badge>}
									<span className="text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
										{selected.imported} staged · {selected.duplicates} skipped · ceiling {selected.max_results}
									</span>
									<span className="ml-auto flex items-center gap-3">
										{/* The fallback chain: journalists found without an email go to the waterfall. */}
										{selectedIsJournalists && selected.status === 'done' && noEmailCount > 0 && (
											<form action={createWaterfallFromJob} className="inline">
												<input type="hidden" name="job_id" value={selected.id} />
												<button type="submit" className="inline-flex items-center gap-1 text-2xs text-primary-600 hover:underline" title="Queue an email waterfall for every journalist in this run with no public email">
													<Mail className="w-3 h-3" /> Find emails for {noEmailCount}
												</button>
											</form>
										)}
										{isActive(selected.status) && (
											<form action={cancelMediaJob} className="inline">
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
											<a href={actionableUrl(selected.error)!} target="_blank" rel="noreferrer" className="ml-1 underline hover:no-underline">
												Open Apify to approve →
											</a>
										)}
									</p>
								)}
							</div>

							{pending.length === 0 ? (
								<p className="px-3 py-8 text-center text-sm text-slate-500">
									{isActive(selected.status)
										? 'Waiting on the scrape — the cron advances it every few minutes, or press Run now.'
										: selected.status === 'done'
											? approvedCount > 0
												? 'All reviewed. Approved journalists are in Contacts and their outlets in Media Outlets.'
												: 'This run staged nothing to review.'
											: `This run ended as ${selected.status}.`}
								</p>
							) : (
								<form action={reviewMediaRecords}>
									<div className="overflow-x-auto">
										<table className="w-full text-sm">
											<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
												<tr>
													<th className="px-3 py-2 w-8">
														<SelectAllCheckbox name="record_id" label="Select or clear every row on this page" />
													</th>
													<th className={th}>Who</th>
													<th className={th}>Outlet</th>
													<th className={th}>Email</th>
													<th className={th}>Beats</th>
													<th className={th}>Evidence</th>
												</tr>
											</thead>
											<tbody>
												{pending.map((r) => {
													const isOutlet = r.kind === 'media_outlet';
													const evidence = (r.evidence ?? []).filter((e) => e && (e.url || e.title)).slice(0, 3);
													return (
														<tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
															<td className="px-3 py-2">
																<Checkbox name="record_id" value={r.id} defaultChecked={r.dedup_status !== 'duplicate'} aria-label={`Include ${r.full_name ?? r.outlet_name ?? 'row'}`} />
															</td>
															<td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">
																{isOutlet ? (
																	<span className="text-slate-600 dark:text-slate-300">
																		<Badge color="accent">outlet</Badge>
																	</span>
																) : r.linkedin_url ? (
																	<a href={r.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-primary-600">
																		{r.full_name ?? '—'}
																	</a>
																) : (
																	(r.full_name ?? '—')
																)}
																{r.job_title && <span className="block text-2xs text-slate-600 dark:text-slate-400">{r.job_title}</span>}
																{r.dedup_status === 'duplicate' && (
																	<span className="block mt-0.5">
																		<Badge color="warning">already known</Badge>
																	</span>
																)}
															</td>
															<td className="px-3 py-2 text-slate-600 dark:text-slate-300">
																{r.outlet_name ?? '—'}
																{r.outlet_domain && (
																	<a href={`https://${r.outlet_domain}`} target="_blank" rel="noreferrer" className="block text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600">
																		{r.outlet_domain}
																	</a>
																)}
															</td>
															<td className="px-3 py-2 text-slate-600 dark:text-slate-300">
																{r.email ?? <span className="text-slate-400">—</span>}
																{r.email_status && (
																	<span className="block mt-0.5">
																		<Badge color={emailTone(r.email_status)}>{EMAIL_STATUS_LABEL[r.email_status] ?? r.email_status}</Badge>
																	</span>
																)}
															</td>
															<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400 max-w-40">{(r.beats ?? []).join(', ') || '—'}</td>
															<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400 max-w-64">
																{evidence.length === 0 ? (
																	r.source_url ? (
																		<a href={r.source_url} target="_blank" rel="noreferrer" className="hover:text-primary-600 truncate block">
																			source ↗
																		</a>
																	) : (
																		'—'
																	)
																) : (
																	<ul className="space-y-0.5">
																		{evidence.map((e, i) => (
																			<li key={`${r.id}-${i}`} className="truncate">
																				{e.url ? (
																					<a href={e.url} target="_blank" rel="noreferrer" className="hover:text-primary-600" title={e.title ?? e.url}>
																						{e.title ?? e.url}
																					</a>
																				) : (
																					e.title
																				)}
																				{e.date && <span className="ml-1 text-slate-400">{String(e.date).slice(0, 10)}</span>}
																			</li>
																		))}
																	</ul>
																)}
															</td>
														</tr>
													);
												})}
											</tbody>
										</table>
									</div>
									<div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
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
											Approved journalists become Contacts with the journalist role; &quot;already known&quot; rows update the existing contact
											instead of adding one.
										</span>
										{pageCount > 1 && (
											<span className="ml-auto flex items-center gap-1 shrink-0">
												{page > 1 ? (
													<Link href={pageHref(page - 1)} className="px-2 py-1 text-2xs rounded-md text-slate-600 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
														← Prev
													</Link>
												) : (
													<span className="px-2 py-1 text-2xs text-slate-300 dark:text-slate-600">← Prev</span>
												)}
												<span className="px-1 text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
													{page} / {pageCount}
												</span>
												{page < pageCount ? (
													<Link href={pageHref(page + 1)} className="px-2 py-1 text-2xs rounded-md text-slate-600 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
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
