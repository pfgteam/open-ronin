'use server';

// Server actions for the Media Scraper (0102). Same discipline as the Lead
// Scraper's: zod on the FormData, RLS decides authorization (the media kind
// gate is can_review_media_records()), every write audited.
//
// Approve is DIFFERENT from the lead path: leads leave as CSV, media rows are
// merged into contacts / media_outlets / media_contact_profiles by the
// security definer function approve_media_records(uuid[]). One RPC, all or
// nothing, so a half-approved batch cannot exist.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { advanceScrapeJobs } from '@/lib/scrapers/advance';
import { abortRun } from '@/lib/scrapers/apify';
import {
	MAX_ARTICLES_PER_QUERY,
	MAX_FRESHNESS_DAYS,
	MAX_QUERIES,
	MEDIA_KIND,
	NEWS_JOURNALISTS_PRESET,
	hasNewsJournalistsTargeting,
	type NewsJournalistsParams,
} from '@/lib/scrapers/newsJournalistsPreset';
import {
	EMAIL_WATERFALL_PRESET,
	MAX_PEOPLE,
	parsePeopleLines,
	type EmailWaterfallParams,
	type WaterfallPerson,
} from '@/lib/scrapers/emailWaterfallPreset';
import {
	MAX_PAGES_PER_DOMAIN,
	MAX_WEBSITES,
	OUTLET_CRAWL_PRESET,
	parseWebsiteLines,
	type OutletCrawlParams,
} from '@/lib/scrapers/outletCrawlPreset';

const PATH = '/media/media-scraper';
const maxResultsSchema = z.coerce.number().int().min(1).max(5000);

