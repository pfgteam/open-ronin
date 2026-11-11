// GitHub source for the Dev Dashboard. Fine grained read token on
// your-org/open-ronin (GITHUB_TOKEN). Every function here is pure
// apart from `fetchGithub`, so the aggregation is unit tested without the
// network (github.test.ts).

import type { CheckState, GithubSnapshot, OpenPr } from './types';

export const REPO = 'your-org/open-ronin';
const API = 'https://api.github.com';
const DAY_MS = 86_400_000;

interface GhUser {
	login: string;
}
interface GhPull {
	number: number;
	title: string;
	html_url: string;
	user: GhUser | null;
	requested_reviewers?: GhUser[];
	draft: boolean;
	created_at: string;
	merged_at: string | null;
	head: { sha: string };
}
interface GhCheckRun {
	status: 'queued' | 'in_progress' | 'completed' | string;
	conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
}
interface GhCommitStatus {
	state: 'success' | 'failure' | 'error' | 'pending';
	context: string;
}
interface GhCommit {
	author: GhUser | null;
	commit: { author: { name: string } | null };
}

async function fetchGithub<T>(token: string, path: string): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		},
		cache: 'no-store',
	});
	if (!res.ok) {
		throw new Error(`GitHub ${path} returned ${res.status}`);
	}
	return (await res.json()) as T;
}

/**
 * Collapse check runs (GitHub Actions) and commit statuses (Vercel) into one
 * reading. A single failure wins; otherwise anything still running reads
 * pending; all done and green reads passing; nothing at all reads none.
 * Skipped and neutral runs are not failures and not counted as passed.
 */
export function summarizeChecks(
	runs: GhCheckRun[],
	statuses: GhCommitStatus[],
): OpenPr['checks'] {
	let passed = 0;
	let failed = 0;
	let pending = 0;
	for (const r of runs) {
		if (r.status !== 'completed') pending++;
		else if (r.conclusion === 'success') passed++;
		else if (r.conclusion === 'neutral' || r.conclusion === 'skipped') continue;
		else failed++;
	}
	// Vercel posts one status per deploy for the same context; the newest is
	// first in the API response and is the one that counts.
	const seen = new Set<string>();
	for (const s of statuses) {
		if (seen.has(s.context)) continue;
		seen.add(s.context);
		if (s.state === 'success') passed++;
		else if (s.state === 'pending') pending++;
		else failed++;
	}
	const total = passed + failed + pending;
	const state: CheckState =
		failed > 0 ? 'failing' : pending > 0 ? 'pending' : total > 0 ? 'passing' : 'none';
	return { state, passed, failed, pending, total };
}

export function ageInDays(createdAt: string, now = Date.now()): number {
	return Math.max(0, Math.floor((now - Date.parse(createdAt)) / DAY_MS));
}

export function countByAuthor(commits: GhCommit[]): { author: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const c of commits) {
		const author = c.author?.login ?? c.commit.author?.name ?? 'unknown';
		counts.set(author, (counts.get(author) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([author, count]) => ({ author, count }))
		.sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
}

export async function fetchGithubSnapshot(token: string, now = Date.now(), repo: string = REPO): Promise<GithubSnapshot> {
	const since = new Date(now - 7 * DAY_MS).toISOString();
	const [open, closed, commits] = await Promise.all([
		fetchGithub<GhPull[]>(token, `/repos/${repo}/pulls?state=open&per_page=50&sort=created&direction=desc`),
		fetchGithub<GhPull[]>(token, `/repos/${repo}/pulls?state=closed&per_page=50&sort=updated&direction=desc`),
		fetchGithub<GhCommit[]>(token, `/repos/${repo}/commits?sha=main&since=${since}&per_page=100`),
	]);

	// Checks per open PR: two small calls each, in parallel, capped so a burst
	// of branches cannot exhaust the token's rate budget on one page load.
	const openPrs: OpenPr[] = await Promise.all(
		open.slice(0, 25).map(async (pr) => {
			const [runs, status] = await Promise.all([
				fetchGithub<{ check_runs: GhCheckRun[] }>(
					token,
					`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
				).catch(() => ({ check_runs: [] as GhCheckRun[] })),
				fetchGithub<{ statuses: GhCommitStatus[] }>(
					token,
					`/repos/${repo}/commits/${pr.head.sha}/status`,
				).catch(() => ({ statuses: [] as GhCommitStatus[] })),
			]);
			return {
				number: pr.number,
				title: pr.title,
				url: pr.html_url,
				author: pr.user?.login ?? 'unknown',
				reviewers: (pr.requested_reviewers ?? []).map((u) => u.login),
				draft: pr.draft,
				createdAt: pr.created_at,
				ageDays: ageInDays(pr.created_at, now),
				headSha: pr.head.sha,
				checks: summarizeChecks(runs.check_runs, status.statuses),
			};
		}),
	);

	const mergedLast7 = closed
		.filter((pr) => pr.merged_at && Date.parse(pr.merged_at) >= now - 7 * DAY_MS)
		.map((pr) => ({
			number: pr.number,
			title: pr.title,
			url: pr.html_url,
			mergedAt: pr.merged_at as string,
			author: pr.user?.login ?? 'unknown',
		}))
		.sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));

	return {
		repo,
		openPrs,
		mergedLast7,
		commitsToMainLast7: commits.length,
		commitsByAuthor: countByAuthor(commits),
	};
}
