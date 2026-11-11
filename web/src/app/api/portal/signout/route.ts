// POST /api/portal/signout
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	const sb = await createClient();
	await sb.auth.signOut();
	return NextResponse.redirect(new URL('/portal', new URL(request.url).origin), 303);
}
