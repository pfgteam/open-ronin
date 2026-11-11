// KPI tiles for /dashboard/dev, in the shape the department dashboards use
// (lib/dashboard/catalog.ts) so the same editable grid, picker and saved
// layout apply. Every tile reads from one DevDashboardData snapshot; a source
// that is not connected renders "Not connected" with the env var to set.

import {
	Activity,
	AlertTriangle,
	Bug,
	Database,
	GitCommit,
	GitMerge,
	GitPullRequest,
	Rocket,
	ShieldCheck,
	Table2,
	Timer,
} from 'lucide-react';

import type { TileSpec } from '@/lib/dashboard/catalog';
import type { TileStats } from '@/lib/dashboard/types';
import { formatNumber } from '@/lib/format';

import type { DevDashboardData } from './load';
import { formatBytes } from './supabase';
import type { SourceState } from './types';

const NOT_CONNECTED = 'Not connected';

function subtitleFor<T>(src: SourceState<T>, ok: (d: T) => string): string {
	if (src.state === 'not_connected') return `Set ${src.envVar}`;
	if (src.state === 'error') return src.message.slice(0, 80);
	return ok(src.data);
}

function valueFor<T>(src: SourceState<T>, ok: (d: T) => string): string {
	if (src.state === 'not_connected') return NOT_CONNECTED;
	if (src.state === 'error') return 'Unavailable';
	return ok(src.data);
}

function shortSha(sha: string | null): string {
	return sha ? sha.slice(0, 7) : '—';
}

