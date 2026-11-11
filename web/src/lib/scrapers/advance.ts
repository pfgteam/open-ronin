// The scrape_jobs state machine, shared by the cron and the "Run now" button.
//
// Lives here rather than inside the cron route because Vercel cron only fires
// on PRODUCTION deployments — on localhost nothing advances a queued job, so
// development was impossible without a second caller. An admin waiting on a
// run in production has the same problem at a smaller scale (up to 5 minutes
// of nothing).
//
//   queued    -> start the Apify run, store apify_run_id            -> running
//   running   -> poll the run; SUCCEEDED -> importing, else failed
//   importing -> fetch ONE page, upsert, advance the cursor          -> done
//
// Every step is bounded and RESUMABLE: cursor_offset records how far the
// import got, and the unique (job_id, dedup_key) from 0041 means a page
// processed twice inserts nothing the second time.
//
// Callers pass a SERVICE-ROLE client: this writes staging rows on nobody's
// behalf, and 0041 deliberately has no INSERT policy for authenticated users
// so a person cannot plant rows into a review queue. Both callers gate
// themselves first — CRON_SECRET for the cron, can_run_scrapers() for the UI.

import type { createServiceRoleClient } from '@/lib/supabase/server';
import { ACTOR_ID, buildActorInput, type LeadParams } from '@/lib/scrapers/leadPreset';
import { normalizePage } from '@/lib/scrapers/normalizeLead';
import {
	TRADE_SHOW_ACTOR,
	buildTradeShowInput,
	normalizeExhibitorPage,
	type TradeShowParams,
} from '@/lib/scrapers/tradeShowPreset';
import {
	LINKEDIN_ACTOR,
	buildLinkedinInput,
	type LinkedinParams,
} from '@/lib/scrapers/linkedinPreset';
import { normalizeLinkedinPage } from '@/lib/scrapers/normalizeLinkedin';
import {
	ACQUISITION_ACTOR,
	buildAcquisitionInput,
	normalizeAcquisitionPage,
	type AcquisitionParams,
} from '@/lib/scrapers/acquisitionPreset';
import { TERMINAL_BAD, TERMINAL_OK, getDatasetItems, getRun, startRun } from '@/lib/scrapers/apify';
import {
	NEWS_JOURNALISTS_ACTOR,
	buildNewsJournalistsInput,
	normalizeNewsJournalistPage,
	type MediaRecord,
	type NewsJournalistsParams,
} from '@/lib/scrapers/newsJournalistsPreset';
import {
	EMAIL_WATERFALL_ACTOR,
	buildEmailWaterfallInput,
	normalizeEmailWaterfallPage,
	type EmailWaterfallParams,
} from '@/lib/scrapers/emailWaterfallPreset';
import {
	OUTLET_CRAWL_ACTOR,
	buildOutletCrawlInput,
	normalizeOutletCrawlPage,
	type OutletCrawlParams,
} from '@/lib/scrapers/outletCrawlPreset';

/** The three media presets (0102). Their rows go through importMediaPage. */
export const MEDIA_PRESETS = ['news_journalists', 'email_waterfall', 'outlet_crawl'] as const;
export function isMediaPreset(preset: string): boolean {
	return (MEDIA_PRESETS as readonly string[]).includes(preset);
}

/** Jobs touched per state per tick — keeps one tick predictable. */
const JOBS_PER_TICK = 3;
/** Dataset rows imported per tick per job. */
const PAGE_SIZE = 250;
/** A run that never reaches a terminal state must not poll forever. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** The 0072 budget guard raises with this prefix; anything else is a real error. */
export const BUDGET_CAP_PREFIX = 'SCRAPER_BUDGET_CAP:';

interface JobRow {
	id: string;
	preset: string;
	params: LeadParams;
	max_results: number;
	status: string;
	apify_run_id: string | null;
	apify_dataset_id: string | null;
	cursor_offset: number;
	imported: number;
	duplicates: number;
	started_at: string | null;
}

type Db = ReturnType<typeof createServiceRoleClient>;

