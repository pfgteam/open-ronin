// Middleware helper: refreshes the Supabase session cookie on each request
// and redirects unauthenticated traffic to /auth/login.
//
// Called from web/src/middleware.ts.
//
// FAIL SOFT: this runs on the edge in front of every page. When Supabase
// auth is slow or down (2026-09-15 outage: Nano compute wedged, auth hung,
// Vercel killed the middleware with 504 MIDDLEWARE_INVOCATION_TIMEOUT and
// the whole site went dark, including pages that never touch the DB), we
// must not hang with it. getUser() is raced against AUTH_TIMEOUT_MS. On
// timeout or error we let a request that CARRIES a session cookie through
// unverified; RLS and the server-side clients still enforce auth at the
// data layer, so the worst case is a rendered shell with empty data, not a
// 504. Requests with no cookie at all still bounce to login.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

interface CookieToSet {
	name: string;
	value: string;
	options?: CookieOptions;
}

// Edge middleware budget on Vercel is 25 s; a hung auth call should give up
// long before that so the page can still render in degraded mode.
export const AUTH_TIMEOUT_MS = 3000;

// Routes that must resolve without a session cookie.
//
// /api/cron is here because Vercel Cron calls it machine-to-machine — there is
// no session to carry. Without this the middleware would bounce every
// scheduled run to /auth/login, and the Vercel log would show a tidy 307 while
// the job silently never happened. Those routes defend themselves with
// CRON_SECRET (see lib/cron/auth.ts), which fails closed.
//
// /api/ingest + /api/contract-version are machine-to-machine the same way
// (Beacon's feeds) and defend themselves with INGEST_API_KEY
// (lib/ingest/server.ts), which also fails closed.
const PUBLIC_ROUTES = [
	'/auth', '/_next', '/favicon', '/api/health', '/api/cron',
	'/api/ingest', '/api/contract-version',
	// /api/mcp authenticates with its own bearer token inside the handler
	'/api/mcp',
	// /privacy must be reachable with no session — it's the Privacy Policy /
	// Data Deletion Instructions URL filed in the Meta app (App settings →
	// Basic → Privacy Policy URL / Data Deletion), and Meta's reviewer has no
	// Open Ronin login. See docs/phase0-human-prep/meta-app-review.md.
	'/privacy',
	// /terms is the Terms of Service URL filed in the same Meta app — same
	// signed-out requirement.
	'/terms',
	// /api/bridges/meta/webhook is called machine-to-machine by Meta (GET
	// hub.challenge handshake + POST events). The GET defends itself with
	// META_WEBHOOK_VERIFY_TOKEN; the POST is an ack-only App Review stub.
	'/api/bridges/meta/webhook',
	// Revenue Engine intake (0122): /api/intake/<source> defends itself with
	// the source's own token (rev_intake_sources.token_hash); /intake/<slug>
	// and /api/intake/form/<slug> are the public MQL form (off until the
	// rev_form_links row is flipped public).
	'/api/intake',
	'/intake',
	// Public forms (0158): /f/<slug> is the hosted form, /f/<slug>/embed the
	// iframe version, /f/embed.js the resize script; /api/f/<slug> is the
	// JSON door (+ /upload). Gate = forms.is_public (or the rev link).
	'/f',
	'/api/f',
	// Client portal (0126): /portal/contract/<token> is the signed-contract
	// view; the token (sha256 in rev_portal_tokens) is the credential.
	'/portal',
	// F6 (0146): /api/portal/open/<token>.gif is the report open pixel (public).

	// Growth loop (0127): /refer/<code> is the public 'send us a lead' form
	// (lands in intake with the referral attached); /feedback/<token> is the
	// post-call / client feedback form (token = sha256 in rev_feedback).
	'/refer',
	'/feedback',
	// Hiring (0129): /careers is the public careers page (example.com
	// /careers is served from it), /careers/feed.xml the aggregator feed,
	// /careers/go/<code> the tracked apply link; /api/careers/* its forms.
	'/careers',
	'/api/careers',
	// Client portal (0144): /portal is already public above (the page shows
	// the sign-in form when there is no session); /api/portal/* checks the
	// session inside the handler (uploads, Google OAuth callback).
	'/api/portal',
	// Proof Library (0160): /api/proof/* is the website's read + event door
	// (ready rows only, service role inside the handler, CORS open).
	'/api/proof',
];

