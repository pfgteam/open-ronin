// Per-person capabilities — server helpers over `user_capabilities` (0055).
//
// Sits alongside modules.ts rather than inside it, because the two answer
// different questions. A module is "which sections of the app does this ROLE
// see"; a capability is "may THIS PERSON do this specific thing". The scraper
// needed the second because scraped_records holds third-party PII and
// widening a role would hand it to everyone holding that role.
//
// FAILURE POSTURE — the one deliberate difference from modules.ts. When the
// matrix is unreadable, getAccessibleModules() falls back to the legacy
// honest-nav defaults rather than locking the whole app out; that is the right
// call for navigation. Here it is the wrong call: a transient failure must
// never hand out PII access. An unreadable capability table denies, and the
// user sees the restricted card rather than someone else's contact database.

import { cache } from 'react';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import {
	CAPABILITIES,
	CAPABILITIES_WITH_ADMIN_FLOOR,
	isElevatedRole,
	type CapabilityKey,
} from './constants';

export { CAPABILITIES, CAPABILITY_LABELS, CAPABILITY_DESCRIPTIONS } from './constants';
export type { CapabilityKey } from './constants';

/**
 * The viewer's capabilities for this request (React-cached — one SELECT per
 * RSC render, shared by a route layout and anything else that asks).
 *
 * Admin/exec get every capability in CAPABILITIES_WITH_ADMIN_FLOOR without
 * holding a row, mirroring the anti-lockout floor in can_run_scrapers()
 * (0055) and can_import_data() (0068). `acquisitions` is NOT on that floor:
 * can_view_acquisitions() (0060) has no is_admin() shortcut and the UI must
 * not promise what the database refuses. Inactive and signed-out viewers get
 * an empty set; RLS enforces the same thing server-side, so this is the fast
 * path, not the security boundary.
 */
export const getCapabilities = cache(async (): Promise<Set<CapabilityKey>> => {
	const profile = await getAuthProfile();
	if (!profile || profile.is_active === false) return new Set();

	const elevated = isElevatedRole(profile.role);

	const supabase = await createClient();
	const { data, error } = await supabase
		.from('user_capabilities')
		.select('capability')
		.eq('user_id', profile.id);

	// Deny on failure — see FAILURE POSTURE above. This covers 0055 not being
	// applied yet, which is the state between deploy and Sam pasting the
	// migration: the scraper stays admin-only rather than open.
	if (error) return elevated ? new Set(CAPABILITIES_WITH_ADMIN_FLOOR) : new Set();

	const keys = (data ?? [])
		.map((r) => r.capability as CapabilityKey)
		.filter((k) => (CAPABILITIES as readonly string[]).includes(k));
	if (elevated) for (const k of CAPABILITIES_WITH_ADMIN_FLOOR) keys.push(k);
	return new Set(keys);
});

export async function hasCapability(capability: CapabilityKey): Promise<boolean> {
	const capabilities = await getCapabilities();
	return capabilities.has(capability);
}