async function fail(db: Db, id: string, message: string) {
	console.error(`[cron/scrapers] job ${id} failed: ${message}`);
	await db
		.from('scrape_jobs')
		.update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() })
		.eq('id', id);
}

/** queued -> running */
async function dispatch(db: Db, job: JobRow): Promise<string> {
	// CLAIM BEFORE STARTING. Two ticks can overlap — the Vercel cron and
	// someone pressing "Run now", or two people pressing it at once — and both
	// would read the same queued job.
	//
	// This used to call startRun() first and claim afterwards, with the claim's
	// `.eq('status','queued')` described as the thing that stops us paying
	// twice. It did not: by then BOTH ticks had already asked Apify to start a
	// run, so Apify was billing for two, and the loser's run was orphaned —
	// still executing, still costing, with no apify_run_id stored for anyone to
	// abort it.
	//
	// Claiming first makes the database the arbiter. The UPDATE ... WHERE
	// status = 'queued' is atomic, so exactly one tick gets rows back; the loser
	// gets zero and returns without touching Apify at all.
	const { data: claimed, error: claimError } = await db
		.from('scrape_jobs')
		.update({ status: 'running', started_at: new Date().toISOString() })
		.eq('id', job.id)
		.eq('status', 'queued')
		.select('id');

	if (claimError) {
		// The budget guard (0072) raises on this UPDATE when month to date spend
		// plus this job's committed cost would pass the monthly cap. That is a
		// HOLD, not a failure: the job stays queued, the reason lands in `error`
		// so the page can show it, and the next tick tries again (the cap may
		// have been raised, or the month rolled over).
		if (claimError.message.includes(BUDGET_CAP_PREFIX)) {
			const reason = claimError.message.slice(claimError.message.indexOf(BUDGET_CAP_PREFIX) + BUDGET_CAP_PREFIX.length).trim();
			await db
				.from('scrape_jobs')
				.update({ error: `Held: ${reason}`.slice(0, 2000) })
				.eq('id', job.id)
				.eq('status', 'queued');
			return 'held: budget cap';
		}
		await fail(db, job.id, `could not claim: ${claimError.message}`);
		return 'failed to claim';
	}
	if (!claimed || claimed.length === 0) {
		// Another tick got there first. Not an error, and deliberately not a
		// fail() — the job is running, just not by us.
		return 'already claimed';
	}

	try {
		// Preset decides the actor AND the input shape. A switch rather than the
		// two-way boolean this used to be: with a third preset (0058) a boolean
		// silently routes anything unrecognised to the b2b actor, which spends
		// money on the wrong scrape.
		let actor: string;
		let input: Record<string, unknown>;
		switch (job.preset) {
			case 'trade_show':
				actor = TRADE_SHOW_ACTOR;
				input = buildTradeShowInput(job.params as unknown as TradeShowParams, job.max_results);
				break;
			case 'linkedin_search':
				actor = LINKEDIN_ACTOR;
				input = buildLinkedinInput((job.params ?? {}) as LinkedinParams, job.max_results);
				break;
			case 'b2b_database':
				actor = ACTOR_ID;
				input = buildActorInput((job.params ?? {}) as LeadParams, job.max_results);
				break;
			case 'agency_owners':
				// Acquisition preset (0060): the same b2b actor, agency-shaped
				// params. kind='acquisition' rows are fenced by RLS; the service
				// role here writes them like any other staging row.
				actor = ACQUISITION_ACTOR;
				input = buildAcquisitionInput((job.params ?? {}) as unknown as AcquisitionParams, job.max_results);
				break;
			// Media presets (0102). Same machine; the importer branches on
			// isMediaPreset() to write journalist/outlet-shaped rows.
			case 'news_journalists':
				actor = NEWS_JOURNALISTS_ACTOR;
				input = buildNewsJournalistsInput((job.params ?? {}) as unknown as NewsJournalistsParams, job.max_results);
				break;
			case 'email_waterfall':
				actor = EMAIL_WATERFALL_ACTOR;
				input = buildEmailWaterfallInput((job.params ?? {}) as unknown as EmailWaterfallParams, job.max_results);
				break;
			case 'outlet_crawl':
				actor = OUTLET_CRAWL_ACTOR;
				input = buildOutletCrawlInput((job.params ?? {}) as unknown as OutletCrawlParams, job.max_results);
				break;
			default:
				// The DB CHECK should make this unreachable; failing loudly beats
				// billing an Apify run against a guess.
				throw new Error(`Unknown scrape preset: ${job.preset}`);
		}
		const run = await startRun(actor, input);
		await db
			.from('scrape_jobs')
			.update({ apify_run_id: run.id, apify_dataset_id: run.defaultDatasetId })
			.eq('id', job.id);
		return `started ${run.id}`;
	} catch (e) {
		// We hold the claim, so this job is ours to fail. Without this the row
		// would sit in 'running' forever with no run id — poll() fails it on the
		// next tick, but only after a wasted cycle.
		await fail(db, job.id, e instanceof Error ? e.message : String(e));
		return 'failed to start';
	}
}

