'use server';

// Server actions for the Lead Scraper. RLS (0041) is the authority — admin/exec
// only, via can_run_scrapers(). These actions validate shape with zod, let the
// database decide authorization, and audit every write.
//
// The params the user picks are validated against the ACTOR's real enums
// (lib/scrapers/leadPreset), so a filter that would be silently ignored by the
// actor — and therefore billed for the wrong leads — cannot be saved.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { advanceScrapeJobs } from '@/lib/scrapers/advance';
import { abortRun } from '@/lib/scrapers/apify';
import {
	isValidShowUrl,
	type TradeShowParams,
} from '@/lib/scrapers/tradeShowPreset';
import {
	COMPANY_SIZE,
	EMAIL_STATUS,
	FUNCTION_AREA,
	INDUSTRY,
	LOCATION,
	PRESET,
	REVENUE,
	SENIORITY,
	hasTargeting,
	type LeadParams,
} from '@/lib/scrapers/leadPreset';
import {
	COMPANY_HEADCOUNT as LI_HEADCOUNT,
	FUNCTION_AREA as LI_FUNCTION,
	INDUSTRY as LI_INDUSTRY,
	SCRAPER_MODES,
	SENIORITY as LI_SENIORITY,
	YEARS_EXPERIENCE as LI_YEARS,
	hasTargeting as hasLinkedinTargeting,
	type LinkedinParams,
} from '@/lib/scrapers/linkedinPreset';
import {
	ACQUISITION_KIND,
	ACQUISITION_PRESET,
	EMPLOYEE_CEILING,
	SERVICES,
	TITLE_SET,
	hasAcquisitionTargeting,
	type AcquisitionParams,
} from '@/lib/scrapers/acquisitionPreset';

const PATH = '/media/lead-scraper';

// Free-text arrays stay short: they become actor filters, not prose.
const freeList = z.array(z.string().trim().min(1).max(80)).max(25).optional();

const paramsSchema = z.object({
	seniority: z.array(z.enum(SENIORITY)).max(SENIORITY.length).optional(),
	functionArea: z.array(z.enum(FUNCTION_AREA)).max(FUNCTION_AREA.length).optional(),
	industry: z.array(z.enum(INDUSTRY)).max(INDUSTRY.length).optional(),
	size: z.array(z.enum(COMPANY_SIZE)).max(COMPANY_SIZE.length).optional(),
	location: z.array(z.enum(LOCATION)).max(LOCATION.length).optional(),
	city: freeList,
	jobTitle: freeList,
	keywords: freeList,
	emailStatus: z.array(z.enum(EMAIL_STATUS)).max(3).optional(),
	minRevenue: z.enum(REVENUE).optional(),
	maxRevenue: z.enum(REVENUE).optional(),
});

// Mirrors the CHECK in 0041. The database is the real ceiling; this is the
// friendly error before it.
const maxResultsSchema = z.coerce.number().int().min(1).max(5000);

