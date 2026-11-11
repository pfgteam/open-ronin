#!/usr/bin/env node
// pnpm setup:apply [path/to/open-ronin.config.yaml] [--no-complete] [--invite] [--no-link] [--app-url <url>]
//
// INSTALL.md Step 6. Applies open-ronin.config.yaml to the database through
// the same RPC the /setup wizard uses (public.apply_org_config), then makes
// sure the first admin from team.first_admin exists and can get in with no
// email provider and no Google:
//   - default: creates the auth user with the email already confirmed (so
//     hosted Supabase's "Confirm email" setting can't block it), gives it the
//     admin role and prints a ONE-TIME sign-in link. Opening the link signs
//     the admin in and asks them to choose a password; from then on they sign
//     in with email + password, locally and on production.
//   - re-running prints a fresh link for the same admin (nothing duplicated).
//   - --invite: sends Supabase's invite email instead (needs an email provider).
//   - --no-link: apply the config only, print no link.
//   - --app-url: base URL for the link (default NEXT_PUBLIC_APP_URL).
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or web/.env.local. Never prints secrets.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { adminClient, appUrlFrom, fail as failWith, findAuthUser, oneTimeSignInLink, repoDir } from './_supabase-admin.mjs';

const P = 'setup:apply';
const fail = (msg) => failWith(P, msg);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const fileArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--app-url');
const db = adminClient(P);
const configPath = path.resolve(fileArg || process.env.OPEN_RONIN_CONFIG || path.join(repoDir, 'open-ronin.config.yaml'));

if (!existsSync(configPath)) fail(`no config at ${configPath} (run the INSTALL.md Step 0 questionnaire, or pass a path)`);
let config;
try {
	config = parse(readFileSync(configPath, 'utf8'));
} catch (e) {
	fail(`YAML error in ${configPath}: ${String(e.message).split('\n')[0]}`);
}
if (!config?.org?.name) fail('org.name is required');
if (config.org.domain && !(config.org.allowed_email_domains ?? []).length) config.org.allowed_email_domains = [config.org.domain];

// PostgREST answers "Could not query the database for the schema cache" for a
// few seconds after `supabase start` / `supabase db reset`; wait it out.
let data, error;
for (let attempt = 1; attempt <= 10; attempt++) {
	({ data, error } = await db.rpc('apply_org_config', { p_config: config, p_complete: !flags.has('--no-complete') }));
	if (!error || !/schema cache/i.test(error.message)) break;
	await new Promise((r) => setTimeout(r, 3000));
}
if (error) fail(`apply_org_config: ${error.message}`);
console.log(`Applied ${path.relative(repoDir, configPath) || configPath}:`);
console.log(`  organization   ${config.org.name}`);
console.log(`  sign-in        ${(config.org.allowed_email_domains ?? []).join(', ') || '(any domain: none configured)'}`);
console.log(`  service lines  ${data.service_lines}`);
console.log(`  departments    ${data.departments}`);
console.log(`  modules on     ${Object.entries(data.modules).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

// A running app caches the org config for up to 10 minutes; tell it to drop
// that cache so the next page load shows what was just applied.
{
	const appUrl = appUrlFrom(args);
	const secret = process.env.CRON_SECRET;
	let note = 'app not running; the new config shows within 10 minutes of the next start';
	if (secret) {
		try {
			const res = await fetch(`${appUrl}/api/setup/refresh`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) });
			note = res.ok ? `refreshed the running app at ${appUrl}` : `app at ${appUrl} answered ${res.status}; the new config shows within 10 minutes`;
		} catch {
			// not running: nothing to refresh right now
		}
	} else {
		note = 'CRON_SECRET not set, could not refresh the running app; the new config shows within 10 minutes';
	}
	console.log(`  app cache      ${note}`);
}

const admin = config.team?.first_admin;
if (!admin?.email) {
	console.log('\nNo team.first_admin in the config: the first person to sign up becomes admin.');
	process.exit(0);
}

const email = String(admin.email).trim().toLowerCase();
const appUrl = appUrlFrom(args);
const [first, ...rest] = String(admin.name ?? '').trim().split(/\s+/);
const meta = { first_name: first || undefined, last_name: rest.join(' ') || undefined };

let user = await findAuthUser(db, email).catch((e) => fail(`look up ${email}: ${e.message}`));
let created = false;
if (!user && flags.has('--invite')) {
	const { error: invErr } = await db.auth.admin.inviteUserByEmail(email, { data: meta, redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent('/auth/reset-password?welcome=1')}` });
	if (invErr) fail(`invite ${email}: ${invErr.message}`);
	console.log(`  first admin    ${email} (invite email sent)`);
	process.exit(0);
}
if (!user) {
	// email_confirm: true pre-confirms the address, so the admin never needs
	// a confirmation email even when hosted Supabase has "Confirm email" on.
	const { data: c, error: cErr } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
	if (cErr) fail(`create ${email}: ${cErr.message}`);
	user = c.user;
	created = true;
} else if (!user.email_confirmed_at) {
	const { error: confErr } = await db.auth.admin.updateUserById(user.id, { email_confirm: true });
	if (confErr) fail(`confirm ${email}: ${confErr.message}`);
}

// handle_new_user gives the owner_email the admin role on insert; make sure
// of it either way (covers an account that existed before setup).
const { data: profile, error: pErr } = await db.from('profiles').select('id, role').eq('id', user.id).maybeSingle();
if (pErr) fail(`read profile for ${email}: ${pErr.message}`);
if (!profile) fail(`no profile row for ${email}; the handle_new_user trigger did not run. Check that every migration applied.`);
if (profile.role !== 'admin') {
	const { error: upErr } = await db.from('profiles').update({ role: 'admin' }).eq('id', user.id);
	if (upErr) fail(`could not make ${email} an admin: ${upErr.message}`);
}
console.log(`  first admin    ${email} (${created ? 'created' : 'already existed'}, admin, email confirmed)`);

if (flags.has('--no-link')) process.exit(0);
const link = await oneTimeSignInLink(db, email, appUrl).catch((e) => fail(`sign-in link for ${email}: ${e.message}`));
console.log(`\nOne-time sign-in link for ${email} (single use, expires in 1 hour):\n  ${link}`);
console.log(`\nOpen it in the browser where the app runs (${appUrl}), choose a password, and you're in.`);
console.log('Need another link later (locally or on production)? pnpm signin-link <email> [--app-url <url>]');
