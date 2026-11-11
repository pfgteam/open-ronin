// POST /api/intake/ghl/webhook — GHL → Open Ronin (0123). Point GHL workflow
// "Webhook" actions (contact created / updated, opportunity stage changed,
// inbound/outbound message, appointment, form submitted, call completed)
// here with the `ghl` intake source token in x-intake-token (or ?token=,
// since GHL's webhook action cannot always set headers).
//
// Everything is recorded in ghl_webhook_events (idempotent on the event id)
// and handled by lib/revenue/ghlSync.handleWebhook: activities on the
// matched person/deal, stage changes logged (applied only when the cutover
// says so), unknown inbound contacts become intake.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { presentedToken, tokenMatches, type IntakeSourceRow } from '@/lib/revenue/intake';
import { handleWebhook } from '@/lib/revenue/ghlSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
	const db = createServiceRoleClient();
	const { data } = await db.from('rev_intake_sources').select('*').eq('key', 'ghl').maybeSingle();
	const source = data as IntakeSourceRow | null;
	if (!source?.enabled || !source.token_hash) return NextResponse.json({ error: 'The GHL connector is disabled. Enable it in Admin → Prospects → Connectors.' }, { status: 401 });
	const url = new URL(request.url);
	const token = presentedToken(request) ?? url.searchParams.get('token');
	if (!tokenMatches(token, source.token_hash)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Empty payload.' }, { status: 400 });
	const r = await handleWebhook(db, body as Record<string, unknown>);
	return NextResponse.json(r, { status: r.status === 'failed' ? 500 : 200 });
}
