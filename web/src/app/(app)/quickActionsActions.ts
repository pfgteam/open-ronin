'use server';

// Persist Home's per-user "Quick actions" choice (migration 0053).
//
// One row per person, upserted. Writing an EMPTY array is a legitimate save —
// it is how someone says "I want none of these" — so this action never treats
// an empty selection as a no-op or as "reset to defaults". See
// resolveQuickActions in @/lib/home/quickActions for the other half of that
// rule.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { QUICK_ACTIONS } from '@/lib/home/quickActions';
import { explainAndLog } from '@/lib/errors';

const VALID_KEYS = new Set(QUICK_ACTIONS.map((a) => a.key));

export async function saveQuickActions(
	keys: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false, error: 'Not signed in' };

	// Keep only keys the catalog knows, de-duplicated, IN THE ORDER GIVEN — the
	// stored array is the order the card renders in (see 0053's header and
	// resolveQuickActions), so the caller's order is the choice and this action
	// must not quietly re-sort it. A junk key would become a dead button and a
	// duplicate would render twice, so both are dropped.
	const seen = new Set<string>();
	const clean = keys.filter((k) => {
		if (!VALID_KEYS.has(k) || seen.has(k)) return false;
		seen.add(k);
		return true;
	});

	// adminOnly is NOT enforced here: RLS already confines the row to its
	// owner, and resolveQuickActions filters admin-only entries at render, so
	// a demoted admin's saved run_scraper stops showing without their row
	// having to be rewritten (and comes back if they are re-promoted).
	const { error } = await supabase
		.from('user_quick_actions')
		.upsert(
			{ user_id: auth.user.id, keys: clean, updated_at: new Date().toISOString() },
			{ onConflict: 'user_id' },
		);
	if (error) return { ok: false, error: explainAndLog(error, '(app).quickActionsActions') };

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `user_quick_actions/${auth.user.id}`,
		action: 'quick_actions.save',
		diff: { keys: clean },
	});

	revalidatePath('/');
	return { ok: true };
}
