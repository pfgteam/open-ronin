// GHL API client.
// Reads + refreshes tokens from the ghl_connections table.

import { createServiceRoleClient } from '@/lib/supabase/server';
import { GHL_CONFIG } from './config';
import { encryptToken, decryptToken } from './crypto';

interface GhlConnectionRow {
	id: string;
	scope: 'location' | 'company';
	ghl_company_id: string | null;
	ghl_location_id: string | null;
	label: string | null;
	encrypted_access_token: string;
	encrypted_refresh_token: string;
	expires_at: string | null;
	scopes: string | null;
	auth_kind?: 'oauth' | 'private_token';
}

export interface GhlConnection {
	id: string;
	scope: 'location' | 'company';
	companyId: string | null;
	locationId: string | null;
	label: string | null;
	accessToken: string;
}

const REFRESH_LEEWAY_MS = 60_000; // refresh 1min early

async function loadConnection(id: string): Promise<GhlConnectionRow | null> {
	const sb = createServiceRoleClient();
	const { data } = await sb.from('ghl_connections').select('*').eq('id', id).maybeSingle();
	return (data ?? null) as GhlConnectionRow | null;
}

async function refreshAccessToken(row: GhlConnectionRow): Promise<string> {
	const refresh = decryptToken(row.encrypted_refresh_token);
	const body = new URLSearchParams({
		client_id: GHL_CONFIG.clientId,
		client_secret: GHL_CONFIG.clientSecret,
		grant_type: 'refresh_token',
		refresh_token: refresh,
		user_type: row.scope === 'company' ? 'Company' : 'Location',
	});
	const res = await fetch(GHL_CONFIG.apiBase + '/oauth/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		const sb = createServiceRoleClient();
		await sb.from('ghl_connections').update({ last_refresh_error: 'refresh failed: ' + text, last_refresh_at: new Date().toISOString() }).eq('id', row.id);
		throw new Error('GHL token refresh failed: ' + res.status + ' ' + text);
	}
	const payload = (await res.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
		scope?: string;
	};
	const expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
	const sb = createServiceRoleClient();
	await sb
		.from('ghl_connections')
		.update({
			encrypted_access_token: encryptToken(payload.access_token),
			encrypted_refresh_token: encryptToken(payload.refresh_token),
			expires_at: expiresAt,
			scopes: payload.scope ?? null,
			last_refresh_at: new Date().toISOString(),
			last_refresh_error: null,
		})
		.eq('id', row.id);
	return payload.access_token;
}

export async function getActiveAccessToken(connectionId: string): Promise<GhlConnection> {
	const row = await loadConnection(connectionId);
	if (!row) throw new Error('GHL connection not found: ' + connectionId);
	const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
	let accessToken: string;
	if (row.auth_kind === 'private_token') {
		// 0123: a Private Integration token never refreshes.
		accessToken = decryptToken(row.encrypted_access_token);
	} else if (!row.expires_at || expiresMs - REFRESH_LEEWAY_MS < Date.now()) {
		accessToken = await refreshAccessToken(row);
	} else {
		accessToken = decryptToken(row.encrypted_access_token);
	}
	return {
		id: row.id,
		scope: row.scope,
		companyId: row.ghl_company_id,
		locationId: row.ghl_location_id,
		label: row.label,
		accessToken,
	};
}

export async function ghlFetch<T>(connectionId: string, path: string, init: RequestInit = {}): Promise<T> {
	const conn = await getActiveAccessToken(connectionId);
	const url = path.startsWith('http') ? path : GHL_CONFIG.apiBase + path;
	const headers = new Headers(init.headers);
	headers.set('Authorization', 'Bearer ' + conn.accessToken);
	headers.set('Version', GHL_CONFIG.apiVersion);
	headers.set('Accept', 'application/json');
	if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const res = await fetch(url, { ...init, headers });
	if (!res.ok) {
		const text = await res.text();
		throw new Error('GHL ' + path + ' -> ' + res.status + ': ' + text);
	}
	const text = await res.text();
	return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Exchange an authorization code for an initial token set (called from the
 * OAuth callback handler).
 */
export async function exchangeAuthCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
	token_type: string;
	user_type: 'Company' | 'Location';
	companyId?: string;
	locationId?: string;
	userId?: string;
}> {
	const body = new URLSearchParams({
		client_id: GHL_CONFIG.clientId,
		client_secret: GHL_CONFIG.clientSecret,
		grant_type: 'authorization_code',
		code,
		redirect_uri: GHL_CONFIG.redirectUri,
		user_type: 'Location',
	});
	const res = await fetch(GHL_CONFIG.apiBase + '/oauth/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
		body,
	});
	const text = await res.text();
	if (!res.ok) throw new Error('GHL code exchange failed: ' + res.status + ' ' + text);
	return JSON.parse(text);
}
