// Job-health alerting (BOT_ROSTER_SYNTHESIS Tier A #6: "nothing alarms").
// Pure: decides which inventory rows deserve an alert and what to say. The
// cron route wires it to notifications with a dedupe key per (job, day), so
// a job that stays broken nags once a day, not once per tick.

import type { AutomationRow } from './inventory';

export type JobAlert = { row: AutomationRow; reason: 'stale' | 'error' };

export function jobsToAlert(rows: AutomationRow[]): JobAlert[] {
	const out: JobAlert[] = [];
	for (const r of rows) {
		if (!r.active) continue;
		if (r.stale) out.push({ row: r, reason: 'stale' });
		else if (r.lastStatus === 'error') out.push({ row: r, reason: 'error' });
	}
	return out;
}

export function jobAlertDedupeKey(row: AutomationRow, reason: JobAlert['reason'], dayIso: string): string {
	return `job-health:${row.source}:${row.id}:${reason}:${dayIso}`;
}

export function jobAlertCopy(alerts: JobAlert[]): { title: string; body: string } {
	const stale = alerts.filter((a) => a.reason === 'stale');
	const errored = alerts.filter((a) => a.reason === 'error');
	const parts: string[] = [];
	if (stale.length) parts.push(`${stale.length} stale (${stale.map((a) => a.row.name).slice(0, 4).join(', ')}${stale.length > 4 ? ', …' : ''})`);
	if (errored.length) parts.push(`${errored.length} errored (${errored.map((a) => a.row.name).slice(0, 4).join(', ')}${errored.length > 4 ? ', …' : ''})`);
	return {
		title: `${alerts.length} automation${alerts.length === 1 ? '' : 's'} need attention`,
		body: `${parts.join('; ')}. Open Automations to see last run and error.`,
	};
}