function agoLabel(iso: string | null): string {
	if (!iso) return 'never';
	const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

/** A colored chip under the value, reusing the delta chip styles of the sheet tiles. */
function chip(tone: 'good' | 'bad' | 'neutral', text: string, note = ''): TileStats {
	return { delta: { dir: 'flat', tone, text, note }, target: null };
}

export const devCatalog: (TileSpec<DevDashboardData> & { stats?: (d: DevDashboardData) => TileStats | undefined })[] = [
	{
		key: 'open_prs',
		defaultLabel: 'Open PRs',
		icon: GitPullRequest,
		section: 'GitHub',
		render: (d) => valueFor(d.github, (g) => formatNumber(g.openPrs.length)),
		subtitle: (d) =>
			subtitleFor(d.github, (g) => {
				const failing = g.openPrs.filter((p) => p.checks.state === 'failing').length;
				const pending = g.openPrs.filter((p) => p.checks.state === 'pending').length;
				return `${failing} failing checks · ${pending} pending`;
			}),
		stats: (d) => {
			if (d.github.state !== 'ok') return undefined;
			const failing = d.github.data.openPrs.filter((p) => p.checks.state === 'failing').length;
			return failing > 0 ? chip('bad', `${failing} red`) : chip('good', 'checks green');
		},
	},
	{
		key: 'merged_7d',
		defaultLabel: 'Merged, 7 days',
		icon: GitMerge,
		section: 'GitHub',
		render: (d) => valueFor(d.github, (g) => formatNumber(g.mergedLast7.length)),
		subtitle: (d) => subtitleFor(d.github, (g) => (g.mergedLast7[0] ? `Latest #${g.mergedLast7[0].number}` : 'Nothing merged this week')),
	},
	{
		key: 'commits_main_7d',
		defaultLabel: 'Commits to main, 7 days',
		icon: GitCommit,
		section: 'GitHub',
		render: (d) => valueFor(d.github, (g) => formatNumber(g.commitsToMainLast7)),
		subtitle: (d) =>
			subtitleFor(d.github, (g) =>
				g.commitsByAuthor.length ? g.commitsByAuthor.map((a) => `${a.author} ${a.count}`).join(' · ') : 'No commits this week',
			),
	},
	{
		key: 'deploys_7d',
		defaultLabel: 'Deploys, 7 days',
		icon: Rocket,
		section: 'Vercel',
		render: (d) => valueFor(d.vercel, (v) => formatNumber(v.deploysLast7.length)),
		subtitle: (d) => subtitleFor(d.vercel, (v) => `${v.ready} ready · ${v.error} error · ${v.building} building`),
		stats: (d) => {
			if (d.vercel.state !== 'ok') return undefined;
			return d.vercel.data.error > 0 ? chip('bad', `${d.vercel.data.error} failed`) : chip('good', 'all ready');
		},
	},
	{
		key: 'production',
		defaultLabel: 'Production',
		icon: Activity,
		section: 'Vercel',
		render: (d) => valueFor(d.vercel, (v) => (v.production ? shortSha(v.production.commitSha) : '—')),
		subtitle: (d) =>
			subtitleFor(d.vercel, (v) =>
				v.production
					? `${v.production.commitMessage ?? v.production.url} · ${agoLabel(v.production.readyAt ?? v.production.createdAt)}`
					: 'No production deployment found',
			),
	},
	{
		key: 'db_size',
		defaultLabel: 'Database size',
		icon: Database,
		section: 'Database',
		render: (d) => valueFor(d.database, (db) => formatBytes(db.sizeBytes)),
		subtitle: (d) => subtitleFor(d.database, (db) => `Project ${db.projectRef}`),
	},
	{
		key: 'db_tables',
		defaultLabel: 'Tables',
		icon: Table2,
		section: 'Database',
		render: (d) => valueFor(d.database, (db) => formatNumber(db.tableCount)),
		subtitle: () => 'Base tables in public',
	},
	{
		key: 'migration_mismatch',
		defaultLabel: 'Migration mismatch',
		icon: AlertTriangle,
		section: 'Database',
		render: (d) => valueFor(d.database, () => formatNumber(d.migrations?.mismatch ?? 0)),
		subtitle: (d) =>
			subtitleFor(d.database, () =>
				d.migrations
					? `Ledger ${d.migrations.ledgerCount} · folder ${d.migrations.folderCount}`
					: `Folder ${d.folderCount}`,
			),
		stats: (d) => {
			if (d.database.state !== 'ok' || !d.migrations) return undefined;
			const m = d.migrations;
			return m.mismatch > 0
				? chip('bad', `${m.unapplied.length} unapplied · ${m.missing.length} missing`)
				: chip('good', 'in sync');
		},
	},
	{
		key: 'advisors',
		defaultLabel: 'Advisor warnings',
		icon: ShieldCheck,
		section: 'Database',
		render: (d) =>
			valueFor(d.database, (db) => {
				const s = db.advisors.security;
				const p = db.advisors.performance;
				if (!s && !p) return '—';
				return formatNumber((s?.errors ?? 0) + (s?.warnings ?? 0) + (p?.errors ?? 0) + (p?.warnings ?? 0));
			}),
		subtitle: (d) =>
			subtitleFor(d.database, (db) => {
				const s = db.advisors.security;
				const p = db.advisors.performance;
				if (!s && !p) return 'Advisors unavailable';
				return `Security ${s ? s.errors + s.warnings : '—'} · Performance ${p ? p.errors + p.warnings : '—'}`;
			}),
		stats: (d) => {
			if (d.database.state !== 'ok') return undefined;
			const errors = (d.database.data.advisors.security?.errors ?? 0) + (d.database.data.advisors.performance?.errors ?? 0);
			return errors > 0 ? chip('bad', `${errors} errors`) : undefined;
		},
	},
	{
		key: 'cron_health',
		defaultLabel: 'Cron health',
		icon: Timer,
		section: 'Cron',
		render: (d) => valueFor(d.cron, (c) => `${c.healthy}/${c.routes.length}`),
		subtitle: (d) => subtitleFor(d.cron, (c) => (c.unhealthy ? `${c.unhealthy} stale or failing` : 'Every route ran on schedule')),
		stats: (d) => {
			if (d.cron.state !== 'ok') return undefined;
			return d.cron.data.unhealthy > 0 ? chip('bad', `${d.cron.data.unhealthy} unhealthy`) : chip('good', 'healthy');
		},
	},
	{
		key: 'error_rate',
		defaultLabel: 'Error rate and p95 latency',
		icon: Bug,
		section: 'Errors',
		render: () => 'Sentry not connected',
		subtitle: (d) => `Set ${d.sentry.envVar} to light this tile`,
	},
];
