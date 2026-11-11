// GET /api/integrations/google-cal/callback?code=...&state=user_id.nonce.sig
//
// Google redirects back here after consent. We:
//   1. Verify the HMAC-signed state to confirm the right user.
//   2. Exchange the auth code for tokens (access + refresh).
//   3. Look up the connected Google account's email.
//   4. Upsert a google_calendar_connections row (one per user × calendar).
//   5. Trigger an initial sync, then redirect to /the-work/calendar.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callbackUriFor, exchangeCodeForTokens, userInfo } from '@/lib/google/calendar';
import { encryptToken } from '@/lib/ghl/crypto';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const errorParam = url.searchParams.get('error');

	// Post-connect redirect stays on the host that ran the flow — same
	// domain as the session cookie, whatever that domain is.
	const appUrl = new URL(request.url).origin;

	if (errorParam) {
		return NextResponse.redirect(`${appUrl}/the-work/calendar?error=${encodeURIComponent(errorParam)}`);
	}
	if (!code || !state) {
		return NextResponse.redirect(`${appUrl}/the-work/calendar?error=missing_code_or_state`);
	}

	// state = "<user_id>.<nonce>.<sig>"
	const parts = state.split('.');
	if (parts.length !== 3) {
		return NextResponse.redirect(`${appUrl}/the-work/calendar?error=invalid_state`);
	}
	const [user_id, nonce, sig] = parts;
	const expectedSig = crypto
		.createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY!)
		.update(`${user_id}.${nonce}`)
		.digest('hex')
		.slice(0, 32);
	if (sig !== expectedSig) {
		return NextResponse.redirect(`${appUrl}/the-work/calendar?error=state_mismatch`);
	}

	let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
	try {
		tokens = await exchangeCodeForTokens(code, 'redirect', callbackUriFor(request.url));
	} catch (e) {
		return NextResponse.redirect(`${appUrl}/the-work/calendar?error=token_exchange&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
	}

	let email: string | null = null;
	try {
		const info = await userInfo(tokens.refresh_token);
		email = info.email;
	} catch { /* non-fatal; we can sync without knowing the email */ }

	const supabase = await createClient();
	// Use a service-role client variant if needed — for now the user's session
	// covers it because RLS on google_calendar_connections is "own user only".
	const { error } = await supabase
		.from('google_calendar_connections')
		.upsert({
			user_id,
			google_calendar_id: 'primary',
			google_account_email: email,
			encrypted_refresh_token: encryptToken(tokens.refresh_token),
			scope: tokens.scope.split(' '),
			sync_token: null,                                // first sync builds it
			sync_status: 'ok',
			bidirectional: true,
		}, { onConflict: 'user_id,google_calendar_id' });

	if (error) {
		return NextResponse.redirect(`${appUrl}/the-work/calendar?error=db_upsert&detail=${encodeURIComponent(error.message)}`);
	}

	// Kick the first sync inline (fire-and-forget — failures are visible via
	// sync_status on the connection row).
	try {
		await fetch(`${appUrl}/api/integrations/google-cal/sync`, {
			method: 'POST',
			headers: { cookie: request.headers.get('cookie') ?? '' },
		});
	} catch { /* ignore — user can hit Sync button */ }

	return NextResponse.redirect(`${appUrl}/the-work/calendar?connected=1`);
}
