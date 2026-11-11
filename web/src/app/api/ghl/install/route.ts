// GET /api/ghl/install?label=org|beacon|media
// Generates a CSRF state, persists it, and redirects to the GHL authorize URL.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildAuthorizeUrl, isGhlConfigured } from '@/lib/ghl/config';
import { safeInternalPath } from '@/lib/safeRedirect';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
	if (!isGhlConfigured()) {
		return NextResponse.json(
			{ error: 'GHL is not configured. Set GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_REDIRECT_URI.' },
			{ status: 500 },
		);
	}

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return NextResponse.redirect(new URL('/auth/login', req.url));

	// Admin/exec gate
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
	if (!profile || !['exec', 'admin'].includes(profile.role ?? '')) {
		return NextResponse.json({ error: 'Forbidden - exec/admin only' }, { status: 403 });
	}

	const label = req.nextUrl.searchParams.get('label') ?? null;
	// Validated here rather than at the callback so a hostile value never gets
	// persisted in ghl_oauth_states in the first place.
	const redirectAfter = safeInternalPath(
		req.nextUrl.searchParams.get('redirect_after'),
		'/admin/integrations/ghl',
	);
	const state = randomBytes(24).toString('hex');

	await supabase.from('ghl_oauth_states').insert({
		state,
		redirect_after: redirectAfter,
		initiated_by: user.id,
		sub_account_label: label,
	});

	return NextResponse.redirect(buildAuthorizeUrl(state));
}
