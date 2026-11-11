// GET /api/cron/hiring. Vercel Cron, every 10 minutes (web/vercel.json).
// Drains enrichment jobs (links, resume parse, video transcript, LinkedIn
// when on), scores applications whose enrichment settled, refreshes the
// shortlists, sends interview reminders (24 h / 1 h), auto-marks no-shows,
// sends approved messages, and on the 13:30 UTC tick expires postings + bells the hiring
// manager / recruiter. CRON_SECRET gates; service role.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { advanceInterviews, advanceOnboarding, advancePostings } from '@/lib/hiring/cron';
import { runEnrichment, scorePending } from '@/lib/hiring/scoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/hiring', async () => {
		const db = createServiceRoleClient();
		const enrichment = await runEnrichment(db, 8);
		const scoring = await scorePending(db, 5);
		const interviews = await advanceInterviews(db);
		const now = new Date();
		const daily = now.getUTCHours() === 13 && now.getUTCMinutes() < 10;
		const postings = daily ? await advancePostings(db) : null;
		// H7 (0134): onboarding overdue bells, phase stamps, calibration enrolment after day 60
		const onboarding = daily ? await advanceOnboarding(db) : null;
		return NextResponse.json({ enrichment, scoring, interviews, postings, onboarding });
	});
}