// Match on SEGMENT boundaries, not raw prefixes: startsWith('/auth') would
// also make a future /authorize or /api/cronjobs-debug public by accident.
export function isPublic(pathname: string): boolean {
	return PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Supabase SSR stores the session under sb-<ref>-auth-token (chunked as
// .0, .1, ... when large). Presence is enough for the degraded path; we are
// not trusting it, only deciding whether to bounce to login.
export function hasSessionCookie(request: NextRequest): boolean {
	return request.cookies.getAll().some((c) => /^sb-.*-auth-token/.test(c.name));
}

type AuthProbe =
	| { kind: 'ok'; user: { id: string } | null }
	| { kind: 'unavailable'; reason: string };

// Race getUser() against the timeout. Any rejection or timeout is
// 'unavailable' — the caller decides what that means for the route.
export async function probeUser(
	getUser: () => Promise<{ data: { user: { id: string } | null } }>,
	timeoutMs: number = AUTH_TIMEOUT_MS,
): Promise<AuthProbe> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<AuthProbe>((resolve) => {
		timer = setTimeout(() => resolve({ kind: 'unavailable', reason: 'timeout' }), timeoutMs);
	});
	try {
		return await Promise.race([
			getUser().then((r): AuthProbe => ({ kind: 'ok', user: r.data.user })),
			timeout,
		]);
	} catch (err) {
		return { kind: 'unavailable', reason: err instanceof Error ? err.message : 'error' };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function updateSession(request: NextRequest) {
	let supabaseResponse = NextResponse.next({ request });

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return request.cookies.getAll();
				},
				setAll(cookiesToSet: CookieToSet[]) {
					cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
					supabaseResponse = NextResponse.next({ request });
					cookiesToSet.forEach(({ name, value, options }) =>
						supabaseResponse.cookies.set(name, value, options),
					);
				},
			},
		},
	);

	const { pathname } = request.nextUrl;

	// IMPORTANT: getUser() (not getSession()) — getUser revalidates the JWT.
	const probe = await probeUser(() => supabase.auth.getUser());

	if (probe.kind === 'unavailable') {
		// Auth backend is slow or down. Degrade, don't 504.
		if (isPublic(pathname) || hasSessionCookie(request)) {
			const res = NextResponse.next({ request });
			res.headers.set('x-or-auth-degraded', probe.reason);
			return res;
		}
		const loginUrl = new URL('/auth/login', request.url);
		loginUrl.searchParams.set('redirect', pathname);
		return NextResponse.redirect(loginUrl);
	}

	const { user } = probe;
	// Client portal (0144): a portal login (app_metadata.portal) may only use
	// /portal and its API; everything else bounces there. RLS already denies
	// them every row, this just keeps the staff shell from rendering empty.
	const isPortalLogin = !!user && (user as { app_metadata?: { portal?: boolean } }).app_metadata?.portal === true;
	if (isPortalLogin && !pathname.startsWith('/portal') && !pathname.startsWith('/api/portal') && !pathname.startsWith('/auth/callback') && !pathname.startsWith('/auth/confirm') && !pathname.startsWith('/_next') && !pathname.startsWith('/api/health')) {
		return NextResponse.redirect(new URL('/portal', request.url));
	}

	// Allow public routes through without auth.
	if (isPublic(pathname)) {
		// If already authenticated and visiting an auth page, bounce to Home.
		// /auth/confirm consumes a token_hash (portal magic link): it must run even
		// when a session already exists, like /auth/callback.
		if (user && pathname.startsWith('/auth') && !pathname.startsWith('/auth/callback') && !pathname.startsWith('/auth/confirm')) {
			return NextResponse.redirect(new URL(isPortalLogin ? '/portal' : '/', request.url));
		}
		return supabaseResponse;
	}

	// Protected route + no user → bounce to login.
	if (!user) {
		const loginUrl = new URL('/auth/login', request.url);
		loginUrl.searchParams.set('redirect', pathname);
		return NextResponse.redirect(loginUrl);
	}

	return supabaseResponse;
}
