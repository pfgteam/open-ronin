// Loads every Dev Dashboard source, each behind unstable_cache for five
// minutes, each collapsing to a typed SourceState so a missing token or a
// vendor outage becomes a tile, never an error page. Only the successful
// snapshot is cached: a throwing loader is caught outside the cache so a
// transient failure is retried on the next request instead of being frozen
// for five minutes.

import { unstable_cache } from 'next/cache';

import { fetchCronSnapshot } from './cron';
import { fetchGithubSnapshot } from './github';
import { MIGRATION_FILES } from './migrationFiles';
import { compareLedger, fetchDatabaseSnapshot } from './supabase';
import type {
	CronSnapshot,
	DatabaseSnapshot,
	GithubSnapshot,
	MigrationMismatch,
	SourceState,
	VercelSnapshot,
} from './types';
import { fetchVercelSnapshot } from './vercel';

export const DEV_CACHE_SECONDS = 300;

export const SENTRY_ENV_VAR = 'SENTRY_DSN';

async function guarded<T>(
	envVar: string | null,
	loader: () => Promise<T>,
): Promise<SourceState<T>> {
	if (envVar) return { state: 'not_connected', envVar };
	try {
		const data = await loader();
		return { state: 'ok', data, fetchedAt: new Date().toISOString() };
	} catch (e) {
		return { state: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}

/** The first missing variable of a list, or null when every one is set. */
export function firstMissing(names: string[]): string | null {
	for (const n of names) if (!process.env[n]) return n;
	return null;
}

const cachedGithub = unstable_cache(
	(token: string) => fetchGithubSnapshot(token),
	['dev-dashboard-github'],
	{ revalidate: DEV_CACHE_SECONDS },
);

const cachedVercel = unstable_cache(
	(token: string, projectId: string, teamId: string) => fetchVercelSnapshot({ token, projectId, teamId }),
	['dev-dashboard-vercel'],
	{ revalidate: DEV_CACHE_SECONDS },
);

const cachedDatabase = unstable_cache(
	(token: string, ref: string) => fetchDatabaseSnapshot({ token, ref }),
	['dev-dashboard-database'],
	{ revalidate: DEV_CACHE_SECONDS },
);

const cachedCron = unstable_cache(() => fetchCronSnapshot(), ['dev-dashboard-cron'], {
	revalidate: DEV_CACHE_SECONDS,
});

// Beacon is a different org: its own GitHub repo, Vercel project and (later)
// Supabase project. Nothing here is guessed — every identifier is an env var
// and each source shows "Not connected" naming the variable until Alex
// sets it (docs/ENV.md). BEACON_GITHUB_TOKEN falls back to GITHUB_TOKEN when
// one fine grained token covers both repos.
export const BEACON_ENV = {
	repo: 'BEACON_GITHUB_REPO',
	githubToken: 'BEACON_GITHUB_TOKEN',
	vercelToken: 'BEACON_VERCEL_TOKEN',
	vercelProject: 'BEACON_VERCEL_PROJECT_ID',
	vercelTeam: 'BEACON_VERCEL_TEAM_ID',
	supabaseToken: 'BEACON_SUPABASE_ACCESS_TOKEN',
	supabaseRef: 'BEACON_SUPABASE_PROJECT_REF',
} as const;

const cachedBeaconGithub = unstable_cache(
	(token: string, repo: string) => fetchGithubSnapshot(token, Date.now(), repo),
	['dev-dashboard-beacon-github'],
	{ revalidate: DEV_CACHE_SECONDS },
);

const cachedBeaconVercel = unstable_cache(
	(token: string, projectId: string, teamId: string) => fetchVercelSnapshot({ token, projectId, teamId }),
	['dev-dashboard-beacon-vercel'],
	{ revalidate: DEV_CACHE_SECONDS },
);

const cachedBeaconDatabase = unstable_cache(
	(token: string, ref: string) => fetchDatabaseSnapshot({ token, ref }),
	['dev-dashboard-beacon-database'],
	{ revalidate: DEV_CACHE_SECONDS },
);

export interface BeaconDashboardData {
	github: SourceState<GithubSnapshot>;
	vercel: SourceState<VercelSnapshot>;
	database: SourceState<DatabaseSnapshot>;
	/** The repo the GitHub source is pointed at, when configured. */
	repo: string | null;
}

export async function loadBeaconDashboard(): Promise<BeaconDashboardData> {
	const repo = process.env[BEACON_ENV.repo] ?? null;
	const ghToken = process.env[BEACON_ENV.githubToken] ?? process.env.GITHUB_TOKEN ?? null;
	const [github, vercel, database] = await Promise.all([
		guarded(!repo ? BEACON_ENV.repo : !ghToken ? BEACON_ENV.githubToken : null, () =>
			cachedBeaconGithub(ghToken as string, repo as string),
		),
		guarded(firstMissing([BEACON_ENV.vercelToken, BEACON_ENV.vercelProject, BEACON_ENV.vercelTeam]), () =>
			cachedBeaconVercel(
				process.env[BEACON_ENV.vercelToken] as string,
				process.env[BEACON_ENV.vercelProject] as string,
				process.env[BEACON_ENV.vercelTeam] as string,
			),
		),
		guarded(firstMissing([BEACON_ENV.supabaseToken, BEACON_ENV.supabaseRef]), () =>
			cachedBeaconDatabase(
				process.env[BEACON_ENV.supabaseToken] as string,
				process.env[BEACON_ENV.supabaseRef] as string,
			),
		),
	]);
	return { github, vercel, database, repo };
}

export interface DevDashboardData {
	github: SourceState<GithubSnapshot>;
	vercel: SourceState<VercelSnapshot>;
	database: SourceState<DatabaseSnapshot>;
	migrations: MigrationMismatch | null;
	cron: SourceState<CronSnapshot>;
	sentry: { connected: false; envVar: string };
	folderCount: number;
}

export async function loadDevDashboard(): Promise<DevDashboardData> {
	const [github, vercel, database, cron] = await Promise.all([
		guarded(firstMissing(['GITHUB_TOKEN']), () => cachedGithub(process.env.GITHUB_TOKEN as string)),
		guarded(firstMissing(['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID']), () =>
			cachedVercel(
				process.env.VERCEL_TOKEN as string,
				process.env.VERCEL_PROJECT_ID as string,
				process.env.VERCEL_TEAM_ID as string,
			),
		),
		guarded(firstMissing(['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF']), () =>
			cachedDatabase(process.env.SUPABASE_ACCESS_TOKEN as string, process.env.SUPABASE_PROJECT_REF as string),
		),
		// cron_runs lives in the app database; the service role key is always
		// present, so this source is never "not connected".
		guarded(null, () => cachedCron()),
	]);

	return {
		github,
		vercel,
		database,
		migrations: database.state === 'ok' ? compareLedger(database.data.ledger, MIGRATION_FILES) : null,
		cron,
		sentry: { connected: false, envVar: SENTRY_ENV_VAR },
		folderCount: MIGRATION_FILES.length,
	};
}
