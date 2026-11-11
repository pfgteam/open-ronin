// POST /api/integrations/google-cal/disconnect
//
// Revokes the OAuth grant at Google + deletes the local connection row.
// Calendar events synced from Google stay in our DB (the user can re-
// connect later and resume); we just stop pulling deltas.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { revokeToken, storedRefreshToken } from '@/lib/google/calendar';

export const dynamic = 'force-dynamic';

export async function POST() {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	const { data: conns } = await supabase
		.from('google_calendar_connections')
		.select('id, encrypted_refresh_token')
		.eq('user_id', auth.user.id);

	for (const c of conns ?? []) {
		if (c.encrypted_refresh_token) {
			try { await revokeToken(storedRefreshToken(c.encrypted_refresh_token)); } catch { /* non-fatal */ }
		}
	}

	const { error } = await supabase
		.from('google_calendar_connections')
		.delete()
		.eq('user_id', auth.user.id);

	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}
