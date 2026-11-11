// GET /api/portal/google/callback — Google OAuth redirect. The signed state
// carries the client id; the portal session must match it.
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { exchangeGoogleCode, getPortalSession, portalLabel, saveGoogleConnection, verifyState } from '@/lib/flywheel/portal';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const url = new URL(request.url);
	const back = (q: string) => NextResponse.redirect(new URL(`/portal?tab=connections&${q}`, url.origin), 303);
	const err = url.searchParams.get('error');
	if (err) return back(`error=${encodeURIComponent(err)}`);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) return back('error=Missing+code.');
	const clientId = verifyState(state);
	if (!clientId) return back('error=Invalid+state.');
	const s = await getPortalSession(clientId);
	if (!s || s.client_id !== clientId) return NextResponse.redirect(new URL('/portal', url.origin), 303);
	try {
		const tok = await exchangeGoogleCode(code);
		if (!tok.refresh_token) return back('error=Google+did+not+return+a+refresh+token.+Remove+Open Ronin+from+your+Google+account+permissions+and+try+again.');
		let email: string | null = null;
		if (tok.id_token) {
			try {
				email = (JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64').toString('utf8')) as { email?: string }).email ?? null;
			} catch {
				email = null;
			}
		}
		await saveGoogleConnection(createServiceRoleClient(), { client_id: clientId, refresh_token: tok.refresh_token, email, scopes: tok.scope.split(' '), by_user: s.user.id, by_label: portalLabel(s) });
		return back('connected=1');
	} catch (e) {
		return back(`error=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : 'Connection failed.')}`);
	}
}
