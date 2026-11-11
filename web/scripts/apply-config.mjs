#!/usr/bin/env node
// pnpm setup:apply [path/to/open-ronin.config.yaml] [--no-complete] [--invite]
//
// Applies open-ronin.config.yaml to the database through the same RPC the
// /setup wizard uses (public.apply_org_config), then makes sure the first
// admin from team.first_admin exists:
//   - default: creates the auth user (email confirmed) and prints a one-time
//     sign-in link (works locally, no email provider needed);
//   - --invite: sends Supabase's invite email instead (needs SMTP/Resend).
// The handle_new_user trigger gives that email the admin role because
// org_settings.owner_email now matches it.
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or web/.env.local. Never prints secrets.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const webDir = path.resolve(here, '..');
const repoDir = path.resolve(webDir, '..');

function loadEnvFile(file) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (!m || process.env[m[1]]) continue;
		process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
	}
}
loadEnvFile(path.join(webDir, '.env.local'));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const fileArg = args.find((a) => !a.startsWith('--'));
const configPath = path.resolve(fileArg ?? process.env.OPEN_RONIN_CONFIG ?? path.join(repoDir, 'open-ronin.config.yaml'));

function fail(msg) {
	console.error(`setup:apply: ${msg}`);
	process.exit(1);
}

if (!existsSync(configPath)) fail(`no config at ${configPath} (run the INSTALL.md Step 0 questionnaire, or pass a path)`);
let config;
try {
	config = parse(readFileSync(configPath, 'utf8'));
} catch (e) {
	fail(`YAML error in ${configPath}: ${String(e.message).split('\n')[0]}`);
}
if (!config?.org?.name) fail('org.name is required');
if (config.org.domain && !(config.org.allowed_email_domains ?? []).length) config.org.allowed_email_domains = [config.org.domain];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (web/.env.local)');

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data, error } = await db.rpc('apply_org_config', { p_config: config, p_complete: !flags.has('--no-complete') });
if (error) fail(`apply_org_config: ${error.message}`);
console.log(`Applied ${path.relative(repoDir, configPath) || configPath}:`);
console.log(`  organization   ${config.org.name}`);
console.log(`  sign-in        ${(config.org.allowed_email_domains ?? []).join(', ') || '(any domain: none configured)'}`);
console.log(`  service lines  ${data.service_lines}`);
console.log(`  departments    ${data.departments}`);
console.log(`  modules on     ${Object.entries(data.modules).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

const admin = config.team?.first_admin;
if (admin?.email) {
	const email = String(admin.email).toLowerCase();
	const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
	const redirectTo = `${appUrl}/auth/callback`;
	const [first, ...rest] = String(admin.name ?? '').trim().split(/\s+/);
	const meta = { first_name: first || undefined, last_name: rest.join(' ') || undefined };

	const { data: existing } = await db.from('profiles').select('id, role').ilike('email', email).maybeSingle();
	if (existing) {
		if (existing.role !== 'admin' && existing.role !== 'exec') {
			const { error: upErr } = await db.from('profiles').update({ role: 'admin' }).eq('id', existing.id);
			if (upErr) fail(`could not promote ${email}: ${upErr.message}`);
		}
		console.log(`  first admin    ${email} (already exists, admin)`);
	} else if (flags.has('--invite')) {
		const { error: invErr } = await db.auth.admin.inviteUserByEmail(email, { data: meta, redirectTo });
		if (invErr) fail(`invite ${email}: ${invErr.message}`);
		console.log(`  first admin    ${email} (invite email sent)`);
	} else {
		const { error: cErr } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
		if (cErr && !/already/i.test(cErr.message)) fail(`create ${email}: ${cErr.message}`);
		const { data: link, error: lErr } = await db.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });
		if (lErr) fail(`sign-in link for ${email}: ${lErr.message}`);
		console.log(`  first admin    ${email} (created)`);
		console.log(`\nOne-time sign-in link for ${email} (expires in 1 hour):\n  ${link.properties.action_link}`);
	}
}
