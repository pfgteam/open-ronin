// Meta (Messenger + Instagram) webhook receiver — App Review STUB.
//
// GET  = Meta's subscription handshake: hub.mode=subscribe + hub.verify_token
//        (must equal META_WEBHOOK_VERIFY_TOKEN) + hub.challenge → echo the
//        challenge back as plain text 200. Anything else → 403.
// POST = acknowledge inbound events fast (Meta retries on slow/non-2xx) and
//        log a compact summary so the App Review screencast can show a live
//        inbound message arriving. Nothing is persisted.
//
// Real ingestion (comms inbox, replies, threading) is Phase 3 and deliberately
// NOT here. See docs/phase0-human-prep/meta-app-review.md §4.

import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
	const params = request.nextUrl.searchParams;
	const mode = params.get('hub.mode');
	const token = params.get('hub.verify_token');
	const challenge = params.get('hub.challenge');
	const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;

	// Fail closed: no configured token means nobody can subscribe.
	if (!expected || mode !== 'subscribe' || token !== expected || challenge === null) {
		return new NextResponse('Forbidden', { status: 403 });
	}
	return new NextResponse(challenge, {
		status: 200,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
}

interface MetaMessaging {
	sender?: { id?: string };
	recipient?: { id?: string };
	timestamp?: number;
	message?: { mid?: string; text?: string; is_echo?: boolean };
	postback?: { payload?: string; title?: string };
}
interface MetaEntry {
	id?: string;
	time?: number;
	messaging?: MetaMessaging[];
	changes?: unknown[];
}
interface MetaPayload {
	object?: string;
	entry?: MetaEntry[];
}

export async function POST(request: NextRequest) {
	let payload: MetaPayload | null = null;
	try {
		payload = (await request.json()) as MetaPayload;
	} catch {
		// Malformed body — still ack so Meta doesn't retry a bad event forever.
		console.log('[meta-webhook] non-JSON body');
		return NextResponse.json({ ok: true });
	}

	const summary = (payload?.entry ?? []).flatMap((entry) =>
		(entry.messaging ?? []).map((m) => ({
			account_id: entry.id,
			sender: m.sender?.id,
			recipient: m.recipient?.id,
			timestamp: m.timestamp,
			text: m.message?.text,
			mid: m.message?.mid,
			is_echo: m.message?.is_echo ?? false,
			postback: m.postback?.payload,
		})),
	);

	console.log(
		'[meta-webhook] inbound',
		JSON.stringify({ object: payload?.object, events: summary.length, summary }),
	);
	if (summary.length === 0) {
		// e.g. `changes` events or the console's Test button — log raw so it's visible.
		console.log('[meta-webhook] raw', JSON.stringify(payload));
	}

	return NextResponse.json({ ok: true, received: summary.length });
}
