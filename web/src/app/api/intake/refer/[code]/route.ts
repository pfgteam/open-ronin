// POST /api/intake/refer/[code] — the referral form's door (0127). The code
// is the credential; a submission becomes a deal through rev_intake_scored
// with source 'referral', then rev_attach_referral links it to the code.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, number[]>();

export async function POST(request: Request, ctx: { params: Promise<{ code: string }> }) {
	const { code } = await ctx.params;
	if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 });
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	list.push(now);
	hits.set(ip, list);
	if (list.length > 10) return NextResponse.json({ error: 'Too many submissions. Try again later.' }, { status: 429 });

	let b: Record<string, unknown>;
	try {
		b = (await request.json()) as Record<string, unknown>;
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	if (typeof b.company_url === 'string' && b.company_url) return NextResponse.json({ ok: true });
	const s = (k: string) => (typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim().slice(0, 300) : null);
	if (!s('brand') || !s('contact_name') || !s('your_name') || !s('your_email')) return NextResponse.json({ error: 'Brand, contact name, your name and your email are required.' }, { status: 400 });
	if (!s('email') && !s('phone')) return NextResponse.json({ error: 'Give the contact\'s email or phone.' }, { status: 400 });

	const db = createServiceRoleClient();
	const { data: rc } = await db.from('rev_referral_codes').select('code, referrer_name, referrer_email, is_active').eq('code', code).maybeSingle();
	if (!rc?.is_active) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 });

	const payload = {
		display_name: s('contact_name'),
		email: s('email'),
		phone: s('phone'),
		brand_name: s('brand'),
		brand_website: s('website') && /^https?:\/\//.test(s('website')!) ? s('website') : s('website') ? `https://${s('website')!.replace(/^@/, 'instagram.com/')}` : null,
		pipeline: 'marketing',
		source: 'referral',
		channel: 'web',
		created_via: 'webhook',
		notes: `Referred by ${s('your_name')} <${s('your_email')}> via ${code}.${s('why') ? `\n\n${s('why')}` : ''}`,
		meta: { referral_code: code, referrer_name: s('your_name'), referrer_email: s('your_email') },
		activity: { kind: 'form', channel: 'web', direction: 'inbound', subject: `Referral from ${s('your_name')}`, body_md: s('why'), is_touch: true, external_source: 'refer', external_id: `${code}:${now}` },
	};
	const { data: r, error } = await db.rpc('rev_intake_scored', { p: payload });
	if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
	const dealId = (r as { deal_id?: string | null })?.deal_id;
	if (dealId) await db.rpc('rev_attach_referral', { p_deal: dealId, p_code: code });
	await db.from('rev_intake_events').insert({ source_key: 'website_form', external_id: `refer:${code}:${now}`, status: 'processed', payload: b, mapped: payload, deal_id: dealId ?? null, processed_at: new Date().toISOString() });
	return NextResponse.json({ ok: true });
}