function lines(fd: FormData, key: string): string[] {
	const raw = fd.get(key);
	if (typeof raw !== 'string') return [];
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function refusal(code: string | undefined, fallback: string): string {
	if (code === '42501') return 'You do not hold the review_media_records capability.';
	if (code === '23514') return 'The media presets are not enabled yet — migration 0102 has not been applied.';
	return fallback;
}

async function insertJob(preset: string, params: unknown, maxResults: number, action: string): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');
	const { data, error } = await supabase
		.from('scrape_jobs')
		.insert({ kind: MEDIA_KIND, preset, params, max_results: maxResults, requested_by: auth.user.id })
		.select('id')
		.maybeSingle();
	if (error) throw new Error(refusal(error.code, error.message));
	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/${data?.id}`,
		action,
	});
	revalidatePath(PATH);
}

/** Queue a Google News journalist search by beat(s). */
export async function createNewsJournalistsJob(formData: FormData): Promise<void> {
	const parsedMax = maxResultsSchema.safeParse(formData.get('max_results'));
	if (!parsedMax.success) throw new Error('Max rows must be between 1 and 5000.');
	const parsed = z
		.object({
			queries: z.array(z.string().trim().min(2).max(120)).min(1).max(MAX_QUERIES),
			freshnessDays: z.coerce.number().int().min(1).max(MAX_FRESHNESS_DAYS).optional(),
			maxArticlesPerQuery: z.coerce.number().int().min(1).max(MAX_ARTICLES_PER_QUERY).optional(),
			country: z.string().trim().length(2).optional(),
			language: z.string().trim().min(2).max(5).optional(),
			maxExtraPagesPerArticle: z.coerce.number().int().min(0).max(2).optional(),
			includeNoContact: z.boolean().optional(),
		})
		.safeParse({
			queries: lines(formData, 'queries'),
			freshnessDays: (formData.get('freshness_days') as string) || undefined,
			maxArticlesPerQuery: (formData.get('articles_per_query') as string) || undefined,
			country: (formData.get('country') as string) || undefined,
			language: (formData.get('language') as string) || undefined,
			maxExtraPagesPerArticle: (formData.get('extra_pages') as string) || undefined,
			includeNoContact: formData.get('include_no_contact') !== null,
		});
	if (!parsed.success) throw new Error(`Invalid search: ${parsed.error.issues[0]?.message ?? 'unknown field'}`);
	const params = parsed.data as NewsJournalistsParams;
	if (!hasNewsJournalistsTargeting(params)) throw new Error('Add at least one beat or topic.');
	await insertJob(NEWS_JOURNALISTS_PRESET, params, parsedMax.data, 'scraper.job.create.news_journalists');
}

/** Queue an email waterfall from pasted "First Last, domain" lines. */
export async function createEmailWaterfallJob(formData: FormData): Promise<void> {
	const raw = String(formData.get('people') ?? '');
	const people = parsePeopleLines(raw);
	if (people.length === 0) throw new Error('Paste at least one line as "First Last, outlet-domain.com".');
	const beats = lines(formData, 'beats').slice(0, 10);
	const params: EmailWaterfallParams = {
		people,
		beats: beats.length ? beats : undefined,
		checkWebsite: true,
		checkGitHub: formData.get('check_github') !== null,
		checkGravatar: true,
	};
	await insertJob(EMAIL_WATERFALL_PRESET, params, Math.min(people.length, MAX_PEOPLE), 'scraper.job.create.email_waterfall');
}

/**
 * The fallback chain (SCRAPERS_PLAN §4): from a finished news_journalists
 * run, take every staged journalist that has a first AND last name, an
 * outlet domain and NO email, and queue one email_waterfall job for them.
 * Reads run as the user, so RLS decides what is visible.
 */
export async function createWaterfallFromJob(formData: FormData): Promise<void> {
	const jobId = z.string().uuid().parse(formData.get('job_id'));
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	const { data: job, error: jobError } = await supabase
		.from('scrape_jobs')
		.select('id, kind, preset, params')
		.eq('id', jobId)
		.maybeSingle();
	if (jobError) throw new Error(jobError.message);
	if (!job || job.kind !== MEDIA_KIND) throw new Error('That run is not a media run.');

	const { data: rows, error } = await supabase
		.from('scraped_records')
		.select('id, first_name, last_name, outlet_domain, outlet_name, linkedin_url')
		.eq('job_id', jobId)
		.eq('kind', 'media_contact')
		.is('email', null)
		.in('status', ['pending', 'approved'])
		.limit(MAX_PEOPLE);
	if (error) throw new Error(error.message);

	const people: WaterfallPerson[] = [];
	const seen = new Set<string>();
	for (const r of rows ?? []) {
		if (!r.first_name || !r.last_name || !r.outlet_domain) continue;
		const key = `${r.first_name}|${r.last_name}|${r.outlet_domain}`.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		people.push({
			firstName: r.first_name,
			lastName: r.last_name,
			domain: r.outlet_domain,
			company: r.outlet_name ?? undefined,
			linkedinUrl: r.linkedin_url ?? undefined,
			sourceRecordId: r.id,
		});
	}
	if (people.length === 0) throw new Error('No journalists in that run are missing an email (or none have both a first and last name).');

	const sourceParams = (job.params ?? {}) as { queries?: string[] };
	const params: EmailWaterfallParams = {
		people,
		sourceJobId: jobId,
		beats: Array.isArray(sourceParams.queries) ? sourceParams.queries : undefined,
		checkWebsite: true,
		checkGitHub: false,
		checkGravatar: true,
	};
	await insertJob(EMAIL_WATERFALL_PRESET, params, people.length, 'scraper.job.create.email_waterfall.chained');
}

/** Queue a crawl of outlet websites for newsroom mailboxes. */
export async function createOutletCrawlJob(formData: FormData): Promise<void> {
	const websites = parseWebsiteLines(String(formData.get('websites') ?? ''));
	if (websites.length === 0) throw new Error('Paste at least one outlet domain.');
	const pages = z.coerce.number().int().min(1).max(MAX_PAGES_PER_DOMAIN).safeParse(formData.get('pages_per_domain') || 6);
	const beats = lines(formData, 'beats').slice(0, 10);
	const params: OutletCrawlParams = {
		websites,
		maxPagesPerDomain: pages.success ? pages.data : 6,
		includeSocials: true,
		includePhones: formData.get('include_phones') !== null,
		beats: beats.length ? beats : undefined,
	};
	await insertJob(OUTLET_CRAWL_PRESET, params, Math.min(websites.length, MAX_WEBSITES), 'scraper.job.create.outlet_crawl');
}

/**
 * Approve or reject a batch of media rows.
 *
 * Approve goes through approve_media_records() — the security definer
 * function in 0102 that upserts outlets, contacts (journalist role) and
 * profiles, and marks the rows. Reject is a plain status flip under RLS.
 */
export async function reviewMediaRecords(formData: FormData): Promise<void> {
	const decision = z.enum(['approved', 'rejected']).parse(formData.get('decision'));
	const ids = z.array(z.string().uuid()).min(1).max(500).parse(formData.getAll('record_id'));

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	if (decision === 'approved') {
		const { data, error } = await supabase.rpc('approve_media_records', { p_records: ids });
		if (error) {
			throw new Error(
				error.code === '42501' || /review_media_records/.test(error.message)
					? 'You do not hold the review_media_records capability.'
					: error.code === '42883' || /approve_media_records/.test(error.message)
						? 'Media approvals are not enabled yet — migration 0102 has not been applied.'
						: error.message,
			);
		}
		const result = (data ?? {}) as { approved?: number; contacts?: number; outlets?: number };
		void recordAudit({
			actor_id: auth.user.id,
			entity_kind: 'supabase',
			entity_ref: `scraped_records/${result.approved ?? 0}`,
			action: 'media_scraper.review.approved',
		});
		revalidatePath(PATH);
		revalidatePath('/media/outlets');
		revalidatePath('/media/members');
		return;
	}

	const { data: moved, error } = await supabase
		.from('scraped_records')
		.update({ status: 'rejected', reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() })
		.in('id', ids)
		.eq('status', 'pending')
		.select('id');
	if (error) throw new Error(error.message);
	if (!moved || moved.length === 0) {
		throw new Error('Nothing changed — the records were already reviewed, or you do not hold the review_media_records capability.');
	}
	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scraped_records/${moved.length}`,
		action: 'media_scraper.review.rejected',
	});
	revalidatePath(PATH);
	if (moved.length < ids.length) {
		throw new Error(`${moved.length} of ${ids.length} were rejected — the rest had already been reviewed by someone else. Reload to see the current state.`);
	}
}

