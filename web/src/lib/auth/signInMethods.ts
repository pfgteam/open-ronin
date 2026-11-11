// Which sign-in methods the auth pages may offer. A fresh install must never
// show a button that leads to an error, so each method is shown only when it
// can actually work:
//
//   password    always (Supabase email + password needs no extra setup)
//   google      only when Supabase Auth reports the Google provider enabled,
//               which it does once a client ID and secret are saved there
//               (dashboard: Authentication > Sign In / Providers > Google;
//               local: [auth.external.google] in supabase/config.toml)
//   magic link  only when AUTH_EMAIL_ENABLED=true, i.e. the installer has
//               given Supabase Auth a working email provider (custom SMTP,
//               e.g. Resend). Without one, hosted Supabase only mails project
//               members, so a link button would strand everyone else.
//
// The org's own choice (org_settings.auth_methods, from auth.methods in
// open-ronin.config.yaml) can switch a configured method off, never on.

export interface SignInMethods {
	password: true;
	google: boolean;
	magicLink: boolean;
	/** False means password reset and sign-up confirmation mails can't be sent. */
	email: boolean;
}

export interface SignInMethodInputs {
	/** `external.google` from GET <supabase>/auth/v1/settings, null when unreachable. */
	googleProviderEnabled: boolean | null;
	/** AUTH_EMAIL_ENABLED env value. */
	authEmailEnabled: string | undefined;
	/** org_settings.auth_methods; empty or missing means "no preference". */
	orgMethods: string[] | null | undefined;
}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? '').trim());

export function resolveSignInMethods(input: SignInMethodInputs): SignInMethods {
	const chosen = (input.orgMethods ?? []).filter(Boolean);
	const allowed = (m: string) => chosen.length === 0 || chosen.includes(m);
	const email = truthy(input.authEmailEnabled);
	return {
		password: true,
		google: input.googleProviderEnabled === true && allowed('google'),
		magicLink: email && allowed('magic_link'),
		email,
	};
}

/** Reads Supabase Auth's public settings. Null when it can't be reached. */
export async function fetchGoogleProviderEnabled(): Promise<boolean | null> {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !key) return null;
	try {
		const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
			headers: { apikey: key },
			next: { revalidate: 60 },
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { external?: Record<string, unknown> };
		return body.external?.google === true;
	} catch {
		return null;
	}
}
