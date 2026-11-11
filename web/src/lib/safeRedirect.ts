// Same-origin redirect guard.
//
// `new URL(next, origin)` does NOT force the origin: a protocol-relative
// value ("//evil.com/x") and an absolute one ("https://evil.com") both win
// over the base. That made every redirect built that way an open redirect —
// the victim authenticates for real, gets a session cookie, and then lands on
// an attacker page while feeling logged in.
//
// The login page (src/app/auth/login/page.tsx) already had this check inline;
// this module is the shared version so the callbacks stop drifting from it.

// Control characters would allow path/header splitting downstream.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Returns `candidate` when it is a safe same-origin path, otherwise `fallback`.
 *
 * Safe means: starts with exactly one `/`, and carries no scheme, no
 * backslash (path confusion) and no control characters.
 */
export function safeInternalPath(candidate: string | null | undefined, fallback = '/'): string {
	if (!candidate) return fallback;

	// Reject anything that isn't a rooted path. "//host" and "/\host" are both
	// treated as network-path references by browsers.
	if (!candidate.startsWith('/')) return fallback;
	if (candidate.startsWith('//')) return fallback;

	if (candidate.includes('\\')) return fallback;
	if (CONTROL_CHARS.test(candidate)) return fallback;

	return candidate;
}
