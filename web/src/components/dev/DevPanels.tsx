// Detail panels under the Dev Dashboard tiles: open PRs with checks, the
// week's deploys with the first error line, the migration ledger diff, and
// one row per cron route. Server markup only; styles follow the Dashboards
// table reference in UI_GUIDELINES.md.

import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import { formatRelative } from '@/lib/format';
import type { DevDashboardData, BeaconDashboardData } from '@/lib/dev/load';
import { BEACON_ENV } from '@/lib/dev/load';
import { formatBytes } from '@/lib/dev/supabase';
import type { CronRouteHealth, DatabaseSnapshot, Deploy, GithubSnapshot, OpenPr, SourceState, VercelSnapshot } from '@/lib/dev/types';
import { clsx } from 'clsx';

function SectionHeader({ title, count }: { title: string; count?: number | string }) {
	return (
		<div className="flex items-center gap-3 mb-3">
			<h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
			{count != null && <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{count}</span>}
			<div className="flex-1 h-px bg-slate-200 dark:bg-slate-700/60" />
		</div>
	);
}

function StatusText({ tone, label }: { tone: 'good' | 'bad' | 'warn' | 'muted'; label: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-2xs text-slate-500 dark:text-slate-400">
			<span
				className={clsx(
					'w-1.5 h-1.5 rounded-full',
					tone === 'good' && 'bg-green-500',
					tone === 'bad' && 'bg-red-500',
					tone === 'warn' && 'bg-amber-500',
					tone === 'muted' && 'bg-slate-300 dark:bg-slate-600',
				)}
			/>
			{label}
		</span>
	);
}

function NotConnected<T>({ src, what }: { src: SourceState<T>; what: string }) {
	if (src.state === 'not_connected') {
		return (
			<Callout tone="info">
				{what} is not connected. Set <code className="font-mono text-xs">{src.envVar}</code> in Vercel to light this panel.
			</Callout>
		);
	}
	if (src.state === 'error') {
		return (
			<Callout tone="warning">
				{what} could not be read: {src.message}
			</Callout>
		);
	}
	return null;
}

const th = 'text-left text-xs font-medium text-slate-400 dark:text-slate-500 px-3 py-2';
const td = 'px-3 py-2 text-xs text-slate-700 dark:text-slate-300 align-top';
const tdNum = `${td} text-right tabular-nums`;
const tr = 'border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors';
const link = 'text-primary-600 dark:text-primary-400 hover:underline';

function checkTone(pr: OpenPr): { tone: 'good' | 'bad' | 'warn' | 'muted'; label: string } {
	const c = pr.checks;
	if (c.state === 'failing') return { tone: 'bad', label: `${c.failed} failing of ${c.total}` };
	if (c.state === 'pending') return { tone: 'warn', label: `${c.pending} running of ${c.total}` };
	if (c.state === 'passing') return { tone: 'good', label: `${c.passed} passing` };
	return { tone: 'muted', label: 'no checks' };
}