/** Cancel a media job that has not started importing yet. */
export async function cancelMediaJob(formData: FormData): Promise<void> {
	const id = z.string().uuid().parse(formData.get('job_id'));
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');
	const { data: cancelled, error } = await supabase
		.from('scrape_jobs')
		.update({ status: 'cancelled', finished_at: new Date().toISOString() })
		.eq('id', id)
		.eq('kind', MEDIA_KIND)
		.in('status', ['queued', 'running'])
		.select('apify_run_id');
	if (error) throw new Error(error.message);
	if (!cancelled || cancelled.length === 0) throw new Error('Nothing cancelled — the job already finished, or you cannot cancel media jobs.');
	const runId = cancelled[0].apify_run_id as string | null;
	if (runId) await abortRun(runId);
	void recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `scrape_jobs/${id}`, action: 'media_scraper.job.cancel' });
	revalidatePath(PATH);
}

/** Advance the shared queue now (same machine as the cron and the Lead
 *  Scraper's button). Gated on the media capability. */
export async function advanceMediaNow(): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');
	const { data: allowed, error } = await supabase.rpc('can_review_media_records');
	if (error) throw new Error(error.code === '42883' ? 'Migration 0102 has not been applied.' : error.message);
	if (allowed !== true) throw new Error('You do not hold the review_media_records capability.');
	if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is not set on this environment.');
	const log = await advanceScrapeJobs(createServiceRoleClient());
	void recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `scrape_jobs/advance/${log.touched}`, action: 'media_scraper.queue.advance' });
	revalidatePath(PATH);
}