/** running -> importing | failed */
async function poll(db: Db, job: JobRow): Promise<string> {
	if (!job.apify_run_id) {
		await fail(db, job.id, 'running without an apify_run_id');
		return 'no run id';
	}
	try {
		const run = await getRun(job.apify_run_id);
		if (TERMINAL_OK.includes(run.status)) {
			await db
				.from('scrape_jobs')
				.update({ status: 'importing', apify_dataset_id: run.defaultDatasetId ?? job.apify_dataset_id })
				.eq('id', job.id);
			return 'succeeded -> importing';
		}
		if (TERMINAL_BAD.includes(run.status)) {
			await fail(db, job.id, `Apify run ${run.status}`);
			return `run ${run.status}`;
		}
		// Still going. Guard against a run that never terminates.
		const startedMs = job.started_at ? Date.parse(job.started_at) : Date.now();
		if (Date.now() - startedMs > RUN_TIMEOUT_MS) {
			await fail(db, job.id, 'run exceeded the 30 minute ceiling');
			return 'timed out';
		}
		return `still ${run.status}`;
	} catch (e) {
		await fail(db, job.id, e instanceof Error ? e.message : String(e));
		return 'poll error';
	}
}

/**
 * Normalize one dataset page of a media preset into staging rows.
 * Pure: exported so mediaImport.test.ts can exercise the preset switch
 * without a database.
 */
export function normalizeMediaPage(
	preset: string,
	items: Record<string, unknown>[],
	params: Record<string, unknown> | null,
): { records: MediaRecord[]; skipped: number } {
	switch (preset) {
		case 'news_journalists':
			return normalizeNewsJournalistPage(items, (params ?? null) as NewsJournalistsParams | null);
		case 'email_waterfall':
			return normalizeEmailWaterfallPage(items, (params ?? null) as EmailWaterfallParams | null);
		case 'outlet_crawl':
			return normalizeOutletCrawlPage(items, (params ?? null) as OutletCrawlParams | null);
		default:
			throw new Error(`Not a media preset: ${preset}`);
	}
}

/**
 * Cross-run dedup for media rows (done test: "a rerun of the same beat marks
 * them duplicate"). A row is a duplicate when its dedup key — lower(email),
 * or the name+domain / domain fallback — already exists in an EARLIER media
 * staging row of any job, or (for emails) in contacts. Duplicates are still
 * staged, flagged, so the reviewer can see the rerun found the same people;
 * approving one becomes an update of the existing contact (0102 function).
 *
 * Exported for the test; the service-role client is the only caller in prod.
 */
export async function markMediaDuplicates(db: Db, jobId: string, records: MediaRecord[]): Promise<Set<string>> {
	const dupes = new Set<string>();
	if (records.length === 0) return dupes;
	const keys = [...new Set(records.map((r) => r.dedupKey))];
	const emails = [...new Set(records.map((r) => r.email).filter((e): e is string => !!e))];

	const { data: staged, error: stagedError } = await db
		.from('scraped_records')
		.select('dedup_key')
		.in('kind', ['media_contact', 'media_outlet'])
		.neq('job_id', jobId)
		.in('dedup_key', keys);
	if (stagedError) throw new Error(stagedError.message);
	for (const row of staged ?? []) dupes.add(row.dedup_key as string);

	if (emails.length > 0) {
		const { data: existing, error: contactsError } = await db.from('contacts').select('email').in('email', emails);
		if (contactsError) throw new Error(contactsError.message);
		const known = new Set((existing ?? []).map((c) => String(c.email).toLowerCase()));
		for (const r of records) if (r.email && known.has(r.email)) dupes.add(r.dedupKey);
	}
	return dupes;
}

