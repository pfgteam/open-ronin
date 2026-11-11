// Google Calendar API wrapper — handles OAuth token refresh + the
// subset of Calendar v3 endpoints we use (events.list, events.insert,
// events.patch, events.delete, calendars.list).
//
// Design:
//   • Stateless — caller passes a GoogleCalConnection row (with refresh
//     token), we refresh access tokens on the fly when expired.
//   • All HTTP via native fetch (no googleapis dep — keeps bundle small).
//   • Returns plain JSON; the sync engine is responsible for mapping
//     between Google's event shape and our calendar_events schema.
//
// Env vars required:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   NEXT_PUBLIC_APP_URL   (used to compute the OAuth redirect URI)
//   GHL_TOKEN_ENC_KEY     (AES key shared with the GHL flow — encrypts refresh tokens at rest)

import { decryptToken } from '@/lib/ghl/crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_CAL_BASE  = 'https://www.googleapis.com/calendar/v3';

export const CAL_SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',         // read + write events
	'https://www.googleapis.com/auth/calendar.readonly',       // list calendars (the primary cal id)
	'openid', 'email', 'profile',                              // identify the connected Google account
];

export interface GoogleCalConnection {
	id: string;
	user_id: string;
	google_calendar_id: string;
	google_account_email: string | null;
	encrypted_refresh_token: string | null;   // AES-GCM `v1:` payload; pre-encryption rows are plaintext
	sync_token: string | null;
	last_synced_at: string | null;
	bidirectional: boolean;
}

export interface GoogleEvent {
	id: string;
	status?: string;
	/** 'default' | 'outOfOffice' | 'focusTime' | 'workingLocation' | 'birthday' —
	 *  Google's own classification; returned by default and authoritative for OOO/focus. */
	eventType?: string;
	summary?: string;
	description?: string;
	location?: string;
	htmlLink?: string;
	start?: { dateTime?: string; date?: string; timeZone?: string };
	end?:   { dateTime?: string; date?: string; timeZone?: string };
	recurrence?: string[];
	recurringEventId?: string;
	attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
	organizer?: { email?: string; displayName?: string };
	created?: string;
	updated?: string;
}

interface TokenPair { access_token: string; expires_at: number /* epoch ms */ }

// In-memory cache of access tokens keyed by refresh_token — avoids
// hitting Google's token endpoint on every API call within a request.
const accessTokenCache = new Map<string, TokenPair>();

export function authUrl(state: string, redirectUri: string = callbackUri()): string {
	const params = new URLSearchParams({
		client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: CAL_SCOPES.join(' '),
		access_type: 'offline',     // gives us a refresh_token
		prompt: 'consent',          // forces refresh_token even if previously granted
		include_granted_scopes: 'true',
		state,
	});
	return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function callbackUri(): string {
	const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	return `${base.replace(/\/$/, '')}/api/integrations/google-cal/callback`;
}

/** Callback URI for THIS request — always derived from the request origin,
 *  never from NEXT_PUBLIC_APP_URL. The OAuth round-trip MUST stay on the
 *  domain the user is signed in on: the callback's Supabase upsert reads the
 *  session cookie, and cookies don't cross domains. (2026-08-12: prod's env
 *  pointed at open-ronin.vercel.app while the Console had Open Ronin registered
 *  — env-based URIs caused a redirect_uri_mismatch loop.)
 *  Consequence: EVERY domain that serves the app needs its callback listed
 *  under Authorized redirect URIs in Google Cloud Console — Open Ronin,
 *  open-ronin.vercel.app, and http://localhost:3000 for dev. Preview deploy
 *  URLs are not registered, so Connect won't work from previews. */
export function callbackUriFor(requestUrl: string): string {
	try {
		const u = new URL(requestUrl);
		return `${u.origin}/api/integrations/google-cal/callback`;
	} catch { /* malformed request URL — fall back to the env-based URI */ }
	return callbackUri();
}

/** Exchange an auth code for tokens.
 *  - `flow='redirect'` (default): used by the server redirect callback,
 *    `redirect_uri` must match the registered callback URL.
 *  - `flow='popup'`: used by GIS `initCodeClient` popups, `redirect_uri`
 *    MUST be the literal string "postmessage". Google enforces this. */
export async function exchangeCodeForTokens(code: string, flow: 'redirect' | 'popup' = 'redirect', redirectUri?: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
	token_type: string;
	id_token?: string;
}> {
	const r = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
			client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
			redirect_uri: flow === 'popup' ? 'postmessage' : (redirectUri ?? callbackUri()),
			grant_type: 'authorization_code',
		}),
	});
	if (!r.ok) throw new Error(`Google token exchange ${r.status}: ${await r.text()}`);
	return r.json();
}

