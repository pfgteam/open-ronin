// The content_jobs state machine, shared by the cron and the "Run now"
// button (the advanceScrapeJobs pattern in lib/scrapers/advance.ts).
//
//   queued    -> claim, submit to the adapter. Sync vendors return a result
//                and the job goes straight to done; async vendors return a
//                providerRef and the job goes to submitted.
//   submitted -> poll the vendor; running while it works, done or failed.
//   running   -> same as submitted (kept for vendors that report progress).
//   done      -> assets downloaded into the content bucket, content_assets
//                rows written, output rewritten to bucket paths only.
//
// Every step is bounded: at most JOBS_PER_TICK jobs per state per tick, one
// vendor call per job per tick, a ceiling on how long an async job may run.
// The claim is an atomic UPDATE ... WHERE status = 'queued', so two
// overlapping ticks never submit the same job twice (the lesson 0041 paid
// for with duplicate Apify runs).
//
// Callers pass a SERVICE ROLE client. RLS on content_jobs has no update
// policy on purpose: the cron is the only writer past insert.

import type { createServiceRoleClient } from '@/lib/supabase/server';
import { callBytes } from './http';
import { getAdapter } from './registry';
import { ProviderError, type ContentAssetOut, type ContentJobInput, type ContentJobOutput, type ProviderAdapter } from './types';

export const CONTENT_BUCKET = 'content';
const JOBS_PER_TICK = 20;
/** An async vendor job that never terminates must not poll forever. */
const RUN_TIMEOUT_MS = 60 * 60 * 1000;
/** Largest single asset the cron will copy into the bucket. */
const MAX_ASSET_BYTES = 200 * 1024 * 1024;

type Db = ReturnType<typeof createServiceRoleClient>;

interface JobRow {
	id: string;
	capability: string;
	provider: string;
	input: ContentJobInput;
	status: string;
	provider_ref: string | null;
	submitted_at: string | null;
}

export interface ContentAdvanceLog {
	queued: string[];
	submitted: string[];
	running: string[];
	touched: number;
}

function errorText(e: unknown): string {
	if (e instanceof ProviderError) return e.message;
	if (e instanceof Error) return e.message;
	return String(e);
}

async function fail(db: Db, id: string, message: string) {
	console.error(`[content] job ${id} failed: ${message}`);
	await db.from('content_jobs').update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() }).eq('id', id);
}

const EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'audio/mpeg': 'mp3',
	'audio/wav': 'wav',
	'video/mp4': 'mp4',
	'application/pdf': 'pdf',
};

/**
 * Copies every asset with url or base64 into the content bucket, writes a
 * content_assets row each, and returns the output with only bucket paths.
 */
