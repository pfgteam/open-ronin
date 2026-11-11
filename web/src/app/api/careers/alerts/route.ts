// POST /api/careers/alerts — job-alert opt-in from the public careers pages
// (0129). Honeypot + per-ip rate limit like the referral form; writes
// through hire_subscribe_alert() (service role; dedupes on email).

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, number[]>();

export async function POST(request: Request) {
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	list.push(now);
	hits.set(ip, list);
	if (list.length > 10) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });

	let b: Record<string, unknown>;
	try {
		b = (await request.json()) as Record<string, unknown>;
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	if (typeof b.company_url === 'string' && b.company_url) return NextResponse.json({ ok: true });
	const email = typeof b.email === 'string' ? b.email.trim().slice(0, 200) : '';
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
	const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : null;
	const tags = Array.isArray(b.tags) ? (b.tags as unknown[]).filter((t): t is string => typeof t === 'string' && t.length > 0).map((t) => t.slice(0, 60)).slice(0, 10) : [];
	const positionId = typeof b.position_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.position_id) ? b.position_id : null;
	const source = typeof b.source === 'string' ? b.source.slice(0, 40) : 'careers';

	const svc = createServiceRoleClient();
	const { data: consent } = await svc.from('hire_settings').select('value').eq('key', 'consent').maybeSingle();
	const consentVersion = Number((consent as { value?: { version?: number } } | null)?.value?.version ?? 1);
	const { error } = await svc.rpc('hire_subscribe_alert', { p_email: email, p_name: name, p_tags: tags, p_position_id: positionId, p_source: source, p_consent: consentVersion });
	if (error) return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
	return NextResponse.json({ ok: true });
}
