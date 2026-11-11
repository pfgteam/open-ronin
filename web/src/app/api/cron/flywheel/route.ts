// GET /api/cron/flywheel. Vercel Cron, every 5 minutes (web/vercel.json).
// F3: drains the AI visibility audit queue (panel x prompts), retries
// failed answers once, and on the first daily tick of a month queues the
// monthly re-scan for every active program with locked prompts. Later
// phases add approvals / reminders / health here. CRON_SECRET gates;
// service role.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { advanceAudits, retryFailedAnswers, scheduleMonthlyRescans } from '@/lib/flywheel/audit';
import { pullGoogleMetrics } from '@/lib/flywheel/portal';
import { monthlyReports, sendDueReminders, weeklyRecaps } from '@/lib/flywheel/reports';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/flywheel', async () => {
		const db = createServiceRoleClient();
		const audits = await advanceAudits(db, { budgetMs: 45_000 });
		const retried = await retryFailedAnswers(db);
		const now = new Date();
		const daily = now.getUTCHours() === 13 && now.getUTCMinutes() < 5;
		const rescans = daily && now.getUTCDate() <= 3 ? await scheduleMonthlyRescans(db) : null;
		// F5 (0144): silent approvals whose window passed (client auto-approve toggle); weekly Google metrics pull.
		const { data: auto } = await db.rpc('fw_auto_approve_due');
		const google = daily && now.getUTCDay() === 1 ? await pullAllGoogle(db) : null;
		// F6 / F7 (0146): reminders + escalation ladder, client reminder emails, Friday recaps, monthly reports (day 3), health check (daily).
		const { data: reminders } = await db.rpc('fw_reminders_tick');
		const reminderMail = await sendDueReminders(db);
		const recaps = daily && now.getUTCDay() === 5 ? await weeklyRecaps(db) : null;
		const monthly = daily && now.getUTCDate() === 3 ? await monthlyReports(db) : null;
		const { data: health } = daily ? await db.rpc('fw_health_check', { p_program: null }) : { data: null };
		return NextResponse.json({ audits, retried, rescans, auto_approved: auto ?? 0, google, reminders, reminderMail, recaps, monthly, health });
	});
}

async function pullAllGoogle(db: ReturnType<typeof createServiceRoleClient>): Promise<{ pulled: number; failed: string[] }> {
	const { data } = await db.from('fw_google_connections').select('client_id').eq('status', 'connected');
	const out = { pulled: 0, failed: [] as string[] };
	for (const c of (data ?? []) as { client_id: string }[]) {
		const r = await pullGoogleMetrics(db, c.client_id);
		if (r.ok) out.pulled++;
		else out.failed.push(`${c.client_id.slice(0, 8)}: ${r.error}`);
	}
	return out;
}
