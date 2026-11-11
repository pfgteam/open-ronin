// GET /api/portal/open/[token].gif — report open pixel (F6). Public; the
// token is a random 32-hex per report. Returns a 1×1 GIF always.
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
	const { token } = await ctx.params;
	const t = token.replace(/\.gif$/i, '');
	if (/^[0-9a-f]{32}$/.test(t)) await createServiceRoleClient().rpc('fw_report_opened', { p_token: t }).then(() => null, () => null);
	return new NextResponse(GIF, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0' } });
}
