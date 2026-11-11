// Revenue Engine intake (0122): turning a webhook / form payload into a
// scored deal through rev_intake_scored(). Server-only.
//
// Auth model for /api/intake/<source>: each rev_intake_sources row carries a
// sha256 of its bearer token (token_hash, admin-only column). The sender puts
// the raw token in `x-intake-token` (or `Authorization: Bearer`). A source
// with no token or enabled=false refuses every call, so a connector stays
// dark until someone issues a token in Admin -> Prospects -> Connectors.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type Db = SupabaseClient;

export interface IntakeSourceRow {
	key: string;
	label: string;
	kind: 'webhook' | 'api' | 'csv' | 'form';
	enabled: boolean;
	token_hash: string | null;
	token_issued_at: string | null;
	secret_env: string | null;
	default_pipeline: string;
	default_source: string | null;
	default_channel: string | null;
	default_motion: string;
	field_map: Record<string, string>;
	note: string | null;
	last_event_at: string | null;
	event_count: number;
	error_count: number;
	last_error: string | null;
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 random bytes, url-safe, prefixed so it is recognisable in a vendor's settings screen. */
export function mintToken(sourceKey: string): string {
	return `or_${sourceKey}_${randomBytes(24).toString('base64url')}`;
}

export function tokenMatches(presented: string | null | undefined, hash: string | null | undefined): boolean {
	if (!presented || !hash) return false;
	const a = Buffer.from(hashToken(presented), 'hex');
	const b = Buffer.from(hash, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

export function presentedToken(request: Request): string | null {
	const x = request.headers.get('x-intake-token');
	if (x) return x.trim();
	const auth = request.headers.get('authorization') ?? '';
	if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
	return null;
}

/** Walk a dotted path through a JSON payload ("contact.email", "fields.0.value"). */
export function pick(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const part of path.split('.')) {
		if (cur == null) return undefined;
		if (Array.isArray(cur)) {
			const i = Number(part);
			cur = Number.isInteger(i) ? cur[i] : undefined;
		} else if (typeof cur === 'object') {
			cur = (cur as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}
	return cur;
}

/** Trim a payload for storage: strings to 2k, depth 4, 200 keys. */
export function trimPayload(v: unknown, depth = 0): unknown {
	if (v == null) return v;
	if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
	if (typeof v !== 'object') return v;
	if (depth >= 4) return '[…]';
	if (Array.isArray(v)) return v.slice(0, 50).map((x) => trimPayload(x, depth + 1));
	const out: Record<string, unknown> = {};
	let n = 0;
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		if (n++ >= 200) break;
		out[k] = trimPayload(val, depth + 1);
	}
	return out;
}

export type IntakeOutcome =
	| { status: 'processed'; deal_id: string | null; person_id: string | null; score: Record<string, unknown> | null }
	| { status: 'duplicate'; deal_id: string | null }
	| { status: 'rejected'; error: string }
	| { status: 'ignored'; reason: string };

/**
 * Process one webhook payload for a source: map it (rev_map_payload in SQL,
 * so the form path and the webhook path share one mapper), run
 * rev_intake_scored, record the event. Idempotent on (source, external_id).
 */
export async function processIntake(db: Db, source: IntakeSourceRow, payload: unknown): Promise<IntakeOutcome> {
	const trimmed = trimPayload(payload);
	const externalPath = source.field_map.external_id;
	const externalId = externalPath ? pick(payload, externalPath) : undefined;
	const extId = externalId != null && externalId !== '' ? String(externalId) : null;

	if (extId) {
		const { data: prior } = await db.from('rev_intake_events').select('id, status, deal_id').eq('source_key', source.key).eq('external_id', extId).maybeSingle();
		if (prior) return { status: 'duplicate', deal_id: (prior as { deal_id: string | null }).deal_id };
	}

	const defaults = {
		pipeline: source.default_pipeline,
		source: source.default_source,
		channel: source.default_channel,
		motion: source.default_motion,
		created_via: 'webhook',
		activity: {
			kind: source.default_channel === 'web' || source.kind === 'form' ? 'form' : source.default_channel === 'email' ? 'email' : source.default_channel && ['instagram', 'facebook', 'linkedin', 'tiktok', 'x'].includes(source.default_channel) ? 'dm' : 'system',
			channel: source.default_channel,
			direction: 'inbound',
			subject: `Lead via ${source.label}`,
			external_source: source.key,
			external_id: extId,
			is_touch: true,
		},
	};

	const { data: mapped, error: mapErr } = await db.rpc('rev_map_payload', { p_map: source.field_map, p_data: trimmed, p_defaults: defaults });
	if (mapErr) {
		await recordEvent(db, source.key, extId, 'rejected', trimmed, null, null, null, `map: ${mapErr.message}`);
		return { status: 'rejected', error: mapErr.message };
	}
	const m = (mapped ?? {}) as Record<string, unknown>;
	const hasIdentity = m.email || m.phone || m.linkedin_url || m.display_name || m.first_name || m.brand_name;
	if (!hasIdentity) {
		await recordEvent(db, source.key, extId, 'ignored', trimmed, m, null, null, 'no identity fields after mapping');
		return { status: 'ignored', reason: 'No name, email, phone, LinkedIn or brand in the payload after mapping.' };
	}

	const { data: out, error } = await db.rpc('rev_intake_scored', { p: m });
	if (error) {
		await recordEvent(db, source.key, extId, 'rejected', trimmed, m, null, null, error.message);
		await bumpSource(db, source.key, true, error.message);
		return { status: 'rejected', error: error.message };
	}
	const r = out as { deal_id: string | null; person_id: string | null; score?: Record<string, unknown> | null };
	await recordEvent(db, source.key, extId, 'processed', trimmed, m, r.deal_id, r.person_id, null);
	await bumpSource(db, source.key, false, null);
	return { status: 'processed', deal_id: r.deal_id, person_id: r.person_id, score: r.score ?? null };
}

async function recordEvent(db: Db, sourceKey: string, externalId: string | null, status: string, payload: unknown, mapped: unknown, dealId: string | null, personId: string | null, error: string | null) {
	await db.from('rev_intake_events').insert({
		source_key: sourceKey,
		external_id: externalId,
		status,
		payload,
		mapped,
		deal_id: dealId,
		person_id: personId,
		error,
		processed_at: new Date().toISOString(),
	});
}

async function bumpSource(db: Db, key: string, failed: boolean, error: string | null) {
	const { data } = await db.from('rev_intake_sources').select('event_count, error_count').eq('key', key).maybeSingle();
	const cur = (data ?? { event_count: 0, error_count: 0 }) as { event_count: number; error_count: number };
	await db
		.from('rev_intake_sources')
		.update({
			last_event_at: new Date().toISOString(),
			event_count: cur.event_count + 1,
			error_count: cur.error_count + (failed ? 1 : 0),
			last_error: failed ? error : null,
		})
		.eq('key', key);
}