async function refreshAccessToken(refresh_token: string): Promise<TokenPair> {
	const cached = accessTokenCache.get(refresh_token);
	if (cached && cached.expires_at > Date.now() + 30_000) return cached;

	const r = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			refresh_token,
			client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
			client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
			grant_type: 'refresh_token',
		}),
	});
	if (!r.ok) {
		const text = await r.text();
		// Google's two "this refresh token is dead" answers. `unauthorized_client`
		// (401) means the token was issued by a different OAuth client than the
		// one in GOOGLE_OAUTH_CLIENT_ID (2026-09-09: Alex's row, minted on the
		// original June client). `invalid_grant` (400) means revoked or expired.
		// Neither is retryable; the only fix is a reconnect, so say so in the
		// message that lands in sync_error and on the calendar page.
		if (/"error"\s*:\s*"(unauthorized_client|invalid_grant)"/.test(text)) {
			const code = /unauthorized_client/.test(text) ? 'unauthorized_client' : 'invalid_grant';
			throw new Error(`Google no longer accepts this connection's token (${code}). Open the calendar page, Disconnect, then Connect again.`);
		}
		throw new Error(`Google refresh ${r.status}: ${text}`);
	}
	const json = (await r.json()) as { access_token: string; expires_in: number };
	const pair: TokenPair = {
		access_token: json.access_token,
		expires_at: Date.now() + json.expires_in * 1000,
	};
	accessTokenCache.set(refresh_token, pair);
	return pair;
}

/** Resolve the plaintext refresh token from its stored form. Rows written
 * before encryption landed hold the raw token; they keep working and get
 * re-encrypted the next time the user reconnects. */
export function storedRefreshToken(stored: string): string {
	return stored.startsWith('v1:') ? decryptToken(stored) : stored;
}

async function calFetch(conn: GoogleCalConnection, path: string, init: RequestInit = {}): Promise<Response> {
	if (!conn.encrypted_refresh_token) throw new Error('No refresh token on connection.');
	const { access_token } = await refreshAccessToken(storedRefreshToken(conn.encrypted_refresh_token));
	return fetch(`${GOOGLE_CAL_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${access_token}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
	});
}

/** Fetch the user's primary calendar email so we can confirm which Google account is linked. */
export async function userInfo(refresh_token: string): Promise<{ email: string; name?: string }> {
	const { access_token } = await refreshAccessToken(refresh_token);
	const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
		headers: { Authorization: `Bearer ${access_token}` },
	});
	if (!r.ok) throw new Error(`Google userinfo ${r.status}: ${await r.text()}`);
	return r.json();
}

/** Incremental list using stored sync_token. First sync passes null → full window. */
export async function listEvents(conn: GoogleCalConnection, opts?: {
	timeMin?: string; timeMax?: string; pageToken?: string;
}): Promise<{ items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }> {
	const params = new URLSearchParams();
	if (conn.sync_token) {
		params.set('syncToken', conn.sync_token);
	} else {
		params.set('timeMin', opts?.timeMin ?? new Date(Date.now() - 30 * 86400_000).toISOString());
		params.set('timeMax', opts?.timeMax ?? new Date(Date.now() + 90 * 86400_000).toISOString());
		params.set('singleEvents', 'true');
		params.set('orderBy', 'startTime');
	}
	if (opts?.pageToken) params.set('pageToken', opts.pageToken);
	params.set('maxResults', '250');

	const r = await calFetch(conn, `/calendars/${encodeURIComponent(conn.google_calendar_id)}/events?${params}`);
	if (r.status === 410) {
		// Sync token expired — caller should null sync_token and retry.
		throw new Error('SYNC_TOKEN_EXPIRED');
	}
	if (!r.ok) throw new Error(`Google events.list ${r.status}: ${await r.text()}`);
	return r.json();
}

export interface UpsertEventPayload {
	summary: string;
	description?: string | null;
	location?: string | null;
	start: { dateTime: string; timeZone?: string };
	end:   { dateTime: string; timeZone?: string };
	attendees?: Array<{ email: string }>;
}

export async function createEvent(conn: GoogleCalConnection, payload: UpsertEventPayload): Promise<GoogleEvent> {
	const r = await calFetch(conn, `/calendars/${encodeURIComponent(conn.google_calendar_id)}/events`, {
		method: 'POST',
		body: JSON.stringify(payload),
	});
	if (!r.ok) throw new Error(`Google events.insert ${r.status}: ${await r.text()}`);
	return r.json();
}

export async function patchEvent(conn: GoogleCalConnection, eventId: string, payload: Partial<UpsertEventPayload>): Promise<GoogleEvent> {
	const r = await calFetch(conn, `/calendars/${encodeURIComponent(conn.google_calendar_id)}/events/${encodeURIComponent(eventId)}`, {
		method: 'PATCH',
		body: JSON.stringify(payload),
	});
	if (!r.ok) throw new Error(`Google events.patch ${r.status}: ${await r.text()}`);
	return r.json();
}

export async function deleteEvent(conn: GoogleCalConnection, eventId: string): Promise<void> {
	const r = await calFetch(conn, `/calendars/${encodeURIComponent(conn.google_calendar_id)}/events/${encodeURIComponent(eventId)}`, {
		method: 'DELETE',
	});
	if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`Google events.delete ${r.status}: ${await r.text()}`);
}

export async function revokeToken(refresh_token: string): Promise<void> {
	await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh_token)}`, { method: 'POST' });
	accessTokenCache.delete(refresh_token);
}
