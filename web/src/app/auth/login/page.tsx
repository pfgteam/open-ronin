// /auth/login (server). Works out which sign-in methods are actually
// configured (see lib/auth/signInMethods) and renders the client form with
// only those. Email + password is always offered.

import { Suspense } from 'react';
import LoginForm from './LoginForm';
import { getOrgSettings } from '@/lib/tenant/server';
import { fetchGoogleProviderEnabled, resolveSignInMethods } from '@/lib/auth/signInMethods';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
	const [googleProviderEnabled, org] = await Promise.all([fetchGoogleProviderEnabled(), getOrgSettings()]);
	const methods = resolveSignInMethods({
		googleProviderEnabled,
		authEmailEnabled: process.env.AUTH_EMAIL_ENABLED,
		// Before setup the org has made no choice yet; don't apply the defaults.
		orgMethods: org.setup_completed_at ? org.auth_methods : null,
	});
	// Google's `hd` hint pre-selects the org's Workspace account in the chooser.
	const googleHd = org.allowed_email_domains[0] ?? null;

	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
					Loading…
				</div>
			}
		>
			<LoginForm methods={methods} googleHd={googleHd} />
		</Suspense>
	);
}
