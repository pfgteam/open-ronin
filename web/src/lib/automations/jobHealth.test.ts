import { describe, expect, it } from 'vitest';
import { jobAlertCopy, jobAlertDedupeKey, jobsToAlert } from './jobHealth';
import { externalJobStale, mapExternalJob, type AutomationRow } from './inventory';

const NOW = Date.parse('2026-09-19T12:00:00Z');

function row(over: Partial<AutomationRow> = {}): AutomationRow {
	return { source: 'vercel_cron', id: '/api/cron/x', name: 'X', trigger: 'daily', active: true, lastRunAt: null, lastStatus: 'ok', lastError: null, lastDurationMs: null, href: null, stale: false, ...over };
}

describe('jobsToAlert', () => {
	it('stale wins over error; inactive rows are skipped; healthy rows are not alerted', () => {
		const alerts = jobsToAlert([
			row({ id: 'a', stale: true, lastStatus: 'error' }),
			row({ id: 'b', lastStatus: 'error' }),
			row({ id: 'c', active: false, lastStatus: 'error' }),
			row({ id: 'd' }),
		]);
		expect(alerts.map((a) => [a.row.id, a.reason])).toEqual([['a', 'stale'], ['b', 'error']]);
	});
	it('copy summarizes counts and names; key is per job per day', () => {
		const alerts = jobsToAlert([row({ id: 'a', name: 'Sheet sync', stale: true }), row({ id: 'b', name: 'Scrapers', lastStatus: 'error' })]);
		const { title, body } = jobAlertCopy(alerts);
		expect(title).toBe('2 automations need attention');
		expect(body).toContain('1 stale (Sheet sync)');
		expect(body).toContain('1 errored (Scrapers)');
		expect(jobAlertDedupeKey(alerts[0].row, 'stale', '2026-09-19')).toBe('job-health:vercel_cron:a:stale:2026-09-19');
	});
});

describe('externalJobStale / mapExternalJob', () => {
	const base = { id: 'e1', source: 'hermes' as const, job_key: 'pulse.crm', name: 'CRM escalation', owner: 'pulse', schedule_text: 'monthly', expected_interval_minutes: 60, href: null, enabled: true, last_started_at: '2026-09-19T11:00:00Z', last_finished_at: '2026-09-19T11:01:00Z', last_status: 'ok' as const, last_error: null, last_duration_ms: 60000 };
	it('stale after two intervals + 5 min, never when no interval, always when never ran', () => {
		expect(externalJobStale(base, NOW)).toBe(false);
		expect(externalJobStale({ ...base, last_started_at: '2026-09-19T09:00:00Z' }, NOW)).toBe(true);
		expect(externalJobStale({ ...base, expected_interval_minutes: null, last_started_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false);
		expect(externalJobStale({ ...base, last_started_at: null }, NOW)).toBe(true);
		expect(externalJobStale({ ...base, enabled: false, last_started_at: null }, NOW)).toBe(false);
	});
	it('maps to the inventory row shape with the owner in the name', () => {
		const m = mapExternalJob(base, NOW);
		expect(m.source).toBe('hermes');
		expect(m.name).toBe('CRM escalation (pulse)');
		expect(m.trigger).toBe('monthly');
		expect(m.stale).toBe(false);
	});
});
