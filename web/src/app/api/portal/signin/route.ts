// POST /api/portal/signin — magic link request from the portal form.
import { NextResponse } from 'next/server';
import { requestPortalLink } from '@/lib/flywheel/portal';

export const dynamic = 'force-dynamic';
const hits = new Map<string, number[]>();

export async function POST(request: Request) {
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < 900_000);
	list.push(now);
	hits.set(ip, list);
	const origin = new URL(request.url).origin;
	if (list.length > 10) return NextResponse.redirect(new URL('/portal?error=Too+many+attempts.+Try+again+in+15+minutes.', origin), 303);
	const form = await request.formData().catch(() => null);
	const email = String(form?.get('email') ?? '').trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.redirect(new URL('/portal?error=Enter+a+valid+email.', origin), 303);
	await requestPortalLink(email, `${origin}/auth/callback?next=/portal`);
	return NextResponse.redirect(new URL('/portal?sent=1', origin), 303);
}
