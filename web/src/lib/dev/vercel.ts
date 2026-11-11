// Vercel source for the Dev Dashboard. VERCEL_TOKEN (read only) scoped to
// the team, plus VERCEL_PROJECT_ID and VERCEL_TEAM_ID from docs/ENV.md.
// Pure helpers are unit tested in vercel.test.ts.

import type { Deploy, VercelSnapshot } from './types';

const API = 'https://api.vercel.com';
const DAY_MS = 86_400_000;

interface VcDeployment {
	uid: string;
	url: string;
	state?: string;
	readyState?: string;
	target?: 'production' | 'preview' | null;
	created: number;
	ready?: number;
	createdAt?: number;
	inspectorUrl?: string | null;
	creator?: { username?: string } | null;
	meta?: {
		githubCommitSha?: string;
		githubCommitMessage?: string;
		githubCommitRef?: string;
		githubCommitAuthorLogin?: string;
		githubCommitAuthorName?: string;
	};
}

interface VcEvent {
	type?: string;
	created?: number;
	payload?: { text?: string; info?: { type?: string } } | null;
	text?: string;
}

async function fetchVercel<T>(token: string, path: string): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
		cache: 'no-store',
	});
	if (!res.ok) throw new Error(`Vercel ${path.split('?')[0]} returned ${res.status}`);
	return (await res.json()) as T;
}

export function toDeploy(d: VcDeployment): Deploy {
	return {
		id: d.uid,
		url: d.url,
		state: (d.readyState ?? d.state ?? 'UNKNOWN').toUpperCase(),
		target: d.target === 'production' ? 'production' : 'preview',
		createdAt: new Date(d.created ?? d.createdAt ?? 0).toISOString(),
		readyAt: d.ready ? new Date(d.ready).toISOString() : null,
		commitSha: d.meta?.githubCommitSha ?? null,
		commitMessage: d.meta?.githubCommitMessage?.split('\n')[0] ?? null,
		branch: d.meta?.githubCommitRef ?? null,
		author: d.meta?.githubCommitAuthorLogin ?? d.meta?.githubCommitAuthorName ?? d.creator?.username ?? null,
		firstError: null,
		inspectorUrl: d.inspectorUrl ?? null,
	};
}

/**
 * The first line of a failed build that looks like the reason. Vercel's
 * build log is a stream of events; `error` typed events come first, then any
 * stderr line mentioning an error, then the last stderr line as a fallback.
 */
export function firstErrorLine(events: VcEvent[]): string | null {
	const text = (e: VcEvent) => (e.payload?.text ?? e.text ?? '').trim();
	const typed = events.find((e) => e.type === 'error' && text(e));
	if (typed) return text(typed).slice(0, 300);
	const stderr = events.filter((e) => e.type === 'stderr' && text(e));
	const mentioned = stderr.find((e) => /\b(error|failed|cannot|missing)\b/i.test(text(e)));
	if (mentioned) return text(mentioned).slice(0, 300);
	const last = stderr.at(-1);
	return last ? text(last).slice(0, 300) : null;
}

export function summarizeDeploys(deploys: Deploy[]): Pick<VercelSnapshot, 'ready' | 'error' | 'building'> {
	let ready = 0;
	let error = 0;
	let building = 0;
	for (const d of deploys) {
		if (d.state === 'READY') ready++;
		else if (d.state === 'ERROR' || d.state === 'CANCELED') error++;
		else building++;
	}
	return { ready, error, building };
}

export async function fetchVercelSnapshot(
	env: { token: string; projectId: string; teamId: string },
	now = Date.now(),
): Promise<VercelSnapshot> {
	const q = `projectId=${encodeURIComponent(env.projectId)}&teamId=${encodeURIComponent(env.teamId)}`;
	const since = now - 7 * DAY_MS;
	const [list, project] = await Promise.all([
		fetchVercel<{ deployments: VcDeployment[] }>(env.token, `/v6/deployments?${q}&limit=100&since=${since}`),
		fetchVercel<{ name?: string; targets?: { production?: VcDeployment | null } }>(
			env.token,
			`/v9/projects/${encodeURIComponent(env.projectId)}?teamId=${encodeURIComponent(env.teamId)}`,
		).catch(() => ({}) as { name?: string; targets?: { production?: VcDeployment | null } }),
	]);

	const deploysLast7 = list.deployments
		.map(toDeploy)
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

	// The first error line, for the failed builds only, capped so a bad
	// afternoon of red deploys does not turn into forty log downloads.
	const failed = deploysLast7.filter((d) => d.state === 'ERROR').slice(0, 5);
	await Promise.all(
		failed.map(async (d) => {
			try {
				const events = await fetchVercel<VcEvent[] | { events?: VcEvent[] }>(
					env.token,
					`/v3/deployments/${encodeURIComponent(d.id)}/events?teamId=${encodeURIComponent(env.teamId)}&builds=1&limit=500`,
				);
				d.firstError = firstErrorLine(Array.isArray(events) ? events : (events.events ?? []));
			} catch {
				d.firstError = null;
			}
		}),
	);

	const productionTarget = project.targets?.production ? toDeploy(project.targets.production) : null;
	const production =
		productionTarget ??
		deploysLast7.find((d) => d.target === 'production' && d.state === 'READY') ??
		null;

	return {
		projectName: project.name ?? 'open-ronin',
		deploysLast7,
		...summarizeDeploys(deploysLast7),
		production,
	};
}