/** Media presets: importing -> importing | done. Shares the cursor discipline
 *  of importPage; only the row shape and the dedup differ. */
async function importMediaPage(db: Db, job: JobRow, items: Record<string, unknown>[], limit: number): Promise<string> {
	const { records, skipped } = normalizeMediaPage(job.preset, items, (job.params ?? null) as Record<string, unknown> | null);
	let inserted = 0;
	if (records.length > 0) {
		const dupes = await markMediaDuplicates(db, job.id, records);
		const { data, error } = await db
			.from('scraped_records')
			.upsert(
				records.map((r) => ({
					job_id: job.id,
					kind: r.kind,
					dedup_key: r.dedupKey,
					dedup_status: dupes.has(r.dedupKey) ? 'duplicate' : 'new',
					full_name: r.fullName,
					first_name: r.firstName,
					last_name: r.lastName,
					email: r.email,
					email_status: r.emailStatus,
					job_title: r.jobTitle,
					linkedin_url: r.linkedinUrl,
					outlet_name: r.outletName,
					outlet_domain: r.outletDomain,
					company_name: r.outletName,
					company_domain: r.outletDomain,
					company_website: r.companyWebsite,
					company_linkedin: r.companyLinkedin,
					beats: r.beats,
					evidence: r.evidence,
					source_url: r.sourceUrl,
					raw: r.raw,
				})),
				{ onConflict: 'job_id,dedup_key', ignoreDuplicates: true },
			)
			.select('id');
		if (error) throw new Error(error.message);
		inserted = data?.length ?? 0;
	}

	const nextOffset = job.cursor_offset + items.length;
	const drained = items.length < limit;
	await db
		.from('scrape_jobs')
		.update({
			cursor_offset: nextOffset,
			found: nextOffset,
			imported: job.imported + inserted,
			duplicates: job.duplicates + (records.length - inserted) + skipped,
			...(drained ? { status: 'done', finished_at: new Date().toISOString() } : {}),
		})
		.eq('id', job.id);
	return `media page ${job.cursor_offset}-${nextOffset}: +${inserted}${drained ? ' -> done' : ''}`;
}

