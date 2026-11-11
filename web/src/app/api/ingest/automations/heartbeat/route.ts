// POST /api/ingest/automations/heartbeat — any off-platform scheduled job
// (Hermes crons first) reports itself so it shows up in /social/automations
// beside Vercel cron and n8n (BOT_ROSTER_SYNTHESIS Tier A #3, raised by 12
// bots). One row per job in public.external_jobs (0108), upserted per call.
//
// Not the batch ingest contract (lib/ingest/server): a heartbeat is one job,
// one status, fire-and-forget from a cron's last line. Same INGEST_API_KEY
// gate, fails closed. Body:
//   { source?: 'hermes'|'n8n'|'github'|'other', job_key, name, status:
//     'ok'|'error'|'running', owner?, schedule_text?,
//     expected_interval_minutes?, href?, started_at?, finished_at?,
//     duration_ms?, error?, summary? }
// job_key convention for Hermes: '<profile>.<cron-name-slug>'.
//
// Hermes side, from any cron job's final step:
//   curl -s -X POST https://app.example.com/api/ingest/automations/heartbeat \
//     -H "Authorization: Bearer $OR_INGEST_API_KEY" -H 'Content-Type: application/json' \
//     -d '{"job_key":"pulse.monthly-crm-escalation","name":"Monthly CRM escalation",
//          "status":"ok","owner":"pulse","schedule_text":"15th 09:00 CT","expected_interval_minutes":44640}'

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { denyUnlessIngest } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

const Heartbeat = z.object({
	source: z.enum(['hermes', 'n8n', 'github', 'other']).default('hermes'),
	job_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,119}$/),
	name: z.string().trim().min(1).max(200),
	status: z.enum(['ok', 'error', 'running']),
	owner: z.string().trim().max(80).optional(),
	schedule_text: z.string().trim().max(120).optional(),
	expected_interval_minutes: z.number().int().min(1).max(60 * 24 * 35).optional(),
	href: z.string().regex(/^(https?:\/\/|\/)/).max(500).optional(),
	started_at: z.string().datetime({ offset: true }).optional(),
	finished_at: z.string().datetime({ offset: true }).optional(),
	duration_ms: z.number().int().min(0).max(1000 * 60 * 60 * 24).optional(),
	error: z.string().max(4000).optional(),
	summary: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
	const denied = denyUnlessIngest(request);
	if (denied) return denied;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	const parsed = Heartbeat.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: 'Invalid heartbeat.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
	}
	const h = parsed.data;
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.rpc('external_job_heartbeat', {
		p_source: h.source,
		p_job_key: h.job_key,
		p_name: h.name,
		p_status: h.status,
		p_owner: h.owner ?? null,
		p_schedule_text: h.schedule_text ?? null,
		p_expected_interval_minutes: h.expected_interval_minutes ?? null,
		p_href: h.href ?? null,
		p_started_at: h.started_at ?? null,
		p_finished_at: h.finished_at ?? null,
		p_duration_ms: h.duration_ms ?? null,
		p_error: h.error ?? null,
		p_summary: h.summary ?? null,
	});
	if (error) {
		const notApplied = /external_job_heartbeat|does not exist/.test(error.message);
		console.error('[ingest/automations/heartbeat] failed:', error.message);
		return NextResponse.json({ error: notApplied ? 'Migration 0108 (external_jobs) is not applied yet.' : 'Could not record the heartbeat.' }, { status: notApplied ? 503 : 500 });
	}
	return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>) });
}