/** Multi-selects arrive as repeated form fields; free lists as one textarea. */
function list(fd: FormData, key: string): string[] | undefined {
	const all = fd.getAll(key).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
	return all.length > 0 ? all : undefined;
}
function lines(fd: FormData, key: string): string[] | undefined {
	const raw = fd.get(key);
	if (typeof raw !== 'string') return undefined;
	const parts = raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

export async function createJob(formData: FormData): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	const parsedMax = maxResultsSchema.safeParse(formData.get('max_results'));
	if (!parsedMax.success) throw new Error('Max results must be between 1 and 5000.');

	const parsed = paramsSchema.safeParse({
		seniority: list(formData, 'seniority'),
		functionArea: list(formData, 'functionArea'),
		industry: list(formData, 'industry'),
		size: list(formData, 'size'),
		location: list(formData, 'location'),
		emailStatus: list(formData, 'emailStatus'),
		city: lines(formData, 'city'),
		jobTitle: lines(formData, 'jobTitle'),
		keywords: lines(formData, 'keywords'),
		minRevenue: (formData.get('minRevenue') as string) || undefined,
		maxRevenue: (formData.get('maxRevenue') as string) || undefined,
	});
	if (!parsed.success) {
		throw new Error(`Invalid filters: ${parsed.error.issues[0]?.message ?? 'unknown field'}`);
	}
	const params = parsed.data as LeadParams;

	// A job with no targeting would bill for an arbitrary slice of a 250M-row
	// database. Refuse it here as well as in the UI.
	if (!hasTargeting(params)) {
		throw new Error('Pick at least one filter — an untargeted run bills for random leads.');
	}

	const { data, error } = await supabase
		.from('scrape_jobs')
		.insert({
			kind: 'lead',
			preset: PRESET,
			params,
			max_results: parsedMax.data,
			requested_by: auth.user.id,
		})
		.select('id')
		.maybeSingle();
	if (error) {
		throw new Error(
			error.code === '42501' ? 'Only admins and execs can queue a scrape.' : error.message,
		);
	}

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/${data?.id}`,
		action: 'scraper.job.create',
	});
	revalidatePath(PATH);
}

/**
 * Queue a trade-show job: the pasted exhibitor-list URL IS the targeting, so
 * there are no ICP filters here.
 *
 * Same table, same cron, same review queue and same CSV as the database
 * preset — only `preset` differs, which is what tells the dispatcher which
 * actor to run.
 */
export async function createTradeShowJob(formData: FormData): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	const url = String(formData.get('show_url') ?? '').trim();
	if (!isValidShowUrl(url)) {
		throw new Error('Paste the full http(s) URL of the exhibitor list page.');
	}

	const parsedMax = maxResultsSchema.safeParse(formData.get('max_results'));
	if (!parsedMax.success) throw new Error('Max exhibitors must be between 1 and 5000.');

	const params: TradeShowParams = {
		url,
		// Free lookup against the actor's historical email DB — on by default
		// because an exhibitor row without a contact is barely a lead.
		lookupEmails: formData.get('lookup_emails') !== null,
		boothSizes: formData.get('booth_sizes') !== null,
	};

	const { data, error } = await supabase
		.from('scrape_jobs')
		.insert({
			kind: 'lead',
			preset: 'trade_show',
			params,
			max_results: parsedMax.data,
			requested_by: auth.user.id,
		})
		.select('id')
		.maybeSingle();
	if (error) {
		throw new Error(
			error.code === '42501'
				? 'Only admins and execs can queue a scrape.'
				: error.code === '23514'
					? 'The trade-show preset is not enabled yet — migration 0048 has not been applied.'
					: error.message,
		);
	}

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/${data?.id}`,
		action: 'scraper.job.create.trade_show',
	});
	revalidatePath(PATH);
}

/**
 * Queue a LinkedIn profile-search job.
 *
 * The option ids are validated against the ACTOR's own enums (curated slice in
 * linkedinPreset), so a filter the actor would silently ignore — and therefore
 * bill for the wrong profiles — cannot be saved. The scrape MODE is part of the
 * form because it changes the price per profile ($0.004 vs $0.010).
 */
