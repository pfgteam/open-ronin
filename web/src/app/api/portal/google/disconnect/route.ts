// POST /api/portal/google/disconnect
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getPortalSession } from '@/lib/flywheel/portal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	const origin = new URL(request.url).origin;
	const s = await getPortalSession(null);
	if (!s) return NextResponse.redirect(new URL('/portal', origin), 303);
	await createServiceRoleClient().from('fw_google_connections').update({ status: 'revoked', encrypted_refresh_token: null, ga4_property_id: null, sc_site_url: null, gbp_location_id: null }).eq('client_id', s.client_id);
	return NextResponse.redirect(new URL('/portal?tab=connections', origin), 303);
}
