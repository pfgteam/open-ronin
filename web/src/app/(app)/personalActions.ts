'use server';

// Personal page layout (rework D5): saved per person in
// user_dashboard_layout under dashboard_key 'personal' (own-row RLS).

import { createClient } from '@/lib/supabase/server';
import { normalizeLayout, type TileSlot } from '@/lib/home/personalLayout';

export async function savePersonalLayout(layout: TileSlot[] | null): Promise<{ ok: true } | { ok: false; error: string }> {
	const supabase = await createClient();
	const { data } = await supabase.auth.getUser();
	if (!data.user) return { ok: false, error: 'Not signed in.' };
	if (layout === null) {
		// Reset to the default for my role.
		const { error } = await supabase.from('user_dashboard_layout').delete().eq('user_id', data.user.id).eq('dashboard_key', 'personal');
		return error ? { ok: false, error: error.message } : { ok: true };
	}
	const clean = normalizeLayout(layout, []);
	if (!clean.length) return { ok: false, error: 'Nothing to save.' };
	const { error } = await supabase.from('user_dashboard_layout')
		.upsert({ user_id: data.user.id, dashboard_key: 'personal', layout: clean, updated_at: new Date().toISOString() }, { onConflict: 'user_id,dashboard_key' });
	return error ? { ok: false, error: error.message } : { ok: true };
}