export async function createLinkedinJob(formData: FormData): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	const parsedMax = maxResultsSchema.safeParse(formData.get('max_results'));
	if (!parsedMax.success) throw new Error('Max profiles must be between 1 and 5000.');

	const ids = (options: readonly { value: string }[]) =>
		z.array(z.enum(options.map((o) => o.value) as [string, ...string[]])).max(options.length).optional();

	const parsed = z
		.object({
			mode: z.enum(SCRAPER_MODES).optional(),
			searchQuery: z.string().trim().max(200).optional(),
			seniority: ids(LI_SENIORITY),
			functionArea: ids(LI_FUNCTION),
			industry: ids(LI_INDUSTRY),
			headcount: ids(LI_HEADCOUNT),
			yearsExperience: ids(LI_YEARS),
			locations: freeList,
			currentJobTitles: freeList,
			currentCompanies: freeList,
			schools: freeList,
		})
		.safeParse({
			mode: (formData.get('mode') as string) || undefined,
			searchQuery: (formData.get('searchQuery') as string) || undefined,
			seniority: list(formData, 'li_seniority'),
			functionArea: list(formData, 'li_functionArea'),
			industry: list(formData, 'li_industry'),
			headcount: list(formData, 'li_headcount'),
			yearsExperience: list(formData, 'li_yearsExperience'),
			locations: lines(formData, 'li_locations'),
			currentJobTitles: lines(formData, 'li_jobTitles'),
			currentCompanies: lines(formData, 'li_companies'),
			schools: lines(formData, 'li_schools'),
		});
	if (!parsed.success) {
		throw new Error(`Invalid filters: ${parsed.error.issues[0]?.message ?? 'unknown field'}`);
	}
	const params = parsed.data as LinkedinParams;

	// An untargeted run bills for an arbitrary slice of LinkedIn.
	if (!hasLinkedinTargeting(params)) {
		throw new Error(
			'Add a search query or pick at least one filter — an untargeted run bills for random profiles.',
		);
	}

	const { data, error } = await supabase
		.from('scrape_jobs')
		.insert({
			kind: 'lead',
			preset: 'linkedin_search',
			params,
			max_results: parsedMax.data,
			requested_by: auth.user.id,
		})
		.select('id')
		.maybeSingle();
	if (error) {
		throw new Error(
			error.code === '42501'
				? 'Only admins and execs can queue a scrape.'
				: error.code === '23514'
					? 'The LinkedIn preset is not enabled yet — migration 0058 has not been applied.'
					: error.message,
		);
	}

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/${data?.id}`,
		action: 'scraper.job.create.linkedin_search',
	});
	revalidatePath(PATH);
}

/**
 * Queue an acquisition job (kind 'acquisition', preset 'agency_owners', 0060).
 *
 * The only gate is the `acquisitions` capability, enforced by RLS through
 * can_access_scrape_kind('acquisition') on the insert — deliberately no
 * is_admin() check here or anywhere in this slice. The params are validated
 * against the fixed vocabularies in acquisitionPreset so a hand-edited form
 * cannot reach the actor with a filter it ignores (and bills for).
 */
export async function createAcquisitionJob(formData: FormData): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	const parsedMax = maxResultsSchema.safeParse(formData.get('max_results'));
	if (!parsedMax.success) throw new Error('Max records must be between 1 and 5000.');

	const employees = z.coerce.number().int().min(1).max(EMPLOYEE_CEILING);
	const parsed = z
		.object({
			services: z.array(z.enum(SERVICES)).max(SERVICES.length).optional(),
			employeeMin: employees.optional(),
			employeeMax: employees.optional(),
			location: z.array(z.enum(LOCATION)).max(LOCATION.length).optional(),
			city: freeList,
			titles: z.array(z.enum(TITLE_SET)).max(TITLE_SET.length).optional(),
			minYears: z.coerce.number().int().min(0).max(150).optional(),
		})
		.safeParse({
			services: list(formData, 'acq_services'),
			employeeMin: (formData.get('acq_employeeMin') as string) || undefined,
			employeeMax: (formData.get('acq_employeeMax') as string) || undefined,
			location: list(formData, 'acq_location'),
			city: lines(formData, 'acq_city'),
			titles: list(formData, 'acq_titles'),
			minYears: (formData.get('acq_minYears') as string) || undefined,
		});
	if (!parsed.success) {
		throw new Error(`Invalid filters: ${parsed.error.issues[0]?.message ?? 'unknown field'}`);
	}
	const params = parsed.data as AcquisitionParams;
	if (params.employeeMin !== undefined && params.employeeMax !== undefined && params.employeeMin > params.employeeMax) {
		throw new Error('Employee range: the minimum is above the maximum.');
	}
	if (!hasAcquisitionTargeting(params)) {
		throw new Error('Pick a location or a city — the rollup buys in specific markets, and a worldwide pull bills for firms nobody will call.');
	}

	const { data, error } = await supabase
		.from('scrape_jobs')
		.insert({
			kind: ACQUISITION_KIND,
			preset: ACQUISITION_PRESET,
			params,
			max_results: parsedMax.data,
			requested_by: auth.user.id,
		})
		.select('id')
		.maybeSingle();
	if (error) {
		throw new Error(
			error.code === '42501'
				? 'You do not hold the acquisitions capability.'
				: error.code === '23514'
					? 'The acquisition preset is not enabled yet — migration 0060 has not been applied.'
					: error.message,
		);
	}

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/${data?.id}`,
		action: 'scraper.job.create.agency_owners',
	});
	revalidatePath(PATH);
}

/** The scraped_records columns an acquisition approval carries across. */
const ACQUISITION_SOURCE_COLUMNS =
	'id, status, job_id, full_name, job_title, email, personal_email, mobile_phone, company_phone, linkedin_url, company_name, company_website, company_domain, agency_services, company_size, company_founded_year, company_revenue, company_city, company_state, company_country, owner_signal, scrape_jobs!inner(kind)';

interface AcquisitionSourceRow {
	id: string;
	status: string;
	full_name: string | null;
	job_title: string | null;
	email: string | null;
	personal_email: string | null;
	mobile_phone: string | null;
	company_phone: string | null;
	linkedin_url: string | null;
	company_name: string | null;
	company_website: string | null;
	company_domain: string | null;
	agency_services: string | null;
	company_size: string | null;
	company_founded_year: string | null;
	company_revenue: string | null;
	company_city: string | null;
	company_state: string | null;
	company_country: string | null;
	owner_signal: string | null;
	scrape_jobs: { kind: string } | { kind: string }[] | null;
}

