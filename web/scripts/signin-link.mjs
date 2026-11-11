#!/usr/bin/env node
// pnpm signin-link <email> [--app-url https://app.example.com]
//
// Prints a one-time sign-in link for an existing user. No email provider and
// no Google needed: the link goes straight to this app's /auth/confirm, signs
// the person in and asks them to choose a password. Also confirms the email
// address if sign-up confirmation was still pending.
//
// Use it when someone is locked out (forgot password with no email provider,
// stuck sign-up confirmation) or to sign in on production right after deploy:
//   pnpm signin-link you@example.com --app-url https://app.example.com
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or web/.env.local. Point those at the database the app uses.

import { adminClient, appUrlFrom, fail, findAuthUser, oneTimeSignInLink } from './_supabase-admin.mjs';

const P = 'signin-link';
const args = process.argv.slice(2);
const email = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--app-url');
if (!email || !email.includes('@')) fail(P, 'usage: pnpm signin-link <email> [--app-url <url>]');

const db = adminClient(P);
const appUrl = appUrlFrom(args);

const user = await findAuthUser(db, email).catch((e) => fail(P, e.message));
if (!user) fail(P, `no account for ${email}. Create the first admin with \`pnpm setup:apply\`, or invite the person from Admin.`);
if (!user.email_confirmed_at) {
	const { error } = await db.auth.admin.updateUserById(user.id, { email_confirm: true });
	if (error) fail(P, `could not confirm ${email}: ${error.message}`);
	console.log(`Confirmed ${email} (sign-up confirmation was pending).`);
}
const link = await oneTimeSignInLink(db, email, appUrl).catch((e) => fail(P, e.message));
console.log(`One-time sign-in link for ${email} (single use, expires in 1 hour):\n  ${link}`);
