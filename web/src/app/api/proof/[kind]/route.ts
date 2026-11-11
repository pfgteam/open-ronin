// /api/proof/[kind] — the website's catalog door (0160). kind is
// case-studies | testimonials | assets. Ready rows only, filters:
// ?industry= ?service= ?type= (assets) ?media_type= ?featured=1 ?limit=.
// CORS open; cached for a minute at the edge so a page build can call it
// freely.

import { NextResponse } from 'next/server';
import { publicList } from '@/lib/proof/server';
import { kindFromSegment } from '@/lib/proof/shared';

export const dynamic = 'force-dynamic';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type',
	'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
};

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
	const { kind: segment } = await ctx.params;
	const kind = kindFromSegment(segment);
	if (!kind) return NextResponse.json({ error: 'Unknown kind. Use case-studies, testimonials or assets.' }, { status: 404, headers: CORS });
	const sp = new URL(request.url).searchParams;
	const limit = Number(sp.get('limit') ?? '');
	const res = await publicList(kind, {
		industry: sp.get('industry'),
		service: sp.get('service'),
		type: sp.get('type'),
		media_type: sp.get('media_type'),
		featured: sp.get('featured') === '1' || sp.get('featured') === 'true',
		limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined,
	});
	if ('error' in res) return NextResponse.json({ error: 'Proof Library is not available.' }, { status: 503, headers: CORS });
	return NextResponse.json({ kind, count: res.items.length, items: res.items }, { headers: CORS });
}