/**
 * Approve (or reject) acquisition rows.
 *
 * Approve is two sequential idempotent writes, the pattern the Sessions
 * accept flow uses (team/sessions/[id]/suggestionActions.ts): first insert
 * the target rows that do not exist yet — the unique partial index on
 * scraped_record_id (0060) makes re-approving a no-op — then mark the source
 * records approved. A crash between the two leaves a target row with a
 * still-pending record; the retry inserts nothing new and completes the
 * second write.
 *
 * Reads and writes run as the USER, so can_view_acquisitions() decides every
 * step: a caller without the capability sees zero source rows and gets the
 * explicit "nothing changed" error rather than a silent success.
 */
export async function reviewAcquisitionRecords(formData: FormData): Promise<void> {
	const decision = z.enum(['approved', 'rejected']).parse(formData.get('decision'));
	const ids = z.array(z.string().uuid()).min(1).max(500).parse(formData.getAll('record_id'));

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	if (decision === 'approved') {
		const { data: rows, error: readError } = await supabase
			.from('scraped_records')
			.select(ACQUISITION_SOURCE_COLUMNS)
			.in('id', ids)
			.eq('status', 'pending')
			.eq('scrape_jobs.kind', ACQUISITION_KIND);
		if (readError) throw new Error(readError.message);
		const source = (rows ?? []) as unknown as AcquisitionSourceRow[];
		if (source.length === 0) {
			throw new Error('Nothing changed — the records were already reviewed, are not acquisition rows, or you do not hold the acquisitions capability.');
		}

		// Field map is one to one with acquisition_targets (0060). company_name
		// is NOT NULL there; a firm with no name cannot be a target, so fall
		// back to the domain rather than fail the whole batch.
		const targets = source.map((r) => ({
			scraped_record_id: r.id,
			company_name: r.company_name ?? r.company_domain ?? 'Unknown firm',
			website: r.company_website ?? r.company_domain,
			owner_name: r.full_name,
			owner_title: r.job_title,
			email: r.email ?? r.personal_email,
			phone: r.mobile_phone ?? r.company_phone,
			linkedin_url: r.linkedin_url,
			agency_services: r.agency_services,
			employee_count: r.company_size,
			founded_year: r.company_founded_year,
			est_revenue: r.company_revenue,
			city: r.company_city,
			state: r.company_state,
			country: r.company_country,
			owner_signal: r.owner_signal,
			status: 'identified',
			created_by: auth.user.id,
		}));

		// Idempotency: skip records that already have a target row (a retry
		// after a crash between the two writes, or a double submit). This is a
		// read-then-insert rather than ON CONFLICT because the 0060 index is
		// PARTIAL (where scraped_record_id is not null) and PostgREST's
		// onConflict emits a bare column list Postgres cannot infer a partial
		// index from ("no unique or exclusion constraint matching the ON
		// CONFLICT specification"). The index still backstops a race: a
		// concurrent duplicate fails with 23505 and is treated as already done.
		const { data: existing, error: existingError } = await supabase
			.from('acquisition_targets')
			.select('scraped_record_id')
			.in('scraped_record_id', source.map((r) => r.id));
		if (existingError) throw new Error(existingError.message);
		const already = new Set((existing ?? []).map((e) => e.scraped_record_id as string));
		const fresh = targets.filter((t) => !already.has(t.scraped_record_id));

		if (fresh.length > 0) {
			const { error: insertError } = await supabase.from('acquisition_targets').insert(fresh);
			if (insertError && insertError.code !== '23505') {
				throw new Error(
					insertError.code === '42501'
						? 'You do not hold the acquisitions capability.'
						: `Could not create acquisition targets: ${insertError.message}`,
				);
			}
		}
	}

	const { data: moved, error } = await supabase
		.from('scraped_records')
		.update({ status: decision, reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() })
		.in('id', ids)
		.eq('status', 'pending')
		.select('id');
	if (error) throw new Error(error.message);
	if (!moved || moved.length === 0) {
		throw new Error('Nothing changed — the records were already reviewed, or you do not hold the acquisitions capability.');
	}

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `acquisition_targets/${moved.length}`,
		action: `acquisitions.review.${decision}`,
	});
	revalidatePath(PATH);

	if (moved.length < ids.length) {
		throw new Error(
			`${moved.length} of ${ids.length} were ${decision} — the rest had already been reviewed by someone else. Reload to see the current state.`,
		);
	}
}

