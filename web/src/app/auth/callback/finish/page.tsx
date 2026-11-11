'use client';

// Finishes an implicit-flow sign-in: Supabase's /auth/v1/verify redirect puts
// `#access_token=…&refresh_token=…` in the URL fragment, which the server
// callback route cannot see. This page reads the fragment, stores the session
// through the browser client (cookies the server then reads) and bounces to
// `next`. Used by the client portal magic link (0144); staff OAuth and
// password flows keep using the PKCE `?code=` path in /auth/callback.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/safeRedirect';

export default function FinishSignIn() {
	const [error, setError] = useState<string | null>(null);
	const [retryHref, setRetryHref] = useState('/auth/login');

	useEffect(() => {
		const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
		const next = safeInternalPath(new URLSearchParams(window.location.search).get('next'));
		// Where "request a new link" goes: the client portal for portal links, the staff login otherwise.
		setRetryHref(next.startsWith('/portal') ? '/portal' : '/auth/login');
		const described = params.get('error_description') ?? params.get('error');
		if (described) {
			setError(described.replace(/\+/g, ' '));
			return;
		}
		const access_token = params.get('access_token');
		const refresh_token = params.get('refresh_token');
		if (!access_token || !refresh_token) {
			setError('This sign-in link is missing its token. Ask for a new link.');
			return;
		}
		createClient()
			.auth.setSession({ access_token, refresh_token })
			.then(({ error: e }) => {
				if (e) {
					setError(e.message);
					return;
				}
				window.location.replace(next);
			});
	}, []);

	return (
		<main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
			<div className="max-w-md w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-700 dark:text-slate-300">
				{error ? (
					<>
						<p className="font-medium text-slate-900 dark:text-slate-100 mb-1">Sign-in link did not work</p>
						<p className="mb-3">{error}</p>
						<a href={retryHref} className="text-primary-600 dark:text-primary-400 underline">
							Request a new link
						</a>
					</>
				) : (
					<p>Signing you in…</p>
				)}
			</div>
		</main>
	);
}
