// GET /api/portal/google/start — begin the Google OAuth (GA4 / Search
// Console / GBP read scopes) for the signed-in portal client.
import { NextResponse } from 'next/server';
import { getPortalSession, googleAuthUrl, googleConfigured, signState } from '@/lib/flywheel/portal';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const origin = new URL(request.url).origin;
	const s = await getPortalSession(null);
	if (!s) return NextResponse.redirect(new URL('/portal', origin), 303);
	if (!googleConfigured()) return NextResponse.redirect(new URL('/portal?tab=connections&error=Google+sign-in+is+not+configured+yet.', origin), 303);
	return NextResponse.redirect(googleAuthUrl(signState(s.client_id)), 303);
}
