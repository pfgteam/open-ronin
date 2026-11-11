// Shared helpers for the install scripts (setup:apply, signin-link).
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or web/.env.local. Never prints secrets.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const webDir = path.resolve(here, '..');
export const repoDir = path.resolve(webDir, '..');

export function loadEnvFile(file = path.join(webDir, '.env.local')) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (!m || process.env[m[1]]) continue;
		const value = m[2].replace(/^['"]|['"]$/g, '');
		// Blank lines in .env.local (KEY=) mean "not set", not "empty string".
		if (value) process.env[m[1]] = value;
	}
}

export function fail(prefix, msg) {
	console.error(`${prefix}: ${msg}`);
	process.exit(1);
}

export function adminClient(prefix) {
	loadEnvFile();
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) fail(prefix, 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (web/.env.local)');
	return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** --app-url <url> beats NEXT_PUBLIC_APP_URL beats http://localhost:3000. */
export function appUrlFrom(args) {
	const i = args.indexOf('--app-url');
	const fromFlag = i >= 0 ? args[i + 1] : null;
	return String(fromFlag || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** Finds an auth user by email (case-insensitive). */
export async function findAuthUser(db, email) {
	const target = email.toLowerCase();
	for (let page = 1; page < 100; page++) {
		const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw error;
		const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
		if (hit) return hit;
		if (data.users.length < 200) return null;
	}
	return null;
}

/**
 * One-time sign-in link that needs no email provider and no Supabase redirect
 * allow-list: it points at the app's own /auth/confirm route, which verifies
 * the token server-side and lands on /auth/reset-password?welcome=1 so the
 * person picks a password. Expires with Supabase's OTP expiry (1 hour default).
 */
export async function oneTimeSignInLink(db, email, appUrl) {
	const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
	if (error) throw error;
	const tokenHash = data.properties?.hashed_token;
	if (!tokenHash) throw new Error('Supabase returned no token for the link');
	const next = '/auth/reset-password?welcome=1';
	return `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=${encodeURIComponent(next)}`;
}
