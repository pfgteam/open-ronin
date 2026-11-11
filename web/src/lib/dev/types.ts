// Shapes the Dev Dashboard renders. Every source returns either a snapshot or
// a reason it could not (missing env var, API failure). The page never
// throws on a missing token: a "not connected" tile names the variable.

export type SourceState<T> =
	| { state: 'ok'; data: T; fetchedAt: string }
	| { state: 'not_connected'; envVar: string }
	| { state: 'error'; message: string };

export type CheckState = 'passing' | 'failing' | 'pending' | 'none';

export interface OpenPr {
	number: number;
	title: string;
	url: string;
	author: string;
	reviewers: string[];
	draft: boolean;
	createdAt: string;
	ageDays: number;
	headSha: string;
	checks: { state: CheckState; passed: number; failed: number; pending: number; total: number };
}

export interface GithubSnapshot {
	repo: string;
	openPrs: OpenPr[];
	mergedLast7: { number: number; title: string; url: string; mergedAt: string; author: string }[];
	commitsToMainLast7: number;
	commitsByAuthor: { author: string; count: number }[];
}

export type DeployState = 'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'CANCELED' | 'INITIALIZING' | string;

export interface Deploy {
	id: string;
	url: string;
	state: DeployState;
	target: 'production' | 'preview';
	createdAt: string;
	readyAt: string | null;
	commitSha: string | null;
	commitMessage: string | null;
	branch: string | null;
	author: string | null;
	/** First error line of a failed build, when Vercel still has the log. */
	firstError: string | null;
	inspectorUrl: string | null;
}

export interface VercelSnapshot {
	projectName: string;
	deploysLast7: Deploy[];
	ready: number;
	error: number;
	building: number;
	production: Deploy | null;
}

export interface LedgerRow {
	version: string;
	name: string;
}

export interface AdvisorSummary {
	errors: number;
	warnings: number;
	info: number;
	url: string;
}

export interface DatabaseSnapshot {
	projectRef: string;
	sizeBytes: number;
	tableCount: number;
	ledger: LedgerRow[];
	advisors: { security: AdvisorSummary | null; performance: AdvisorSummary | null };
}

export interface MigrationMismatch {
	/** Ledger rows (production) matched against the folder in this deploy. */
	ledgerCount: number;
	folderCount: number;
	/** Files in the folder with no ledger row, minus the documented exceptions. */
	unapplied: string[];
	/** Ledger rows with no file in the folder. */
	missing: string[];
	/** unapplied.length + missing.length; the red number on the tile. */
	mismatch: number;
}

export interface CronRouteHealth {
	route: string;
	schedule: string;
	lastStartedAt: string | null;
	lastFinishedAt: string | null;
	lastStatus: 'running' | 'ok' | 'error' | null;
	lastHttpStatus: number | null;
	lastDurationMs: number | null;
	lastError: string | null;
	lastOkAt: string | null;
	/** Never logged a tick, or the last tick is older than two schedule periods. */
	stale: boolean;
}

export interface CronSnapshot {
	routes: CronRouteHealth[];
	healthy: number;
	unhealthy: number;
}
