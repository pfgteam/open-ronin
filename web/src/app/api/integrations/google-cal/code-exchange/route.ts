// POST /api/integrations/google-cal/code-exchange
//
// Counterpart to the GIS popup connect flow in GoogleCalConnect.tsx.
// Body: { code: string }
//
// Mirrors the redirect callback (/callback) but driven by an XHR from
// the browser instead of a 302. Exchanges code for tokens, identifies
// the Google account, upserts google_calendar_connections, and kicks
// the first sync.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, userInfo } from '@/lib/google/calendar';
import { encryptToken } from '@/lib/ghl/crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	let code: string | undefined;
	try {
		const body = await request.json();
		code = body?.code;
	} catch {
		return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
	}
	if (!code) return NextResponse.json({ error: 'Missing code.' }, { status: 400 });

	let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
	try {
		// GIS popup flow → redirect_uri must be "postmessage"
		tokens = await exchangeCodeForTokens(code, 'popup');
	} catch (e) {
		return NextResponse.json({ error: `Token exchange: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
	}

	let email: string | null = null;
	try {
		const info = await userInfo(tokens.refresh_token);
		email = info.email;
	} catch { /* non-fatal */ }

	const { error } = await supabase
		.from('google_calendar_connections')
		.upsert({
			user_id: auth.user.id,
			google_calendar_id: 'primary',
			google_account_email: email,
			encrypted_refresh_token: encryptToken(tokens.refresh_token),
			scope: tokens.scope.split(' '),
			sync_token: null,
			sync_status: 'ok',
			bidirectional: true,
		}, { onConflict: 'user_id,google_calendar_id' });

	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	// Fire-and-forget initial sync
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL('/', request.url).origin;
	try {
		await fetch(`${appUrl}/api/integrations/google-cal/sync`, {
			method: 'POST',
			headers: { cookie: request.headers.get('cookie') ?? '' },
		});
	} catch { /* ignore */ }

	return NextResponse.json({ ok: true, email });
}