/** importing -> importing | done */
async function importPage(db: Db, job: JobRow): Promise<string> {
	if (!job.apify_dataset_id) {
		await fail(db, job.id, 'importing without a dataset id');
		return 'no dataset';
	}
	try {
		// Never read past the ceiling the job was queued with, even if the actor
		// produced more than asked.
		const remaining = Math.max(0, job.max_results - job.cursor_offset);
		if (remaining === 0) {
			await db
				.from('scrape_jobs')
				.update({ status: 'done', finished_at: new Date().toISOString() })
				.eq('id', job.id);
			return 'ceiling reached -> done';
		}

		const limit = Math.min(PAGE_SIZE, remaining);
		const items = await getDatasetItems(job.apify_dataset_id, job.cursor_offset, limit);

		if (items.length === 0) {
			await db
				.from('scrape_jobs')
				.update({ status: 'done', finished_at: new Date().toISOString() })
				.eq('id', job.id);
			return 'drained -> done';
		}

		// Each preset's output shape gets its own mapper and its own dedup key —
		// a LinkedIn profile often has neither an email nor a company, which the
		// shared lead key treats as "no identity" and drops.
		if (isMediaPreset(job.preset)) {
			return await importMediaPage(db, job, items, limit);
		}
		const { leads, skipped } =
			job.preset === 'trade_show'
				? normalizeExhibitorPage(items, (job.params as unknown as TradeShowParams)?.url ?? '')
				: job.preset === 'linkedin_search'
					? normalizeLinkedinPage(items)
					: job.preset === 'agency_owners'
						? normalizeAcquisitionPage(items, (job.params ?? {}) as unknown as AcquisitionParams)
						: normalizePage(items);
		let inserted = 0;
		if (leads.length > 0) {
			const { data, error } = await db
				.from('scraped_records')
				.upsert(
					leads.map((l) => ({
						job_id: job.id,
						dedup_key: l.dedupKey,
						full_name: l.fullName,
						first_name: l.firstName,
						last_name: l.lastName,
						email: l.email,
						personal_email: l.personalEmail,
						mobile_phone: l.mobilePhone,
						company_phone: l.companyPhone,
						linkedin_url: l.linkedinUrl,
						job_title: l.jobTitle,
						headline: l.headline,
						seniority: l.seniority,
						function_area: l.functionArea,
						location: l.location,
						company_name: l.companyName,
						company_domain: l.companyDomain,
						company_website: l.companyWebsite,
						company_linkedin: l.companyLinkedin,
						company_industry: l.companyIndustry,
						company_size: l.companySize,
						company_revenue: l.companyRevenue,
						company_funding: l.companyFunding,
						company_founded_year: l.companyFoundedYear,
						company_description: l.companyDescription,
						company_keywords: l.companyKeywords,
						company_technologies: l.companyTechnologies,
						company_city: l.companyCity,
						company_state: l.companyState,
						company_country: l.companyCountry,
						company_postal_code: l.companyPostalCode,
						company_address: l.companyAddress,
						booth: l.booth,
						booth_size: l.boothSize,
						source_url: l.sourceUrl,
						// 0060 firm columns. Null for every non-acquisition preset.
						agency_services: 'agencyServices' in l ? l.agencyServices : null,
						owner_signal: 'ownerSignal' in l ? l.ownerSignal : null,
						raw: l.raw,
					})),
					{ onConflict: 'job_id,dedup_key', ignoreDuplicates: true },
				)
				.select('id');
			if (error) throw new Error(error.message);
			inserted = data?.length ?? 0;
		}

		// Advance by items READ, not by rows inserted — the cursor is a position
		// in the dataset, and conflating the two would re-read forever.
		const nextOffset = job.cursor_offset + items.length;
		const drained = items.length < limit;
		await db
			.from('scrape_jobs')
			.update({
				cursor_offset: nextOffset,
				found: nextOffset,
				imported: job.imported + inserted,
				duplicates: job.duplicates + (leads.length - inserted) + skipped,
				...(drained ? { status: 'done', finished_at: new Date().toISOString() } : {}),
			})
			.eq('id', job.id);

		return `page ${job.cursor_offset}-${nextOffset}: +${inserted}${drained ? ' -> done' : ''}`;
	} catch (e) {
		await fail(db, job.id, e instanceof Error ? e.message : String(e));
		return 'import error';
	}
}

export interface AdvanceLog {
	queued: string[];
	running: string[];
	importing: string[];
	touched: number;
}

/** Advance up to JOBS_PER_TICK jobs in each state. One bounded pass. */
export async function advanceScrapeJobs(db: Db): Promise<AdvanceLog> {
	const log: AdvanceLog = { queued: [], running: [], importing: [], touched: 0 };

	for (const status of ['queued', 'running', 'importing'] as const) {
		const { data, error } = await db
			.from('scrape_jobs')
			.select(
				'id, preset, params, max_results, status, apify_run_id, apify_dataset_id, cursor_offset, imported, duplicates, started_at',
			)
			.eq('status', status)
			.order('created_at')
			.limit(JOBS_PER_TICK);
		if (error) {
			console.error(`[scrapers] reading ${status} jobs: ${error.message}`);
			continue;
		}
		for (const job of (data ?? []) as JobRow[]) {
			const outcome =
				status === 'queued'
					? await dispatch(db, job)
					: status === 'running'
						? await poll(db, job)
						: await importPage(db, job);
			log[status].push(`${job.id.slice(0, 8)}: ${outcome}`);
		}
	}

	log.touched = log.queued.length + log.running.length + log.importing.length;
	if (log.touched > 0) console.log('[scrapers]', JSON.stringify(log));
	return log;
}
