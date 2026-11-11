// Supabase Management API source for the Dev Dashboard: database size,
// table count, the migration ledger and the advisor counts. Read only
// endpoints, SUPABASE_ACCESS_TOKEN plus SUPABASE_PROJECT_REF (docs/ENV.md).
//
// The ledger versus folder comparison follows supabase/migrations/README.md:
// four base schema files predate the ledger and are applied without a row,
// and the ledger's 0004_the_work_backfill row covers the 0004 file. Those are
// the only exceptions; anything else is a real mismatch and the tile goes
// red. Pure helpers are unit tested in supabase.test.ts.

import type { AdvisorSummary, DatabaseSnapshot, LedgerRow, MigrationMismatch } from './types';

const API = 'https://api.supabase.com/v1';

/** Files applied before the ledger existed (README, "Applied but not in the ledger"). */
export const LEDGERLESS_FILES = new Set([
	'0001_init',
	'0002_client_management',
	'0003_dashboard_layout',
	'0004_the_work',
]);

/** Ledger rows with no file of their own (README: the 0004 backfill row covers 0004_the_work). */
export const FILELESS_ROWS = new Set(['0004_the_work_backfill']);

async function query<T>(env: { token: string; ref: string }, sql: string): Promise<T[]> {
	const res = await fetch(`${API}/projects/${encodeURIComponent(env.ref)}/database/query`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: sql, read_only: true }),
		cache: 'no-store',
	});
	if (!res.ok) throw new Error(`Supabase query returned ${res.status}`);
	const json = (await res.json()) as unknown;
	if (Array.isArray(json)) return json as T[];
	if (json && typeof json === 'object' && Array.isArray((json as { result?: unknown }).result)) {
		return (json as { result: T[] }).result;
	}
	return [];
}

interface Lint {
	level?: string;
}

export function summarizeLints(payload: unknown, url: string): AdvisorSummary {
	const lints: Lint[] = Array.isArray(payload)
		? (payload as Lint[])
		: ((payload as { lints?: Lint[] } | null)?.lints ?? []);
	const out: AdvisorSummary = { errors: 0, warnings: 0, info: 0, url };
	for (const l of lints) {
		const level = (l.level ?? '').toUpperCase();
		if (level === 'ERROR') out.errors++;
		else if (level === 'WARN' || level === 'WARNING') out.warnings++;
		else out.info++;
	}
	return out;
}

async function advisors(env: { token: string; ref: string }, kind: 'security' | 'performance'): Promise<AdvisorSummary | null> {
	const url = `https://supabase.com/dashboard/project/${env.ref}/advisors/${kind}`;
	try {
		const res = await fetch(`${API}/projects/${encodeURIComponent(env.ref)}/advisors/${kind}`, {
			headers: { Authorization: `Bearer ${env.token}` },
			cache: 'no-store',
		});
		if (!res.ok) return null;
		return summarizeLints(await res.json(), url);
	} catch {
		return null;
	}
}

export function compareLedger(ledger: LedgerRow[], files: readonly string[]): MigrationMismatch {
	const ledgerNames = new Set(ledger.map((r) => r.name));
	const fileNames = new Set(files);
	const unapplied = files.filter((f) => !ledgerNames.has(f) && !LEDGERLESS_FILES.has(f)).sort();
	const missing = [...ledgerNames].filter((n) => !fileNames.has(n) && !FILELESS_ROWS.has(n)).sort();
	return {
		ledgerCount: ledger.length,
		folderCount: files.length,
		unapplied,
		missing,
		mismatch: unapplied.length + missing.length,
	};
}

export async function fetchDatabaseSnapshot(env: { token: string; ref: string }): Promise<DatabaseSnapshot> {
	const [sizeRows, tableRows, ledger, security, performance] = await Promise.all([
		query<{ bytes: number | string }>(env, 'select pg_database_size(current_database()) as bytes'),
		query<{ n: number | string }>(
			env,
			"select count(*) as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
		),
		query<LedgerRow>(env, 'select version, name from supabase_migrations.schema_migrations order by version'),
		advisors(env, 'security'),
		advisors(env, 'performance'),
	]);
	return {
		projectRef: env.ref,
		sizeBytes: Number(sizeRows[0]?.bytes ?? 0),
		tableCount: Number(tableRows[0]?.n ?? 0),
		ledger: ledger.map((r) => ({ version: String(r.version), name: String(r.name) })),
		advisors: { security, performance },
	};
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
	const mb = bytes / 1_048_576;
	if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
	return `${(mb / 1024).toFixed(2)} GB`;
}
