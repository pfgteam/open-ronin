// Automations inventory: everything that runs on a schedule or an event,
// from the sources that exist today — Vercel cron routes (vercel.json +
// cron_runs health from 0067) and n8n workflows (REST API, when N8N_API_URL
// and N8N_API_KEY are set). Native rules (automation_rules, WIP module 6)
// join the same list when that engine ships; the row shape is already the
// union. Server only.

import { fetchCronSnapshot } from '@/lib/dev/cron';
import { createServiceRoleClient } from '@/lib/supabase/server';

export type AutomationSource = 'vercel_cron' | 'n8n' | 'native' | 'hermes' | 'external';

export interface AutomationRow {
	source: AutomationSource;
	id: string;
	name: string;
	/** Human-readable schedule or trigger. */
	trigger: string;
	active: boolean;
	lastRunAt: string | null;
	lastStatus: 'ok' | 'error' | 'running' | 'unknown' | null;
	lastError: string | null;
	lastDurationMs: number | null;
	/** Where to open it (n8n editor, the route file, …). */
	href: string | null;
	/** Stale = expected to have run by now and has not. */
	stale: boolean;
}

export interface AutomationsInventory {
	rows: AutomationRow[];
	n8n: { state: 'ok' } | { state: 'not_connected'; envVar: string } | { state: 'error'; message: string };
	/** external_jobs (0108): not_applied until the migration lands. */
	external: { state: 'ok'; count: number } | { state: 'not_applied' } | { state: 'error'; message: string };
}

interface ExternalJobRow {
	id: string;
	source: 'hermes' | 'n8n' | 'github' | 'other';
	job_key: string;
	name: string;
	owner: string | null;
	schedule_text: string | null;
	expected_interval_minutes: number | null;
	href: string | null;
	enabled: boolean;
	last_started_at: string | null;
	last_finished_at: string | null;
	last_status: 'ok' | 'error' | 'running' | null;
	last_error: string | null;
	last_duration_ms: number | null;
}

/** Stale = expected interval known and the last start is older than two intervals plus five minutes (same rule as Vercel cron). */
export function externalJobStale(row: Pick<ExternalJobRow, 'expected_interval_minutes' | 'last_started_at' | 'enabled'>, now = Date.now()): boolean {
	if (!row.enabled || !row.expected_interval_minutes) return false;
	if (!row.last_started_at) return true;
	return now - Date.parse(row.last_started_at) > (2 * row.expected_interval_minutes + 5) * 60_000;
}

export function mapExternalJob(r: ExternalJobRow, now = Date.now()): AutomationRow {
	return {
		source: r.source === 'hermes' ? 'hermes' : 'external',
		id: r.job_key,
		name: r.owner ? r.name + ' (' + r.owner + ')' : r.name,
		trigger: r.schedule_text ?? (r.expected_interval_minutes ? 'every ' + r.expected_interval_minutes + ' min' : 'reported by heartbeat'),
		active: r.enabled,
		lastRunAt: r.last_started_at,
		lastStatus: r.last_status,
		lastError: r.last_error,
		lastDurationMs: r.last_duration_ms,
		href: r.href,
		stale: externalJobStale(r, now),
	};
}

async function fetchExternalJobs(): Promise<{ rows: AutomationRow[]; state: AutomationsInventory['external'] }> {
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase
		.from('external_jobs')
		.select('id, source, job_key, name, owner, schedule_text, expected_interval_minutes, href, enabled, last_started_at, last_finished_at, last_status, last_error, last_duration_ms')
		.order('source')
		.order('job_key')
		.returns<ExternalJobRow[]>();
	if (error) {
		if (/external_jobs|does not exist|schema cache/.test(error.message)) return { rows: [], state: { state: 'not_applied' } };
		return { rows: [], state: { state: 'error', message: error.message } };
	}
	const rows = (data ?? []).map((r) => mapExternalJob(r));
	return { rows, state: { state: 'ok', count: rows.length } };
}

const CRON_LABELS: Record<string, string> = {
	'/api/cron/checkin-reminders': 'Weekly check-in reminders',
	'/api/cron/health-scores': 'Client health scores',
	'/api/cron/scrapers': 'Lead scraper dispatcher',
	'/api/cron/sheet-sync': 'CEO Metrics sheet sync',
	'/api/cron/the-work-metrics': 'The Work metrics compute',
	'/api/cron/token-hygiene': 'Token hygiene',
	'/api/cron/content-jobs': 'Content jobs (providers)',
	'/api/cron/automations': 'Automation engine',
	'/api/cron/contract-renewals': 'Contract renewal alerts (30/60/90)',
	'/api/cron/job-health': 'Job health alerts (stale / errored)',
	'/api/cron/opp-months': 'Media opp monthly counts (health score input)',
};

