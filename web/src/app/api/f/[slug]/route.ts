// /api/f/[slug] — the public forms door (0158). GET returns the form
// definition (what the hosted page and the embed render); POST accepts a
// signed-out fill: JSON body of { ...answers, _source_url?, _turnstile? }.
// Gate, honeypot, rate limit, file check and the notification all live in
// lib/forms/server so the MQL form can move here later unchanged.

import { NextResponse } from 'next/server';
import { clientIp, loadPublicForm, submitPublicForm } from '@/lib/forms/server';

export const dynamic = 'force-dynamic';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type',
};

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
	const { slug } = await ctx.params;
	const loaded = await loadPublicForm(slug);
	if (!loaded) return NextResponse.json({ error: 'This form is not available.' }, { status: 404, headers: CORS });
	return NextResponse.json(loaded.def, { headers: CORS });
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
	const { slug } = await ctx.params;
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400, headers: CORS });
	}
	const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
	const { _source_url, _turnstile, ...values } = b;
	const res = await submitPublicForm(slug, values, {
		ip: clientIp(request),
		user_agent: request.headers.get('user-agent'),
		source_url: typeof _source_url === 'string' ? _source_url : request.headers.get('referer'),
		referrer: request.headers.get('referer'),
		turnstile_token: typeof _turnstile === 'string' ? _turnstile : null,
	});
	if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: CORS });
	return NextResponse.json(res, { headers: CORS });
}
