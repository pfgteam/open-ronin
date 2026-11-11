// GET /api/ghl/callback?code=...&state=...
// Exchanges the authorization code for tokens, persists the ghl_connections
// row, then redirects back to /admin/integrations/ghl.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { exchangeAuthCode } from '@/lib/ghl/client';
import { encryptToken } from '@/lib/ghl/crypto';
import { safeInternalPath } from '@/lib/safeRedirect';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
	const code = req.nextUrl.searchParams.get('code');
	const state = req.nextUrl.searchParams.get('state');
	const error = req.nextUrl.searchParams.get('error');
	if (error) return errorRedirect(req, error);
	if (!code || !state) return errorRedirect(req, 'Missing code or state');

	const sb = createServiceRoleClient();

	// Validate state
	const { data: stateRow } = await sb
		.from('ghl_oauth_states')
		.select('*')
		.eq('state', state)
		.maybeSingle();
	if (!stateRow) return errorRedirect(req, 'Unknown or expired state');
	if (new Date(stateRow.expires_at) < new Date()) {
		return errorRedirect(req, 'OAuth state expired - try again');
	}

	// Exchange code
	let token;
	try {
		token = await exchangeAuthCode(code);
	} catch (e) {
		return errorRedirect(req, (e as Error).message);
	}

	// Persist the connection
	const scope = token.user_type === 'Company' ? 'company' : 'location';
	const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

	const { error: upsertError } = await sb
		.from('ghl_connections')
		.upsert(
			{
				scope,
				ghl_company_id: token.companyId ?? null,
				ghl_location_id: token.locationId ?? null,
				ghl_user_id: token.userId ?? null,
				label: stateRow.sub_account_label ?? null,
				encrypted_access_token: encryptToken(token.access_token),
				encrypted_refresh_token: encryptToken(token.refresh_token),
				token_type: token.token_type,
				scopes: token.scope,
				expires_at: expiresAt,
				installed_by: stateRow.initiated_by,
				last_refresh_at: new Date().toISOString(),
				last_refresh_error: null,
				disconnected_at: null,
			},
			{ onConflict: 'scope,ghl_location_id,ghl_company_id' },
		);

	if (upsertError) return errorRedirect(req, upsertError.message);

	// Clear the state row
	await sb.from('ghl_oauth_states').delete().eq('state', state);

	// Re-validated on read, not just on write: rows persisted before the
	// install-side guard existed may still carry an off-site value.
	const redirectTarget = safeInternalPath(stateRow.redirect_after, '/admin/integrations/ghl');
	return NextResponse.redirect(new URL(redirectTarget, req.url));
}

function errorRedirect(req: NextRequest, message: string): NextResponse {
	const url = new URL('/admin/integrations/ghl', req.url);
	url.searchParams.set('error', message);
	return NextResponse.redirect(url);
}
