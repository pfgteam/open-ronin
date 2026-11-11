// POST /api/intake/form/[slug] — the public MQL form door (0122). Signed-out
// visitors (the website embed, the thank-you routing) post their answers
// here; the forms engine validates with the same conditional logic the
// builder defined, the row lands in form_submissions and the
// form_submissions_zz_rev_intake trigger turns it into a scored, routed
// deal. Response carries the routing so the page can show the right
// thank-you (book a call / we'll reach out / nurture).
//
// Gate: the form must be 'open' AND its rev_form_links row must be
// public=true. Off by default (the GHL form keeps running until Alex
// flips it). Rate limit: 20 submissions per IP per 10 minutes, in memory.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { finalizeSubmission, parseFields, type FormValues } from '@/lib/forms/logic';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;
const LIMIT = 20;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	list.push(now);
	hits.set(ip, list);
	if (hits.size > 5000) hits.clear();
	return list.length > LIMIT;
}

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
	const { slug } = await ctx.params;
	if (!/^[a-z0-9-]{2,64}$/.test(slug)) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });
	const db = createServiceRoleClient();
	const { data: form } = await db.from('forms').select('id, title, description_md, status, fields').eq('slug', slug).maybeSingle();
	if (!form) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });
	const { data: link } = await db.from('rev_form_links').select('public, enabled').eq('form_id', form.id).maybeSingle();
	if (!link?.public || !link.enabled || form.status !== 'open') return NextResponse.json({ error: 'This form is not public.' }, { status: 404 });
	return NextResponse.json({ slug, title: form.title, description: form.description_md, fields: form.fields });
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
	const { slug } = await ctx.params;
	if (!/^[a-z0-9-]{2,64}$/.test(slug)) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
	if (limited(ip)) return NextResponse.json({ error: 'Too many submissions. Try again in a few minutes.' }, { status: 429 });

	let values: unknown;
	try {
		values = await request.json();
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	if (!values || typeof values !== 'object') return NextResponse.json({ error: 'Nothing to submit.' }, { status: 400 });

	const db = createServiceRoleClient();
	const { data: form } = await db.from('forms').select('id, status, fields').eq('slug', slug).maybeSingle();
	if (!form) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });
	const { data: link } = await db.from('rev_form_links').select('public, enabled, routing_copy').eq('form_id', form.id).maybeSingle();
	if (!link?.public || !link.enabled || form.status !== 'open') return NextResponse.json({ error: 'This form is not public.' }, { status: 404 });

	let fields;
	try {
		fields = parseFields(form.fields);
	} catch {
		return NextResponse.json({ error: 'This form is misconfigured.' }, { status: 500 });
	}
	// honeypot: a hidden "company_url" field bots fill
	if (typeof (values as Record<string, unknown>).company_url === 'string' && (values as Record<string, unknown>).company_url) {
		return NextResponse.json({ ok: true, routing: 'nurture', copy: (link.routing_copy as Record<string, unknown>)?.nurture ?? null });
	}
	const { data, errors } = finalizeSubmission(fields, values as FormValues);
	if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 400 });

	const { data: sub, error } = await db.from('form_submissions').insert({ form_id: form.id, submitted_by: null, data }).select('id').single();
	if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });

	// the trigger ran inside the insert; read what it produced
	const { data: ev } = await db.from('rev_intake_events').select('status, deal_id, error').eq('external_id', `form:${sub.id}`).maybeSingle();
	let routing: string | null = null;
	if (ev?.deal_id) {
		const { data: deal } = await db.from('rev_deals').select('routing, mql_tier').eq('id', ev.deal_id).maybeSingle();
		routing = (deal as { routing: string | null } | null)?.routing ?? null;
	}
	const copy = (link.routing_copy as Record<string, unknown>)?.[routing ?? 'nurture'] ?? (link.routing_copy as Record<string, unknown>)?.nurture ?? null;
	return NextResponse.json({ ok: true, routing: routing ?? 'nurture', copy, submission_id: sub.id });
}
