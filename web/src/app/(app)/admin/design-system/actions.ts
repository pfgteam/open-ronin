'use server';

// Admin › Design system writes (0161). Admin only: requireAdmin here for a
// readable refusal, design_settings_update (is_admin()) as the real guard.
// The client sends the FULL override object; it is validated with the same
// schema the reader uses, pruned of empty keys, stored, audited, and the
// cached theme is revalidated so every page picks it up on the next request.

import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { designSettingsSchema, prune, type DesignSettings } from '@/lib/design/settings';
import { DESIGN_TAG } from '@/lib/design/server';

type Result = { ok: true; settings: DesignSettings } | { ok: false; error: string };

async function requireAdmin(): Promise<{ actorId: string } | { error: string }> {
	const viewer = await getAuthProfile();
	if (!viewer) return { error: 'You are signed out. Sign in again and retry.' };
	if (!viewer.is_active || !['admin', 'exec'].includes(viewer.role)) return { error: 'Only exec and admin accounts can change the design system.' };
	return { actorId: viewer.id };
}

export async function saveDesignSettings(input: unknown): Promise<Result> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };
	const parsed = designSettingsSchema.safeParse(input);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { ok: false, error: `${first.path.join(' › ') || 'Settings'}: ${first.message}` };
	}
	const settings = prune(parsed.data);
	const supabase = await createClient();
	const { data: row } = await supabase.from('design_settings').select('id, settings').order('created_at').limit(1).maybeSingle();
	const { error } = row
		? await supabase.from('design_settings').update({ settings, updated_by: gate.actorId }).eq('id', row.id)
		: await supabase.from('design_settings').insert({ settings, updated_by: gate.actorId });
	if (error) return { ok: false, error: /does not exist|schema cache/.test(error.message) ? 'Migration 0161 is not applied yet.' : error.message };
	await recordAudit({ actor_id: gate.actorId, entity_kind: 'supabase', entity_ref: `design_settings:${row?.id ?? 'new'}`, action: 'design_settings.update', diff: { before: row?.settings ?? {}, after: settings } });
	revalidateTag(DESIGN_TAG);
	revalidatePath('/', 'layout');
	return { ok: true, settings };
}