export async function persistOutput(db: Db, jobId: string, adapter: ProviderAdapter, output: ContentJobOutput): Promise<ContentJobOutput> {
	const persisted: ContentAssetOut[] = [];
	for (let i = 0; i < output.assets.length; i++) {
		const a = output.assets[i];
		let bytes: Uint8Array | null = null;
		let mime = a.mime;
		if (a.base64) {
			bytes = new Uint8Array(Buffer.from(a.base64, 'base64'));
		} else if (a.url) {
			const headers = adapter.downloadHeaders?.() ?? {};
			const got = await callBytes(adapter.spec.id, a.url, { headers, timeoutMs: 120_000 });
			bytes = got.bytes;
			if (!mime || mime === 'application/octet-stream') mime = got.mime;
		} else if (a.path) {
			persisted.push(a);
			continue;
		} else {
			continue;
		}
		if (bytes.length > MAX_ASSET_BYTES) throw new Error(`asset ${i} is ${bytes.length} bytes, over the ${MAX_ASSET_BYTES} ceiling`);
		const ext = EXT[mime] ?? 'bin';
		const path = `${adapter.spec.id}/${jobId}/${i + 1}.${ext}`;
		const { error: upErr } = await db.storage.from(CONTENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
		if (upErr) throw new Error(`upload ${path}: ${upErr.message}`);
		const row = {
			job_id: jobId,
			storage_path: path,
			mime,
			bytes: bytes.length,
			width: a.width ?? null,
			height: a.height ?? null,
			duration_seconds: a.durationSeconds ?? null,
			label: a.label ?? null,
		};
		const { error: rowErr } = await db.from('content_assets').insert(row);
		if (rowErr) throw new Error(`content_assets insert: ${rowErr.message}`);
		persisted.push({ path, mime, bytes: bytes.length, width: a.width, height: a.height, durationSeconds: a.durationSeconds, label: a.label });
	}
	return { assets: persisted, text: output.text, providerMeta: output.providerMeta };
}

async function finish(db: Db, job: JobRow, adapter: ProviderAdapter, output: ContentJobOutput): Promise<string> {
	const stored = await persistOutput(db, job.id, adapter, output);
	const actual = typeof output.providerMeta?.cost_usd === 'number' ? (output.providerMeta.cost_usd as number) : undefined;
	await db
		.from('content_jobs')
		.update({ status: 'done', output: stored, finished_at: new Date().toISOString(), ...(actual !== undefined ? { cost_usd: actual } : {}) })
		.eq('id', job.id);
	return `done (${stored.assets.length} assets)`;
}

/** queued -> submitted | done | failed */
async function submit(db: Db, job: JobRow): Promise<string> {
	const { data: claimed, error: claimError } = await db
		.from('content_jobs')
		.update({ status: 'submitted', submitted_at: new Date().toISOString() })
		.eq('id', job.id)
		.eq('status', 'queued')
		.select('id');
	if (claimError) {
		await fail(db, job.id, `could not claim: ${claimError.message}`);
		return 'failed to claim';
	}
	if (!claimed || claimed.length === 0) return 'already claimed';

	const adapter = getAdapter(job.provider);
	if (!adapter) {
		await fail(db, job.id, `Unknown provider ${job.provider}`);
		return 'unknown provider';
	}
	if (!adapter.isConfigured()) {
		await fail(db, job.id, `${adapter.spec.label} is not configured. Set ${adapter.spec.envKeys.join(', ')} in Vercel.`);
		return 'not configured';
	}
	try {
		const res = await adapter.submit(job.input);
		if ('result' in res) return await finish(db, job, adapter, res.result);
		await db.from('content_jobs').update({ provider_ref: res.providerRef }).eq('id', job.id);
		return `submitted ${res.providerRef}`;
	} catch (e) {
		await fail(db, job.id, errorText(e));
		return 'submit error';
	}
}

/** submitted | running -> running | done | failed */
async function poll(db: Db, job: JobRow): Promise<string> {
	const adapter = getAdapter(job.provider);
	if (!adapter?.poll) {
		await fail(db, job.id, `${job.provider} cannot be polled`);
		return 'no poll';
	}
	if (!job.provider_ref) {
		await fail(db, job.id, 'waiting on the vendor without a provider_ref');
		return 'no provider_ref';
	}
	try {
		const res = await adapter.poll(job.provider_ref);
		if (res.status === 'done') return await finish(db, job, adapter, res.result);
		if (res.status === 'failed') {
			await fail(db, job.id, res.error);
			return `vendor failed: ${res.error}`;
		}
		const startedMs = job.submitted_at ? Date.parse(job.submitted_at) : Date.now();
		if (Date.now() - startedMs > RUN_TIMEOUT_MS) {
			await fail(db, job.id, 'vendor job exceeded the 60 minute ceiling');
			return 'timed out';
		}
		if (job.status === 'submitted') await db.from('content_jobs').update({ status: 'running' }).eq('id', job.id);
		return 'still running';
	} catch (e) {
		await fail(db, job.id, errorText(e));
		return 'poll error';
	}
}

/** Advance up to JOBS_PER_TICK jobs in each state. One bounded pass. */
export async function advanceContentJobs(db: Db, onlyJobId?: string): Promise<ContentAdvanceLog> {
	const log: ContentAdvanceLog = { queued: [], submitted: [], running: [], touched: 0 };
	for (const status of ['queued', 'submitted', 'running'] as const) {
		let query = db
			.from('content_jobs')
			.select('id, capability, provider, input, status, provider_ref, submitted_at')
			.eq('status', status)
			.order('created_at')
			.limit(JOBS_PER_TICK);
		if (onlyJobId) query = query.eq('id', onlyJobId);
		const { data, error } = await query;
		if (error) {
			console.error(`[content] reading ${status} jobs: ${error.message}`);
			continue;
		}
		for (const job of (data ?? []) as JobRow[]) {
			const outcome = status === 'queued' ? await submit(db, job) : await poll(db, job);
			log[status].push(`${job.id.slice(0, 8)}: ${outcome}`);
		}
	}
	log.touched = log.queued.length + log.submitted.length + log.running.length;
	if (log.touched > 0) console.log('[content]', JSON.stringify(log));
	return log;
}

/**
 * Runs one job to completion for the Test button: submit, then poll every
 * few seconds up to a short ceiling. Async video vendors will usually not
 * finish inside it, which is why Test verifies keys for those instead.
 */
export async function runJobNow(db: Db, jobId: string, maxWaitMs = 40_000): Promise<{ status: string; output: ContentJobOutput | null; error: string | null }> {
	const started = Date.now();
	await advanceContentJobs(db, jobId);
	for (;;) {
		const { data } = await db.from('content_jobs').select('status, output, error').eq('id', jobId).maybeSingle();
		const row = data as { status: string; output: ContentJobOutput | null; error: string | null } | null;
		if (!row) return { status: 'missing', output: null, error: 'job not found' };
		if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') return row;
		if (Date.now() - started > maxWaitMs) return row;
		await new Promise((r) => setTimeout(r, 3000));
		await advanceContentJobs(db, jobId);
	}
}
