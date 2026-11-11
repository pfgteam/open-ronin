// GET /api/cron/token-hygiene — Vercel Cron, daily (see web/vercel.json).
//
// Brief constraint (Unified Comms, Sept 2026): "No credential ... in plaintext
// anywhere. Tokens for connected accounts are encrypted at the application
// layer with a key held in the host secret store." The GHL AES-256-GCM helper
// (lib/ghl/crypto) already does the encryption; google_calendar_connections
// rows written before 2026-08-20, and any row written while
// GHL_TOKEN_ENC_KEY was unset in production, still hold the raw Google refresh
// token. storedRefreshToken() tolerates both forms, so this job can re-encrypt
// in place without a reconnect and without touching the token's validity.
//
// Idempotent: only rows whose token does not start with the `v1:` envelope
// are touched; a second run finds nothing. Fails closed: if the key is not
// configured, encryptToken throws and the route reports it instead of
// silently leaving plaintext behind. Never logs token material.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { encryptToken } from '@/lib/ghl/crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type PlainRow = { id: string; encrypted_refresh_token: string | null };

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/token-hygiene', () => run());
}

async function run(): Promise<Response> {
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase
		.from('google_calendar_connections')
		.select('id, encrypted_refresh_token')
		.not('encrypted_refresh_token', 'is', null)
		.not('encrypted_refresh_token', 'like', 'v1:%')
		.returns<PlainRow[]>();
	if (error) {
		console.error('[cron/token-hygiene] scan failed:', error.message);
		return NextResponse.json({ error: 'Could not scan connections.' }, { status: 500 });
	}

	let encrypted = 0;
	const failures: string[] = [];
	for (const row of data ?? []) {
		if (!row.encrypted_refresh_token) continue;
		try {
			const { error: updateError } = await supabase
				.from('google_calendar_connections')
				.update({ encrypted_refresh_token: encryptToken(row.encrypted_refresh_token) })
				.eq('id', row.id)
				// Guard against a reconnect that landed between the scan and this write.
				.not('encrypted_refresh_token', 'like', 'v1:%');
			if (updateError) throw new Error(updateError.message);
			encrypted += 1;
		} catch (e) {
			failures.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (failures.length) console.error('[cron/token-hygiene] failures:', failures);
	return NextResponse.json({
		ok: failures.length === 0,
		scanned: data?.length ?? 0,
		encrypted,
		failures: failures.length ? failures : undefined,
	});
}
