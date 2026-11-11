// GET /api/cron/job-health — Vercel Cron, hourly (see web/vercel.json).
//
// The alarm the architecture doc admits does not exist ("nothing alarms on
// a stuck or errored connection"; BOT_ROSTER_SYNTHESIS Tier A #6, six bots).
// Reads the same inventory /social/automations renders (Vercel cron via
// cron_health, n8n when connected, Hermes crons via external_jobs) and
// writes ONE in-app notification per admin/exec per day while anything is
// stale or errored. Dedupe key carries the day, so a broken job nags once a
// day, and a new breakage the same day gets its own key (the key is per job).
//
// Service role on purpose: notifications for other people (0039). Gated by
// CRON_SECRET, fails closed. Never alerts on itself: a job-health row that
// errored would otherwise alert forever.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { businessToday } from '@/lib/format';
import { loadAutomationsInventory } from '@/lib/automations/inventory';
import { jobAlertCopy, jobAlertDedupeKey, jobsToAlert } from '@/lib/automations/jobHealth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SELF = '/api/cron/job-health';

export async function GET(request: Request) {
	return withCronRun(request, SELF, async () => {
		const inv = await loadAutomationsInventory();
		const alerts = jobsToAlert(inv.rows.filter((r) => r.id !== SELF));
		if (alerts.length === 0) return NextResponse.json({ ok: true, alerts: 0 });

		const supabase = createServiceRoleClient();
		const { data: recipients, error: rErr } = await supabase.from('profiles').select('id').in('role', ['admin', 'exec']).eq('is_active', true).returns<{ id: string }[]>();
		if (rErr) {
			console.error('[cron/job-health] recipients read failed:', rErr.message);
			return NextResponse.json({ error: 'Could not read recipients.' }, { status: 500 });
		}
		const day = businessToday();
		const { title, body } = jobAlertCopy(alerts);
		// One key per (job, reason, day); the digest text is the same for all
		// of them, so the first insert of the day carries the digest and later
		// ones for the same job are duplicates. A NEW job breaking later in the
		// day has a fresh key and lands a second digest, which is what we want.
		const payload = (recipients ?? []).flatMap((p) =>
			alerts.map((a) => ({
				user_id: p.id,
				kind: 'job_health',
				title,
				body,
				href: '/social/automations',
				dedupe_key: jobAlertDedupeKey(a.row, a.reason, day),
			})),
		);
		const { data: inserted, error } = await supabase.from('notifications').upsert(payload, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id');
		if (error) {
			console.error('[cron/job-health] insert failed:', error.message);
			return NextResponse.json({ error: 'Could not write notifications.' }, { status: 500 });
		}
		return NextResponse.json({
			ok: true,
			alerts: alerts.length,
			stale: alerts.filter((a) => a.reason === 'stale').map((a) => a.row.id),
			errored: alerts.filter((a) => a.reason === 'error').map((a) => a.row.id),
			recipients: recipients?.length ?? 0,
			sent: inserted?.length ?? 0,
		});
	});
}
