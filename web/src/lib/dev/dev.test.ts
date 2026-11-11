import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { ageInDays, countByAuthor, summarizeChecks } from './github';
import { firstErrorLine, summarizeDeploys, toDeploy } from './vercel';
import { compareLedger, formatBytes, summarizeLints } from './supabase';
import { isStale, joinHealth, periodMinutes } from './cron';
import { MIGRATION_FILES } from './migrationFiles';
import type { Deploy } from './types';

describe('github: summarizeChecks', () => {
	it('reads none when nothing reported', () => {
		expect(summarizeChecks([], []).state).toBe('none');
	});
	it('one failure wins over passing and pending', () => {
		const out = summarizeChecks(
			[
				{ status: 'completed', conclusion: 'success' },
				{ status: 'in_progress', conclusion: null },
				{ status: 'completed', conclusion: 'failure' },
			],
			[],
		);
		expect(out).toEqual({ state: 'failing', passed: 1, failed: 1, pending: 1, total: 3 });
	});
	it('skipped and neutral runs are neither passed nor failed', () => {
		const out = summarizeChecks(
			[
				{ status: 'completed', conclusion: 'skipped' },
				{ status: 'completed', conclusion: 'neutral' },
				{ status: 'completed', conclusion: 'success' },
			],
			[],
		);
		expect(out).toEqual({ state: 'passing', passed: 1, failed: 0, pending: 0, total: 1 });
	});
	it('counts only the newest commit status per context', () => {
		const out = summarizeChecks(
			[],
			[
				{ state: 'success', context: 'Vercel' },
				{ state: 'failure', context: 'Vercel' },
			],
		);
		expect(out.state).toBe('passing');
		expect(out.total).toBe(1);
	});
});

describe('github: helpers', () => {
	it('ageInDays floors and never goes negative', () => {
		const now = Date.parse('2026-09-12T12:00:00Z');
		expect(ageInDays('2026-09-10T00:00:00Z', now)).toBe(2);
		expect(ageInDays('2026-09-13T00:00:00Z', now)).toBe(0);
	});
	it('countByAuthor sorts by count then name and falls back to the commit author', () => {
		const out = countByAuthor([
			{ author: { login: 'b' }, commit: { author: { name: 'B' } } },
			{ author: { login: 'a' }, commit: { author: { name: 'A' } } },
			{ author: null, commit: { author: { name: 'ghost' } } },
			{ author: { login: 'a' }, commit: { author: { name: 'A' } } },
		]);
		expect(out).toEqual([
			{ author: 'a', count: 2 },
			{ author: 'b', count: 1 },
			{ author: 'ghost', count: 1 },
		]);
	});
});

describe('vercel', () => {
	it('toDeploy maps the v6 shape and upper cases the state', () => {
		const d = toDeploy({
			uid: 'dpl_1',
			url: 'open-ronin-abc.vercel.app',
			readyState: 'ready',
			target: 'production',
			created: Date.parse('2026-09-12T10:00:00Z'),
			ready: Date.parse('2026-09-12T10:03:00Z'),
			meta: { githubCommitSha: 'abcdef1234', githubCommitMessage: 'feat: x\n\nbody', githubCommitRef: 'main', githubCommitAuthorLogin: 'octocat' },
		});
		expect(d.state).toBe('READY');
		expect(d.target).toBe('production');
		expect(d.commitMessage).toBe('feat: x');
		expect(d.author).toBe('octocat');
		expect(d.readyAt).toBe('2026-09-12T10:03:00.000Z');
	});
	it('preview is the default target', () => {
		expect(toDeploy({ uid: 'x', url: 'u', state: 'ERROR', created: 0 }).target).toBe('preview');
	});
	it('summarizeDeploys buckets canceled with error and the rest as building', () => {
		const mk = (state: string): Deploy => ({ ...toDeploy({ uid: state, url: 'u', state, created: 0 }) });
		expect(summarizeDeploys([mk('READY'), mk('ERROR'), mk('CANCELED'), mk('BUILDING'), mk('QUEUED')])).toEqual({
			ready: 1,
			error: 2,
			building: 2,
		});
	});
	it('firstErrorLine prefers typed errors, then stderr mentioning an error, then the last stderr line', () => {
		expect(firstErrorLine([{ type: 'stderr', payload: { text: 'warning only' } }, { type: 'error', payload: { text: 'Type error: x' } }])).toBe('Type error: x');
		expect(firstErrorLine([{ type: 'stderr', payload: { text: 'note' } }, { type: 'stderr', payload: { text: 'Build failed at step 3' } }])).toBe('Build failed at step 3');
		expect(firstErrorLine([{ type: 'stderr', text: 'first' }, { type: 'stderr', text: 'last' }])).toBe('last');
		expect(firstErrorLine([{ type: 'stdout', text: 'ok' }])).toBeNull();
	});
});

