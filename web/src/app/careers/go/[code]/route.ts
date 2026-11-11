// GET /careers/go/[code] — tracked apply link (0129). Records the hit (hashed
// ip, ua, referer) through hire_link_hit() and 302s to the role with ?src=
// so the application (H3) can attribute the candidate to the board or the
// referring team member. Unknown / inactive code -> /careers.

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
	const { code } = await ctx.params;
	const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
	if (!/^[a-z0-9][a-z0-9-]{3,40}$/.test(code)) return NextResponse.redirect(`${base}/careers`, 302);
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
	const ipHash = ip ? createHash('sha256').update(`${ip}:${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 32) : null;
	const svc = createServiceRoleClient();
	const { data } = await svc.rpc('hire_link_hit', { p_code: code, p_ip_hash: ipHash, p_user_agent: request.headers.get('user-agent') ?? null, p_referer: request.headers.get('referer') ?? null });
	const hit = data as { slug?: string; status?: string; source?: string } | null;
	if (!hit?.slug) return NextResponse.redirect(`${base}/careers`, 302);
	const res = NextResponse.redirect(`${base}/careers/${hit.slug}?src=${encodeURIComponent(code)}`, 302);
	// 30-day first-touch cookie so a later direct visit still attributes.
	res.cookies.set('or_src', code, { maxAge: 30 * 86400, path: '/careers', sameSite: 'lax', httpOnly: false });
	return res;
}
