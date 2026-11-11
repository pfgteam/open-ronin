// Minimal Apify REST client — start a run, poll it, page its dataset.
//
// No SDK on purpose: three endpoints, native fetch, same reasoning as
// lib/google/calendar.ts. The token is server-only (APIFY_TOKEN) and must
// never reach the browser.
//
// Actor ids use `~` in URLs: code_crafter/leads-finder -> code_crafter~leads-finder.

const API = 'https://api.apify.com/v2';

function token(): string {
	const t = process.env.APIFY_TOKEN;
	if (!t) throw new Error('APIFY_TOKEN is not set');
	return t;
}

/** Apify's terminal and non-terminal run states. */
export type RunStatus =
	| 'READY' | 'RUNNING'
	| 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'ABORTING' | 'TIMED-OUT' | 'TIMING-OUT';

export const TERMINAL_OK: RunStatus[] = ['SUCCEEDED'];
export const TERMINAL_BAD: RunStatus[] = ['FAILED', 'ABORTED', 'TIMED-OUT'];

export interface RunInfo {
	id: string;
	status: RunStatus;
	defaultDatasetId: string | null;
	startedAt: string | null;
	finishedAt: string | null;
}

function asRunInfo(data: Record<string, unknown>): RunInfo {
	return {
		id: String(data.id),
		status: data.status as RunStatus,
		defaultDatasetId: (data.defaultDatasetId as string | undefined) ?? null,
		startedAt: (data.startedAt as string | undefined) ?? null,
		finishedAt: (data.finishedAt as string | undefined) ?? null,
	};
}

async function apify(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
	const sep = path.includes('?') ? '&' : '?';
	const r = await fetch(`${API}${path}${sep}token=${encodeURIComponent(token())}`, init);
	if (!r.ok) {
		// The body carries Apify's own message; keep it for the job's error
		// column, but the caller decides what reaches a user.
		throw new Error(`Apify ${init?.method ?? 'GET'} ${path} -> ${r.status}: ${await r.text()}`);
	}
	const json = (await r.json()) as { data?: Record<string, unknown> };
	return json.data ?? {};
}

/** Start a run. Returns immediately — Apify executes asynchronously, which is
 *  the whole reason jobs are advanced by cron ticks instead of one request. */
export async function startRun(actorId: string, input: Record<string, unknown>): Promise<RunInfo> {
	const data = await apify(`/acts/${actorId.replace('/', '~')}/runs`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	return asRunInfo(data);
}

export async function getRun(runId: string): Promise<RunInfo> {
	return asRunInfo(await apify(`/actor-runs/${encodeURIComponent(runId)}`));
}

/** One page of dataset items. `clean=true` drops Apify's internal fields. */
export async function getDatasetItems(
	datasetId: string,
	offset: number,
	limit: number,
): Promise<Record<string, unknown>[]> {
	const sep = '?';
	const url =
		`${API}/datasets/${encodeURIComponent(datasetId)}/items${sep}` +
		`clean=true&format=json&offset=${offset}&limit=${limit}&token=${encodeURIComponent(token())}`;
	const r = await fetch(url);
	if (!r.ok) throw new Error(`Apify dataset ${datasetId} -> ${r.status}: ${await r.text()}`);
	const items = (await r.json()) as unknown;
	return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/** Best-effort abort, used when a job is cancelled from the UI. */
export async function abortRun(runId: string): Promise<void> {
	try {
		await apify(`/actor-runs/${encodeURIComponent(runId)}/abort`, { method: 'POST' });
	} catch {
		/* the run may already be finished — not worth failing the cancel over */
	}
}