describe('supabase: compareLedger', () => {
	it('reads zero when the ledger and folder match, allowing for the documented exceptions', () => {
		const files = ['0001_init', '0002_client_management', '0003_dashboard_layout', '0004_the_work', '0005_x'];
		const ledger = [
			{ version: '1', name: '0004_the_work_backfill' },
			{ version: '2', name: '0005_x' },
		];
		const m = compareLedger(ledger, files);
		expect(m.mismatch).toBe(0);
		expect(m.ledgerCount).toBe(2);
		expect(m.folderCount).toBe(5);
	});
	it('names unapplied files and missing rows', () => {
		const m = compareLedger([{ version: '1', name: '0009_gone' }], ['0010_new']);
		expect(m.unapplied).toEqual(['0010_new']);
		expect(m.missing).toEqual(['0009_gone']);
		expect(m.mismatch).toBe(2);
	});
	it('summarizeLints counts by level from either payload shape', () => {
		const url = 'https://example';
		expect(summarizeLints([{ level: 'ERROR' }, { level: 'WARN' }, { level: 'INFO' }], url)).toEqual({ errors: 1, warnings: 1, info: 1, url });
		expect(summarizeLints({ lints: [{ level: 'warning' }] }, url).warnings).toBe(1);
	});
	it('formatBytes', () => {
		expect(formatBytes(0)).toBe('0 MB');
		expect(formatBytes(5 * 1_048_576)).toBe('5.0 MB');
		expect(formatBytes(512 * 1_048_576)).toBe('512 MB');
		expect(formatBytes(3 * 1_073_741_824)).toBe('3.00 GB');
	});
});

describe('cron', () => {
	it('periodMinutes for the schedules vercel.json uses', () => {
		expect(periodMinutes('* * * * *')).toBe(1);
		expect(periodMinutes('*/5 * * * *')).toBe(5);
		expect(periodMinutes('0 * * * *')).toBe(60);
		expect(periodMinutes('30 9 * * *')).toBe(1440);
		expect(periodMinutes('0 */6 * * *')).toBe(360);
	});
	it('isStale allows two periods plus five minutes', () => {
		const now = Date.parse('2026-09-12T12:00:00Z');
		expect(isStale('*/5 * * * *', null, now)).toBe(true);
		expect(isStale('*/5 * * * *', '2026-09-12T11:50:00Z', now)).toBe(false);
		expect(isStale('*/5 * * * *', '2026-09-12T11:40:00Z', now)).toBe(true);
		expect(isStale('30 9 * * *', '2026-09-11T09:30:00Z', now)).toBe(false);
	});
	it('joinHealth keeps every configured route and counts unhealthy ones', () => {
		const now = Date.parse('2026-09-12T12:00:00Z');
		const out = joinHealth(
			[
				{ path: '/api/cron/a', schedule: '* * * * *' },
				{ path: '/api/cron/b', schedule: '0 * * * *' },
				{ path: '/api/cron/c', schedule: '0 * * * *' },
			],
			[
				{ route: '/api/cron/a', last_started_at: '2026-09-12T11:59:00Z', last_finished_at: null, last_status: 'ok', last_http_status: 200, last_duration_ms: 10, last_error: null, last_ok_at: '2026-09-12T11:59:00Z' },
				{ route: '/api/cron/b', last_started_at: '2026-09-12T11:00:00Z', last_finished_at: null, last_status: 'error', last_http_status: 500, last_duration_ms: 10, last_error: 'boom', last_ok_at: null },
			],
			now,
		);
		expect(out.routes.map((r) => r.route)).toEqual(['/api/cron/a', '/api/cron/b', '/api/cron/c']);
		expect(out.healthy).toBe(1);
		expect(out.unhealthy).toBe(2);
		expect(out.routes[2].stale).toBe(true);
	});
});

describe('migration manifest', () => {
	it('matches supabase/migrations on disk (run pnpm migrations:manifest after adding a file)', () => {
		const dir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
		const onDisk = readdirSync(dir)
			.filter((f) => /^(\d{14}|\d{4}[a-z]?)_.+\.sql$/.test(f))
			.map((f) => f.replace(/\.sql$/, ''))
			.sort();
		expect([...MIGRATION_FILES]).toEqual(onDisk);
	});
});
