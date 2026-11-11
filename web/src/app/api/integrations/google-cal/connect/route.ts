// GET /api/integrations/google-cal/connect
//
// Kicks off the Google Calendar OAuth flow. Generates a state token tied
// to the current Supabase user, stashes it briefly, then 302s the browser
// to Google's consent screen. Callback at /api/integrations/google-cal/callback.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { authUrl, callbackUriFor } from '@/lib/google/calendar';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	// State token: random nonce + user id, encoded together. The callback
	// verifies the nonce by reading the matching short-lived row from a tiny
	// state table — but we don't have one yet, so for now we just sign the
	// state with HMAC using SERVICE_ROLE_KEY so it's tamper-proof.
	const nonce = crypto.randomBytes(16).toString('hex');
	const payload = `${auth.user.id}.${nonce}`;
	const sig = crypto
		.createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY!)
		.update(payload)
		.digest('hex')
		.slice(0, 32);
	const state = `${payload}.${sig}`;

	// redirect_uri follows the request host (localhost in dev, env URL in
	// prod) — Google requires the token exchange to reuse the exact same URI.
	return NextResponse.redirect(authUrl(state, callbackUriFor(request.url)));
}
