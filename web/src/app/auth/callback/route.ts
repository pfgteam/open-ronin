// OAuth + magic-link callback.
// Supabase redirects here with a `code` after Google OAuth or after a
// password-recovery / signup confirmation email. We exchange the code for
// a session cookie and bounce the user to their destination.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/safeRedirect';

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	// Same-origin only. `new URL(next, origin)` happily honours "//evil.com",
	// so an unvalidated `next` bounced a freshly authenticated user off-site.
	const next = safeInternalPath(url.searchParams.get('next'));
	const type = url.searchParams.get('type');
	const errorDescription = url.searchParams.get('error_description');

	if (errorDescription) {
		const back = new URL('/auth/login', url.origin);
		back.searchParams.set('error', errorDescription);
		return NextResponse.redirect(back);
	}

	if (!code) {
		// Implicit-flow links (the portal magic link is requested server-side with
		// the service-role client, which has no PKCE verifier) arrive with the
		// tokens in the URL FRAGMENT, which never reaches this handler. Hand off
		// to a client page that reads the fragment and sets the session; the
		// browser keeps the fragment across a redirect whose Location has none.
		const finish = new URL('/auth/callback/finish', url.origin);
		finish.searchParams.set('next', next);
		return NextResponse.redirect(finish);
	}

	const supabase = await createClient();
	const { error } = await supabase.auth.exchangeCodeForSession(code);

	if (error) {
		const back = new URL('/auth/login', url.origin);
		back.searchParams.set('error', error.message);
		return NextResponse.redirect(back);
	}

	// Password recovery flow lands on a reset form rather than the dashboard.
	if (type === 'recovery') {
		return NextResponse.redirect(new URL('/auth/reset-password', url.origin));
	}

	return NextResponse.redirect(new URL(next, url.origin));
}
