'use server';

// The Add prospect dialog loads its options on open (not with the page that
// hosts the button), so the button can sit on any screen without that screen
// paying for pipelines / staff / products it may never show.

import { getAuthProfile } from '@/lib/supabase/server';
import { loadQuickAddData, type QuickAddData, type QuickAddOpen } from './data';

export async function loadQuickAdd(open: QuickAddOpen): Promise<{ ok: true; data: QuickAddData; meId: string; meEmail: string } | { ok: false; error: string }> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const data = await loadQuickAddData({ pipeline: open.pipeline ?? null, person: open.person ?? null, brand: open.brand ?? null });
	if (!data) return { ok: false, error: 'Prospects is not set up yet.' };
	return { ok: true, data, meId: profile.id, meEmail: profile.email ?? '' };
}
