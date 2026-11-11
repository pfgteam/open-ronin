// Fleet bridge: GET pending provisioning requests, POST acks and observed
// state. Called by scripts/hermes_bot_bridge.py from the Hermes host (the
// only thing that can run `hermes profile create` / `hermes config set`),
// authenticated with INGEST_API_KEY like every other ingest route.
//
//   GET  /api/ingest/bots            -> { requests: [...pending] }
//   POST /api/ingest/bots            body { kind: 'sync', host, hermes_version, profiles, catalog }
//                                    body { kind: 'ack', id, status: 'applied'|'failed', result?, error? }
//
// Tables and functions: migration 0112 (bot_profiles).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { denyUnlessIngest } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

const NOT_APPLIED_RE = /bot_requests_pending|bot_fleet_sync|bot_request_ack|does not exist|schema cache/i;

function notApplied(message: string) {
	return NOT_APPLIED_RE.test(message)
		? NextResponse.json({ error: 'Migration 0112 (bot profiles) is not applied yet.' }, { status: 503 })
		: null;
}

export async function GET(request: Request) {
	const denied = denyUnlessIngest(request);
	if (denied) return denied;
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.rpc('bot_requests_pending', { p_limit: 20 });
	if (error) {
		console.error('[ingest/bots] pending failed:', error.message);
		return notApplied(error.message) ?? NextResponse.json({ error: 'Could not read the queue.' }, { status: 500 });
	}
	return NextResponse.json({ requests: data ?? [] });
}

const Profile = z.object({
	name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
	display_name: z.string().max(80).optional(),
	description: z.string().max(600).optional(),
	model: z.string().max(120).optional(),
	provider: z.string().max(60).optional(),
	gateway_running: z.boolean().optional(),
	observed: z.record(z.string(), z.unknown()).default({}),
});

const Body = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('sync'),
		host: z.string().trim().min(1).max(120),
		hermes_version: z.string().trim().max(60).default(''),
		profiles: z.array(Profile).max(500),
		catalog: z.record(z.string(), z.unknown()).optional(),
	}),
	z.object({
		kind: z.literal('ack'),
		id: z.string().uuid(),
		status: z.enum(['applied', 'failed']),
		result: z.record(z.string(), z.unknown()).optional(),
		error: z.string().max(4000).optional(),
	}),
]);

export async function POST(request: Request) {
	const denied = denyUnlessIngest(request);
	if (denied) return denied;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	const parsed = Body.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'Invalid body.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
			{ status: 400 },
		);
	}
	const supabase = createServiceRoleClient();
	const b = parsed.data;

	if (b.kind === 'sync') {
		const { data, error } = await supabase.rpc('bot_fleet_sync', {
			p_host: b.host,
			p_hermes_version: b.hermes_version,
			p_profiles: b.profiles,
			p_catalog: b.catalog ?? null,
		});
		if (error) {
			console.error('[ingest/bots] sync failed:', error.message);
			return notApplied(error.message) ?? NextResponse.json({ error: 'Could not record the sync.' }, { status: 500 });
		}
		return NextResponse.json({ ok: true, ...(data as object) });
	}

	const { data, error } = await supabase.rpc('bot_request_ack', {
		p_id: b.id,
		p_status: b.status,
		p_result: b.result ?? null,
		p_error: b.error ?? null,
	});
	if (error) {
		console.error('[ingest/bots] ack failed:', error.message);
		if (/no pending request/.test(error.message)) return NextResponse.json({ error: 'No pending request with that id.' }, { status: 404 });
		return notApplied(error.message) ?? NextResponse.json({ error: 'Could not ack the request.' }, { status: 500 });
	}
	return NextResponse.json({ ok: true, ...(data as object) });
}
