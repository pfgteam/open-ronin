// POST /api/intake/[source] — webhook door for every connector in
// rev_intake_sources (0122): ManyChat, Leadhype, Instantly, Smartlead,
// Hyros, Meta / Google lead forms, GHL workflows, Zapier, a website form.
//
// Auth: the source's own token (x-intake-token or Bearer), hashed in the
// row; the source must be enabled. Fails closed: no token issued = 401 for
// everything. Service role inside so the vendor needs no Supabase identity.
// GET answers a tiny health check so a vendor's "test webhook" button has
// something to hit.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { presentedToken, processIntake, tokenMatches, type IntakeSourceRow } from '@/lib/revenue/intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

async function loadSource(key: string): Promise<IntakeSourceRow | null> {
	const db = createServiceRoleClient();
	const { data } = await db.from('rev_intake_sources').select('*').eq('key', key).maybeSingle();
	return (data as IntakeSourceRow | null) ?? null;
}

function gate(request: Request, source: IntakeSourceRow | null): NextResponse | null {
	if (!source) return NextResponse.json({ error: 'Unknown source.' }, { status: 404 });
	if (!source.enabled || !source.token_hash) return NextResponse.json({ error: 'This connector is disabled. Enable it and issue a token in Admin → Prospects → Connectors.' }, { status: 401 });
	if (!tokenMatches(presentedToken(request), source.token_hash)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
	return null;
}

export async function GET(request: Request, ctx: { params: Promise<{ source: string }> }) {
	const { source: key } = await ctx.params;
	if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Unknown source.' }, { status: 404 });
	const source = await loadSource(key);
	const denied = gate(request, source);
	if (denied) return denied;
	return NextResponse.json({ ok: true, source: key, label: source!.label, mapped_keys: Object.keys(source!.field_map) });
}

export async function POST(request: Request, ctx: { params: Promise<{ source: string }> }) {
	const { source: key } = await ctx.params;
	if (!KEY_RE.test(key)) return NextResponse.json({ error: 'Unknown source.' }, { status: 404 });
	const source = await loadSource(key);
	const denied = gate(request, source);
	if (denied) return denied;

	let body: unknown;
	const ct = request.headers.get('content-type') ?? '';
	try {
		if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
			const fd = await request.formData();
			const o: Record<string, unknown> = {};
			for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : v.name;
			body = o;
		} else {
			body = await request.json();
		}
	} catch {
		return NextResponse.json({ error: 'Body must be JSON (or a form post).' }, { status: 400 });
	}

	// Some vendors batch: an array of leads, or { leads: [...] } / { data: [...] }.
	const items: unknown[] = Array.isArray(body)
		? body
		: body && typeof body === 'object' && Array.isArray((body as { leads?: unknown[] }).leads)
			? (body as { leads: unknown[] }).leads
			: body && typeof body === 'object' && Array.isArray((body as { data?: unknown[] }).data) && !(body as { email?: unknown }).email
				? (body as { data: unknown[] }).data
				: [body];
	if (items.length > 200) return NextResponse.json({ error: 'At most 200 leads per call.' }, { status: 413 });

	const db = createServiceRoleClient();
	const results = [];
	for (const item of items) results.push(await processIntake(db, source!, item));
	const summary = {
		received: items.length,
		processed: results.filter((r) => r.status === 'processed').length,
		duplicate: results.filter((r) => r.status === 'duplicate').length,
		rejected: results.filter((r) => r.status === 'rejected').length,
		ignored: results.filter((r) => r.status === 'ignored').length,
		results: items.length === 1 ? results[0] : results.slice(0, 20),
	};
	return NextResponse.json(summary, { status: summary.rejected === items.length ? 422 : 200 });
}
