'use client';

// Browser-side Google Calendar connect using Google Identity Services (GIS)
// for auth + the gapi client for ad-hoc Calendar reads. Avoids the server
// redirect bounce — user clicks, popup opens, grants, popup closes, we
// post the auth code to our server which exchanges + stores the refresh
// token (same flow as the redirect callback, just popup-shaped).
//
// Falls back to the SERVER REDIRECT flow (/api/integrations/google-cal/
// connect) whenever the popup path isn't available — GIS failed to load OR
// NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID isn't set. The redirect flow only
// needs the server-side GOOGLE_OAUTH_CLIENT_ID (+ the callback URL
// registered as an Authorized redirect URI in Google Cloud Console), so
// connecting works even with zero public env config.
//
// Before 2026-08-12 a missing NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID showed an
// error instead of falling back — which made Connect fail for everyone,
// since that env var was never set. Popup mode additionally requires the
// app origin under "Authorized JavaScript origins" in Google Cloud Console.
//
// gapi.client is initialized but only used for future live-read features
// (e.g. "refresh today's view from Google without waiting on bg sync").

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';

declare global {
	interface Window {
		google?: {
			accounts?: {
				oauth2?: {
					initCodeClient: (config: {
						client_id: string;
						scope: string;
						ux_mode?: 'popup' | 'redirect';
						callback: (response: { code?: string; error?: string }) => void;
					}) => { requestCode: () => void };
				};
			};
		};
		gapi?: {
			load: (lib: string, cb: () => void) => void;
			client?: {
				init: (cfg: { discoveryDocs: string[]; apiKey?: string }) => Promise<void>;
				calendar?: unknown;
				setToken: (token: { access_token: string }) => void;
			};
		};
	}
}

const SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.readonly',
	'openid', 'email', 'profile',
].join(' ');

const CAL_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

interface Props {
	onConnected?: () => void;
}

export default function GoogleCalConnect({ onConnected }: Props) {
	const [gisReady, setGisReady] = useState(false);
	const [gapiReady, setGapiReady] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;

	useEffect(() => {
		// Load Google Identity Services (auth)
		if (!document.getElementById('gis-script')) {
			const s = document.createElement('script');
			s.id = 'gis-script';
			s.src = 'https://accounts.google.com/gsi/client';
			s.async = true; s.defer = true;
			s.onload = () => setGisReady(true);
			document.head.appendChild(s);
		} else { setGisReady(true); }

		// Load gapi (for ad-hoc Calendar API reads later)
		if (!document.getElementById('gapi-script')) {
			const s = document.createElement('script');
			s.id = 'gapi-script';
			s.src = 'https://apis.google.com/js/api.js';
			s.async = true; s.defer = true;
			s.onload = () => {
				window.gapi?.load('client', () => {
					window.gapi?.client
						?.init({ discoveryDocs: [CAL_DISCOVERY] })
						.then(() => setGapiReady(true))
						.catch(() => setGapiReady(false));
				});
			};
			document.head.appendChild(s);
		} else { setGapiReady(true); }
	}, []);

	function handleConnect() {
		if (!clientId) return; // unreachable — the render guard falls back to the redirect link
		if (!window.google?.accounts?.oauth2) { setError('Google Identity Services not loaded.'); return; }

		setError(null);
		const codeClient = window.google.accounts.oauth2.initCodeClient({
			client_id: clientId,
			scope: SCOPES,
			ux_mode: 'popup',
			callback: async (response) => {
				if (response.error || !response.code) {
					setError(response.error ?? 'No code returned from Google.');
					return;
				}
				setPending(true);
				try {
					const r = await fetch('/api/integrations/google-cal/code-exchange', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ code: response.code }),
					});
					const json = await r.json();
					if (!r.ok) throw new Error(json.error ?? 'Code exchange failed');
					if (onConnected) onConnected();
					else window.location.reload();
				} catch (e) {
					setError(e instanceof Error ? e.message : 'Connect failed');
				} finally {
					setPending(false);
				}
			},
		});
		codeClient.requestCode();
	}

	// Server-redirect path: used when the popup flow can't run — no public
	// client id configured (the common case) or GIS failed to load.
	if (!clientId || !gisReady) {
		return (
			<a
				href="/api/integrations/google-cal/connect"
				target="_blank"
				rel="noopener"
				className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm rounded-md bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
			>
				Connect Google Calendar
			</a>
		);
	}

	return (
		<div className="inline-flex flex-col items-end gap-1">
			<Button type="button" onClick={handleConnect} disabled={pending} className="gap-1.5">
				{pending ? 'Connecting…' : 'Connect Google Calendar'}
			</Button>
			{error && <span className="text-2xs text-red-600 max-w-[300px] text-right">{error}</span>}
			{gapiReady && <span className="text-2xs text-slate-600 dark:text-slate-400">gapi loaded · ready for live reads</span>}
		</div>
	);
}