function PullRequests({ src }: { src: SourceState<GithubSnapshot> }) {
	const fallback = <NotConnected src={src} what="GitHub" />;
	if (src.state !== 'ok') return <section><SectionHeader title="Open pull requests" />{fallback}</section>;
	const prs = src.data.openPrs;
	return (
		<section>
			<SectionHeader title="Open pull requests" count={prs.length} />
			<Card padding="none" className="overflow-x-auto">
				{prs.length === 0 ? (
					<p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No open pull requests.</p>
				) : (
					<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className={th}>PR</th>
								<th className={th}>Author</th>
								<th className={th}>Reviewer</th>
								<th className={`${th} text-right`}>Age</th>
								<th className={th}>Checks</th>
							</tr>
						</thead>
						<tbody>
							{prs.map((pr) => {
								const c = checkTone(pr);
								return (
									<tr key={pr.number} className={tr}>
										<td className={td}>
											<a href={pr.url} target="_blank" rel="noreferrer" className={link}>
												#{pr.number}
											</a>{' '}
											{pr.title}
											{pr.draft && <span className="ml-1 text-2xs text-slate-600 dark:text-slate-400">draft</span>}
										</td>
										<td className={td}>{pr.author}</td>
										<td className={td}>{pr.reviewers.length ? pr.reviewers.join(', ') : <span className="text-slate-400">none</span>}</td>
										<td className={tdNum}>{pr.ageDays}d</td>
										<td className={td}><StatusText tone={c.tone} label={c.label} /></td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				)}
			</Card>
			{src.data.mergedLast7.length > 0 && (
				<p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
					Merged this week:{' '}
					{src.data.mergedLast7.map((m, i) => (
						<span key={m.number}>
							{i > 0 && ', '}
							<a href={m.url} target="_blank" rel="noreferrer" className={link}>#{m.number}</a>
						</span>
					))}
				</p>
			)}
		</section>
	);
}

function deployTone(d: Deploy): { tone: 'good' | 'bad' | 'warn' | 'muted'; label: string } {
	if (d.state === 'READY') return { tone: 'good', label: 'ready' };
	if (d.state === 'ERROR') return { tone: 'bad', label: 'error' };
	if (d.state === 'CANCELED') return { tone: 'muted', label: 'canceled' };
	return { tone: 'warn', label: d.state.toLowerCase() };
}

function Deploys({ src }: { src: SourceState<VercelSnapshot> }) {
	const fallback = <NotConnected src={src} what="Vercel" />;
	if (src.state !== 'ok') return <section><SectionHeader title="Deploys, last 7 days" />{fallback}</section>;
	const deploys = src.data.deploysLast7.slice(0, 25);
	return (
		<section>
			<SectionHeader title="Deploys, last 7 days" count={src.data.deploysLast7.length} />
			<Card padding="none" className="overflow-x-auto">
				{deploys.length === 0 ? (
					<p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No deploys in the last 7 days.</p>
				) : (
					<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className={th}>When</th>
								<th className={th}>Target</th>
								<th className={th}>Commit</th>
								<th className={th}>Status</th>
							</tr>
						</thead>
						<tbody>
							{deploys.map((d) => {
								const t = deployTone(d);
								return (
									<tr key={d.id} className={tr}>
										<td className={`${td} whitespace-nowrap`}>{formatRelative(d.createdAt)}</td>
										<td className={td}>{d.target}{d.branch ? <span className="text-slate-400"> · {d.branch}</span> : null}</td>
										<td className={td}>
											{d.inspectorUrl ? (
												<a href={d.inspectorUrl} target="_blank" rel="noreferrer" className={`${link} font-mono`}>
													{d.commitSha?.slice(0, 7) ?? d.id.slice(0, 7)}
												</a>
											) : (
												<span className="font-mono">{d.commitSha?.slice(0, 7) ?? '—'}</span>
											)}{' '}
											{d.commitMessage}
											{d.firstError && (
												<p className="mt-1 text-2xs text-red-600 dark:text-red-400 font-mono">{d.firstError}</p>
											)}
										</td>
										<td className={td}><StatusText tone={t.tone} label={t.label} /></td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				)}
			</Card>
		</section>
	);
}

function Migrations({ data }: { data: DevDashboardData }) {
	const src = data.database;
	if (src.state !== 'ok' || !data.migrations) {
		return <section><SectionHeader title="Migrations" /><NotConnected src={src} what="Supabase Management API" /></section>;
	}
	const m = data.migrations;
	return (
		<section>
			<SectionHeader title="Migrations" count={`${m.ledgerCount} applied · ${m.folderCount} files`} />
			{m.mismatch === 0 ? (
				<Callout tone="success">Ledger and folder are in sync.</Callout>
			) : (
				<Callout tone="error">
					{m.unapplied.length > 0 && (
						<p>
							In the folder, not applied: <span className="font-mono text-xs">{m.unapplied.join(', ')}</span>
						</p>
					)}
					{m.missing.length > 0 && (
						<p>
							Applied, no file in the folder: <span className="font-mono text-xs">{m.missing.join(', ')}</span>
						</p>
					)}
				</Callout>
			)}
			{(src.data.advisors.security || src.data.advisors.performance) && (
				<p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
					Advisors:{' '}
					{src.data.advisors.security && (
						<a href={src.data.advisors.security.url} target="_blank" rel="noreferrer" className={link}>
							security {src.data.advisors.security.errors} errors, {src.data.advisors.security.warnings} warnings
						</a>
					)}
					{src.data.advisors.security && src.data.advisors.performance && ' · '}
					{src.data.advisors.performance && (
						<a href={src.data.advisors.performance.url} target="_blank" rel="noreferrer" className={link}>
							performance {src.data.advisors.performance.errors} errors, {src.data.advisors.performance.warnings} warnings
						</a>
					)}
				</p>
			)}
		</section>
	);
}

function cronTone(r: CronRouteHealth): { tone: 'good' | 'bad' | 'warn' | 'muted'; label: string } {
	if (!r.lastStartedAt) return { tone: 'muted', label: 'never logged' };
	if (r.lastStatus === 'error') return { tone: 'bad', label: `error${r.lastHttpStatus ? ` ${r.lastHttpStatus}` : ''}` };
	if (r.stale) return { tone: 'bad', label: 'stale' };
	if (r.lastStatus === 'running') return { tone: 'warn', label: 'running' };
	return { tone: 'good', label: 'ok' };
}

function CronRoutes({ src }: { src: DevDashboardData['cron'] }) {
	if (src.state !== 'ok') return <section><SectionHeader title="Cron routes" /><NotConnected src={src} what="Cron log" /></section>;
	const routes = src.data.routes;
	const neverLogged = routes.every((r) => !r.lastStartedAt);
	return (
		<section>
			<SectionHeader title="Cron routes" count={routes.length} />
			{neverLogged && (
				<Callout tone="warning" className="mb-3">
					No ticks logged yet. Runs appear here once migration 0067 (cron_runs) is applied and the next schedule fires.
				</Callout>
			)}
			<Card padding="none" className="overflow-x-auto">
				<table className="w-full">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className={th}>Route</th>
							<th className={th}>Schedule</th>
							<th className={th}>Last run</th>
							<th className={`${th} text-right`}>Duration</th>
							<th className={th}>Last ok</th>
							<th className={th}>Status</th>
						</tr>
					</thead>
					<tbody>
						{routes.map((r) => {
							const t = cronTone(r);
							return (
								<tr key={r.route} className={tr}>
									<td className={`${td} font-mono`}>{r.route}</td>
									<td className={`${td} font-mono`}>{r.schedule}</td>
									<td className={`${td} whitespace-nowrap`}>{r.lastStartedAt ? formatRelative(r.lastStartedAt) : '—'}</td>
									<td className={tdNum}>{r.lastDurationMs != null ? `${(r.lastDurationMs / 1000).toFixed(1)}s` : '—'}</td>
									<td className={`${td} whitespace-nowrap`}>{r.lastOkAt ? formatRelative(r.lastOkAt) : '—'}</td>
									<td className={td}>
										<StatusText tone={t.tone} label={t.label} />
										{r.lastError && <p className="mt-1 text-2xs text-red-600 dark:text-red-400 font-mono">{r.lastError.slice(0, 160)}</p>}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</Card>
		</section>
	);
}

export default function DevPanels({ data }: { data: DevDashboardData }) {
	return (
		<div className="mt-6 space-y-6">
			<PullRequests src={data.github} />
			<Deploys src={data.vercel} />
			<Migrations data={data} />
			<CronRoutes src={data.cron} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Beacon — separate org, separate repo/project/database. Same panels, its
// own sources (lib/dev/load.ts loadBeaconDashboard). Migrations are not
// compared here: the ledger diff is against THIS repo's folder, which is
// meaningless for Beacon's schema, so the database panel shows size and
// advisors only.
// ---------------------------------------------------------------------------

function BeaconDatabase({ src }: { src: SourceState<DatabaseSnapshot> }) {
	if (src.state !== 'ok') {
		return <section><SectionHeader title="Database" /><NotConnected src={src} what="Beacon Supabase Management API" /></section>;
	}
	const d = src.data;
	const advisorLine = (label: string, a: { errors: number; warnings: number } | null) =>
		a ? `${label}: ${a.errors} errors · ${a.warnings} warnings` : `${label}: unavailable`;
	return (
		<section>
			<SectionHeader title="Database" count={d.projectRef} />
			<Card>
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
					<div>
						<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">Size</p>
						<p className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{formatBytes(d.sizeBytes)}</p>
					</div>
					<div>
						<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">Tables</p>
						<p className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{d.tableCount}</p>
					</div>
					<div>
						<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">Migrations applied</p>
						<p className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{d.ledger.length}</p>
					</div>
					<div>
						<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">Advisors</p>
						<p className="text-xs text-slate-700 dark:text-slate-300">
							{advisorLine('Security', d.advisors.security)}<br />
							{advisorLine('Performance', d.advisors.performance)}
						</p>
					</div>
				</div>
			</Card>
		</section>
	);
}

export function BeaconPanels({ data }: { data: BeaconDashboardData }) {
	const nothingConfigured =
		data.github.state === 'not_connected' &&
		data.vercel.state === 'not_connected' &&
		data.database.state === 'not_connected';
	return (
		<div className="mt-6 space-y-6">
			{nothingConfigured && (
				<Callout tone="info">
					Beacon is a separate GitHub repo, Vercel project and database. None of its identifiers are set
					yet: add <code className="font-mono text-xs">{BEACON_ENV.repo}</code> (owner/name),{' '}
					<code className="font-mono text-xs">{BEACON_ENV.vercelProject}</code>,{' '}
					<code className="font-mono text-xs">{BEACON_ENV.vercelTeam}</code>,{' '}
					<code className="font-mono text-xs">{BEACON_ENV.vercelToken}</code> and, for the database,{' '}
					<code className="font-mono text-xs">{BEACON_ENV.supabaseRef}</code> +{' '}
					<code className="font-mono text-xs">{BEACON_ENV.supabaseToken}</code> in Vercel (docs/ENV.md).
					GitHub reuses <code className="font-mono text-xs">GITHUB_TOKEN</code> unless{' '}
					<code className="font-mono text-xs">{BEACON_ENV.githubToken}</code> is set.
				</Callout>
			)}
			<PullRequests src={data.github} />
			<Deploys src={data.vercel} />
			<BeaconDatabase src={data.database} />
		</div>
	);
}
