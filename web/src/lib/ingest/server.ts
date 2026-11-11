// Server machinery shared by every /api/ingest/* route.
//
// Flow per request: service-token gate -> parse -> contract-version check
// (mismatch = 409, property 2) -> per-row zod validation -> handler resolves
// keys and upserts (property 1) -> every dropped row is recorded in
// ingest_unmatched (property 4) -> response { written, skipped, unmatched }.
//
// Auth: INGEST_API_KEY, a service token distinct from any user session and
// from CRON_SECRET. FAILS CLOSED like lib/cron/auth — unset means refused.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CONTRACT_VERSION, batchSchema } from './contract';

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export function denyUnlessIngest(request: Request): NextResponse | null {
	const secret = process.env.INGEST_API_KEY;
	if (!secret) {
		console.error('[ingest] INGEST_API_KEY is not set — refusing the request');
		return NextResponse.json({ error: 'Ingest is not configured.' }, { status: 401 });
	}
	const header = request.headers.get('authorization') ?? '';
	if (!safeEqual(header, `Bearer ${secret}`)) {
		return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
	}
	return null;
}

export type Unmatched = { row: unknown; reason: string };

export type BatchOutcome = {
	written: number;
	unmatched: Unmatched[];
};

type Handler<Row> = (
	supabase: ReturnType<typeof createServiceRoleClient>,
	rows: Row[],
) => Promise<BatchOutcome>;

/**
 * Runs one ingest batch end to end. `endpoint` is the short name recorded in
 * ingest_unmatched (e.g. 'metrics', 'health/engagement').
 */
export async function runIngestBatch<R extends z.ZodTypeAny>(
	request: Request,
	endpoint: string,
	rowSchema: R,
	handler: Handler<z.infer<R>>,
): Promise<NextResponse> {
	const denied = denyUnlessIngest(request);
	if (denied) return denied;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}

	// Version gate BEFORE row validation: a sender on the wrong contract gets
	// one clear 409, not a pile of confusing per-row shape errors.
	const version = (body as { contract_version?: unknown })?.contract_version;
	if (version !== CONTRACT_VERSION) {
		return NextResponse.json(
			{ error: 'contract_version mismatch', expected: CONTRACT_VERSION, got: version ?? null },
			{ status: 409 },
		);
	}

	const parsed = batchSchema(rowSchema).safeParse(body);
	if (!parsed.success) {
		// Envelope-level failure (rows not an array, > MAX rows, …) — reject whole.
		return NextResponse.json(
			{ error: 'invalid batch', issues: parsed.error.issues.slice(0, 20) },
			{ status: 400 },
		);
	}

	const batchId = randomUUID();
	const supabase = createServiceRoleClient();
	const outcome = await handler(supabase, parsed.data.rows);

	if (outcome.unmatched.length > 0) {
		const { error } = await supabase.from('ingest_unmatched').insert(
			outcome.unmatched.map((u) => ({
				endpoint,
				batch_id: batchId,
				contract_version: CONTRACT_VERSION,
				row_payload: u.row as Record<string, unknown>,
				reason: u.reason,
			})),
		);
		if (error) console.error(`[ingest/${endpoint}] failed to record unmatched:`, error.message);
	}

	return NextResponse.json({
		batch_id: batchId,
		contract_version: CONTRACT_VERSION,
		source_run: parsed.data.source_run ?? null,
		written: outcome.written,
		skipped: 0, // envelope rejects whole-batch; per-row drops are all in `unmatched`
		unmatched: outcome.unmatched.length,
		unmatched_reasons: summarize(outcome.unmatched),
	});
}

function summarize(unmatched: Unmatched[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const u of unmatched) out[u.reason] = (out[u.reason] ?? 0) + 1;
	return out;
}

// ---------------------------------------------------------------- resolvers

type Supabase = ReturnType<typeof createServiceRoleClient>;

/** Which of these airtable_contract_ids actually exist in `contracts`? */
export async function knownContractIds(supabase: Supabase, ids: string[]): Promise<Set<string>> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return new Set();
	const { data, error } = await supabase
		.from('contracts')
		.select('airtable_contract_id')
		.in('airtable_contract_id', unique);
	if (error) throw new Error(`contracts lookup failed: ${error.message}`);
	return new Set((data ?? []).map((r) => r.airtable_contract_id as string));
}

/**
 * Resolve {client_id | airtable_contract_id} refs to clients_v2.id.
 * Returns a resolver fn; unresolvable refs return null.
 */
export async function clientResolver(
	supabase: Supabase,
	refs: Array<{ client_id?: string; airtable_contract_id?: string } | undefined>,
): Promise<(ref?: { client_id?: string; airtable_contract_id?: string }) => string | null> {
	const clientIds = [...new Set(refs.flatMap((r) => (r?.client_id ? [r.client_id] : [])))];
	const contractIds = [
		...new Set(refs.flatMap((r) => (r?.airtable_contract_id ? [r.airtable_contract_id] : []))),
	];
	const validClients = new Set<string>();
	const byContract = new Map<string, string>();
	if (clientIds.length > 0) {
		const { data, error } = await supabase.from('clients_v2').select('id').in('id', clientIds);
		if (error) throw new Error(`clients_v2 lookup failed: ${error.message}`);
		for (const r of data ?? []) validClients.add(r.id as string);
	}
	if (contractIds.length > 0) {
		const { data, error } = await supabase
			.from('contracts')
			.select('airtable_contract_id, client_id')
			.in('airtable_contract_id', contractIds);
		if (error) throw new Error(`contracts lookup failed: ${error.message}`);
		for (const r of data ?? []) byContract.set(r.airtable_contract_id as string, r.client_id as string);
	}
	return (ref) => {
		if (!ref) return null;
		if (ref.client_id && validClients.has(ref.client_id)) return ref.client_id;
		if (ref.airtable_contract_id) return byContract.get(ref.airtable_contract_id) ?? null;
		return null;
	};
}

/** email (lowercased) -> profiles.id for the given emails. */
export async function profileIdsByEmail(
	supabase: Supabase,
	emails: string[],
): Promise<Map<string, string>> {
	const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
	const out = new Map<string, string>();
	if (unique.length === 0) return out;
	const { data, error } = await supabase.from('profiles').select('id, email').in('email', unique);
	if (error) throw new Error(`profiles lookup failed: ${error.message}`);
	for (const r of data ?? []) out.set((r.email as string).toLowerCase(), r.id as string);
	return out;
}
