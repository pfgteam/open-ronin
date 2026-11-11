// /api/proof/events — the website logs what a visitor saw / clicked /
// converted on (0160). POST JSON { placement_id, event, session?, url? }
// or a batch { events: [...] } (sendBeacon friendly, max 20). The ip is
// hashed with a daily salt before it reaches the database; the RPC rate
// limits per hash and dedupes repeat impressions per session.

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { clientIp } from '@/lib/forms/server';
import { logProofEvent } from '@/lib/proof/server';

export const dynamic = 'force-dynamic';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['impression', 'click', 'conversion']);
const MAX_BATCH = 20;

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

function ipHash(ip: string): string | null {
	if (!ip || ip === 'unknown') return null;
	const day = new Date().toISOString().slice(0, 10);
	return createHash('sha256').update(`${day}:${process.env.PROOF_EVENT_SALT ?? 'main'}:${ip}`).digest('hex').slice(0, 32);
}

interface Incoming {
	placement_id?: unknown;
	event?: unknown;
	session?: unknown;
	url?: unknown;
}

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400, headers: CORS });
	}
	const b = (body && typeof body === 'object' ? body : {}) as { events?: unknown } & Incoming;
	const list: Incoming[] = Array.isArray(b.events) ? (b.events as Incoming[]).slice(0, MAX_BATCH) : [b];
	const hash = ipHash(clientIp(request));
	const results: string[] = [];
	for (const e of list) {
		const placement_id = typeof e.placement_id === 'string' && UUID.test(e.placement_id) ? e.placement_id : null;
		const event = typeof e.event === 'string' && EVENTS.has(e.event) ? e.event : null;
		if (!placement_id || !event) {
			results.push('bad_request');
			continue;
		}
		results.push(
			await logProofEvent({
				placement_id,
				event,
				ip_hash: hash,
				session_id: typeof e.session === 'string' ? e.session.slice(0, 64) : null,
				page_url: typeof e.url === 'string' ? e.url.slice(0, 500) : request.headers.get('referer'),
			}),
		);
		if (results[results.length - 1] === 'rate_limited') break;
	}
	const status = results.every((r) => r === 'bad_request') ? 400 : results.includes('rate_limited') ? 429 : results.includes('not_applied') ? 503 : 200;
	return NextResponse.json({ results }, { status, headers: CORS });
}
