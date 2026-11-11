// /api/proof/slots — the website's manifest door (0160). Every active slot
// with its live placements and `ready` items in one cached response, so a
// page build reads one URL instead of one per slot. Optional filters:
// ?page=home and ?keys=home.case_studies,home.stats (both apply if given).
// Items are ordered by weight (no per-visitor pick: use /api/proof/slot/<key>
// for rotation). Read-only, CORS open, cached at the edge for 5 minutes.

import { NextResponse } from 'next/server';
import { publicSlots } from '@/lib/proof/server';

export const dynamic = 'force-dynamic';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type',
};
const CACHE = { ...CORS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' };
const NO_STORE = { ...CORS, 'Cache-Control': 'no-store' };

const KEY_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const PAGE_RE = /^[a-z0-9_-]+$/;
const MAX_KEYS = 100;

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CACHE });
}

export async function GET(request: Request) {
	const sp = new URL(request.url).searchParams;
	const page = sp.get('page');
	if (page !== null && (!PAGE_RE.test(page) || page.length > 64)) return NextResponse.json({ error: 'Bad page.' }, { status: 400, headers: NO_STORE });
	const rawKeys = sp.get('keys');
	let keys: string[] | undefined;
	if (rawKeys !== null) {
		keys = Array.from(new Set(rawKeys.split(',').map((k) => k.trim()).filter(Boolean)));
		if (!keys.length || keys.length > MAX_KEYS || keys.some((k) => !KEY_RE.test(k) || k.length > 128)) {
			return NextResponse.json({ error: 'Bad slot keys.' }, { status: 400, headers: NO_STORE });
		}
	}
	const res = await publicSlots({ page, keys });
	if ('error' in res) return NextResponse.json({ error: 'Proof Library is not available.' }, { status: 503, headers: NO_STORE });
	return NextResponse.json(res, { headers: CACHE });
}
