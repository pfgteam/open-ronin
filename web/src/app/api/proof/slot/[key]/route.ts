// /api/proof/slot/[key] — the website's rotation door (0160). Returns the
// items this visitor should see in a slot (weighted random or bandit), each
// with its placement_id so the site can POST impressions / clicks /
// conversions to /api/proof/events. Ready rows only; CORS open (the site is
// a different origin). ?n= caps the count below the slot's max_items.

import { NextResponse } from 'next/server';
import { publicSlot } from '@/lib/proof/server';

export const dynamic = 'force-dynamic';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type',
	'Cache-Control': 'no-store',
};

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request, ctx: { params: Promise<{ key: string }> }) {
	const { key } = await ctx.params;
	if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(key)) return NextResponse.json({ error: 'Bad slot key.' }, { status: 400, headers: CORS });
	const n = Number(new URL(request.url).searchParams.get('n') ?? '');
	const res = await publicSlot(key, Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined);
	if (!res) return NextResponse.json({ error: 'Unknown slot.' }, { status: 404, headers: CORS });
	if ('error' in res) return NextResponse.json({ error: 'Proof Library is not available.' }, { status: 503, headers: CORS });
	return NextResponse.json(res, { headers: CORS });
}