function describeSchedule(schedule: string): string {
	const [m, h, dom, mon, dow] = schedule.trim().split(/\s+/);
	if (m === '*' && h === '*') return 'every minute';
	const everyN = /^\*\/(\d+)$/.exec(m ?? '');
	if (everyN && h === '*') return `every ${everyN[1]} minutes`;
	if (h === '*') return `hourly at :${String(m).padStart(2, '0')}`;
	const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
	if (dom === '*' && mon === '*' && dow === '*') return `daily at ${time}`;
	return `${schedule} (${time})`;
}

interface N8nWorkflow {
	id: string;
	name: string;
	active: boolean;
	updatedAt?: string;
}
interface N8nExecution {
	id: string;
	workflowId: string;
	status?: string;
	finished?: boolean;
	startedAt?: string;
	stoppedAt?: string;
}

async function fetchN8n(url: string, key: string): Promise<AutomationRow[]> {
	const base = url.replace(/\/$/, '');
	const headers = { 'X-N8N-API-KEY': key, Accept: 'application/json' };
	const wfRes = await fetch(`${base}/api/v1/workflows?limit=100`, { headers, cache: 'no-store' });
	if (!wfRes.ok) throw new Error(`n8n workflows returned ${wfRes.status}`);
	const wfJson = (await wfRes.json()) as { data?: N8nWorkflow[] };
	const workflows = wfJson.data ?? [];
	const exRes = await fetch(`${base}/api/v1/executions?limit=100`, { headers, cache: 'no-store' }).catch(() => null);
	const executions = exRes && exRes.ok ? (((await exRes.json()) as { data?: N8nExecution[] }).data ?? []) : [];
	const lastByWf = new Map<string, N8nExecution>();
	for (const e of executions) {
		const cur = lastByWf.get(e.workflowId);
		if (!cur || (e.startedAt ?? '') > (cur.startedAt ?? '')) lastByWf.set(e.workflowId, e);
	}
	return workflows.map((w) => {
		const last = lastByWf.get(w.id);
		const status = last?.status === 'success' ? 'ok' : last?.status === 'error' || last?.status === 'crashed' ? 'error' : last?.status === 'running' ? 'running' : last ? 'unknown' : null;
		return {
			source: 'n8n',
			id: w.id,
			name: w.name,
			trigger: 'n8n workflow',
			active: w.active,
			lastRunAt: last?.startedAt ?? null,
			lastStatus: status,
			lastError: null,
			lastDurationMs: last?.startedAt && last?.stoppedAt ? Date.parse(last.stoppedAt) - Date.parse(last.startedAt) : null,
			href: `${base}/workflow/${w.id}`,
			stale: false,
		};
	});
}

export async function loadAutomationsInventory(): Promise<AutomationsInventory> {
	const cron = await fetchCronSnapshot();
	const rows: AutomationRow[] = cron.routes.map((r) => ({
		source: 'vercel_cron',
		id: r.route,
		name: CRON_LABELS[r.route] ?? r.route,
		trigger: describeSchedule(r.schedule),
		active: true,
		lastRunAt: r.lastStartedAt,
		lastStatus: r.lastStatus ?? null,
		lastError: r.lastError,
		lastDurationMs: r.lastDurationMs,
		href: `https://github.com/your-org/open-ronin/blob/main/web/src/app${r.route}/route.ts`,
		stale: r.stale,
	}));

	const url = process.env.N8N_API_URL;
	const key = process.env.N8N_API_KEY;
	let n8n: AutomationsInventory['n8n'];
	if (!url) n8n = { state: 'not_connected', envVar: 'N8N_API_URL' };
	else if (!key) n8n = { state: 'not_connected', envVar: 'N8N_API_KEY' };
	else {
		try {
			rows.push(...(await fetchN8n(url, key)));
			n8n = { state: 'ok' };
		} catch (e) {
			n8n = { state: 'error', message: e instanceof Error ? e.message : String(e) };
		}
	}
	const ext = await fetchExternalJobs();
	rows.push(...ext.rows);
	return { rows, n8n, external: ext.state };
}