/** Approve or reject a batch of staged records. */
export async function reviewRecords(formData: FormData): Promise<void> {
	const decision = z.enum(['approved', 'rejected']).parse(formData.get('decision'));
	const ids = z.array(z.string().uuid()).min(1).max(500).parse(formData.getAll('record_id'));

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	const { data: moved, error } = await supabase
		.from('scraped_records')
		.update({ status: decision, reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() })
		.in('id', ids)
		// Only pending rows move, so a double submit cannot flip an earlier decision.
		.eq('status', 'pending')
		.select('id');
	if (error) throw new Error(error.message);
	// Zero rows means RLS filtered the update out (or everything was already
	// reviewed) — without this check a non-admin's Approve/Reject reports
	// success while changing nothing.
	if (!moved || moved.length === 0) {
		throw new Error('Nothing changed — the records were already reviewed, or only admins/execs can review.');
	}
	// Audit and revalidate BEFORE the partial-batch warning below. Those rows
	// really did move, so they must be audited and the screen must refresh even
	// when we go on to tell the operator the batch was not wholly theirs — a
	// throw above these would leave a real write unaudited and the page stale.
	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scraped_records/${moved.length}`,
		action: `scraper.review.${decision}`,
	});
	revalidatePath(PATH);

	// 0156: approved lead rows enter Prospects (Lead Gen → Sourced) when the
	// apify_scraper connector is on. A failure here never undoes the approval:
	// the rows stay approved and unsent, and Admin → Prospects → Connectors
	// sends the backlog.
	if (decision === 'approved') {
		const { data: sent, error: sendErr } = await supabase.rpc('rev_intake_scraped', { p_ids: moved.map((m) => m.id) });
		if (sendErr) console.error('rev_intake_scraped failed', sendErr.message);
		else if ((sent as { sent?: number } | null)?.sent) revalidatePath('/prospects', 'layout');
	}

	// A PARTIAL move means someone else reviewed part of this batch between the
	// page render and the submit — now that the scraper is not admin-only, two
	// people can sit on the same run. The .eq('status','pending') above already
	// protects the data (an earlier decision is never overwritten); what was
	// missing is telling the second reviewer, who would otherwise believe they
	// approved 50 leads when they approved 30.
	if (moved.length < ids.length) {
		throw new Error(
			`${moved.length} of ${ids.length} were ${decision} — the rest had already been reviewed by someone else. Reload to see the current state.`,
		);
	}
}

/** Cancel a job that has not started importing yet. */
export async function cancelJob(formData: FormData): Promise<void> {
	const id = z.string().uuid().parse(formData.get('job_id'));
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	// .select() so an RLS denial is visible: an UPDATE the policy filters out
	// affects zero rows and otherwise reports success — a non-admin clicking
	// Cancel would see the button work and nothing happen.
	const { data: cancelled, error } = await supabase
		.from('scrape_jobs')
		.update({ status: 'cancelled', finished_at: new Date().toISOString() })
		.eq('id', id)
		.in('status', ['queued', 'running'])
		.select('apify_run_id');
	if (error) throw new Error(error.message);
	if (!cancelled || cancelled.length === 0) {
		throw new Error('Nothing cancelled — the job already finished, or only admins/execs can cancel jobs.');
	}

	// Cancelling the row without aborting the run would keep the Apify actor
	// running (and billing) to fill a dataset nobody will import.
	const runId = cancelled[0].apify_run_id as string | null;
	if (runId) await abortRun(runId);

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/${id}`,
		action: 'scraper.job.cancel',
	});
	revalidatePath(PATH);
}

/**
 * Advance the queue right now, instead of waiting for the cron.
 *
 * Vercel cron only fires on production deployments, so on localhost nothing
 * ever moves a queued job — this is what makes local development possible at
 * all. In production it also saves an admin from staring at a `queued` row for
 * up to five minutes.
 *
 * Runs the SAME state machine as /api/cron/scrapers (lib/scrapers/advance), so
 * there is no second implementation to drift. Gated on can_run_scrapers()
 * before touching the service-role client: the machine writes staging rows,
 * which no authenticated user may insert directly (0041).
 */
export async function advanceNow(): Promise<void> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) throw new Error('Not signed in.');

	// Ask the database, not our own role guess — same gates the policies use.
	// Either scraper capability may advance the shared queue: the machine is
	// kind-agnostic and RLS still fences what each caller can subsequently read.
	const [{ data: leads, error: gateError }, { data: acquisitions }] = await Promise.all([
		supabase.rpc('can_run_scrapers'),
		supabase.rpc('can_view_acquisitions'),
	]);
	if (gateError) throw new Error(gateError.message);
	if (leads !== true && acquisitions !== true) throw new Error('You do not hold a scraper capability.');

	if (!process.env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is not set on this environment.');

	const log = await advanceScrapeJobs(createServiceRoleClient());

	void recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `scrape_jobs/advance/${log.touched}`,
		action: 'scraper.queue.advance',
	});
	revalidatePath(PATH);
}
