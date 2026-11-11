// Permission helper for sensitive personnel info (PAP, comp, HR notes).
//
// Rules (mirror the SQL function `public.can_view_sensitive`):
//   - The subject can always see their own sensitive info.
//   - Users in `people_managers` see all sensitive info (the "tagged
//     people management" group: Alex, Jamie, Toni, JC, Terry seed).
//   - `exec` and `admin` roles see all sensitive info.
//   - Everyone else: no.
//
// Use this for UI gating BEFORE rendering sensitive sections. RLS in Supabase
// is the authoritative check at the DB layer.

import { cache } from 'react';
import { createClient, getAuthUser, getAuthProfile } from '@/lib/supabase/server';

export interface SensitiveAccessContext {
	viewerId: string | null;
	viewerRole: string | null;
	viewerIsPeopleManager: boolean;
	/**
	 * `profiles.is_active`. Deactivating someone used to strip their nav and
	 * their /admin access while leaving comp-editing rights intact until the
	 * JWT expired, because this context only carried `role`. Every elevation
	 * path below now requires an active viewer, matching what
	 * `getAccessibleModules()` already does.
	 */
	viewerIsActive: boolean;
}

const SIGNED_OUT: SensitiveAccessContext = {
	viewerId: null,
	viewerRole: null,
	viewerIsPeopleManager: false,
	viewerIsActive: false,
};

/**
 * Load the current viewer's auth context for sensitive-info gating.
 * Returns nulls when there is no authenticated user (RLS would block reads anyway).
 *
 * React-cached, and it reuses the shared `getAuthUser`/`getAuthProfile`
 * helpers: 23 call sites used to each pay their own Auth round-trip plus a
 * duplicate `profiles` SELECT that AppLayout had already made.
 */
export const loadSensitiveAccessContext = cache(async (): Promise<SensitiveAccessContext> => {
	const user = await getAuthUser();
	if (!user) return SIGNED_OUT;

	const supabase = await createClient();
	const [profile, { data: pm }] = await Promise.all([
		getAuthProfile(),
		supabase.from('people_managers').select('user_id').eq('user_id', user.id).maybeSingle(),
	]);

	return {
		viewerId: user.id,
		viewerRole: profile?.role ?? null,
		viewerIsPeopleManager: !!pm,
		// Absent column (older schema) is treated as active; only an explicit
		// false locks the viewer out.
		viewerIsActive: profile?.is_active !== false,
	};
});

/**
 * Pure function — given a context and a subject user id, can the viewer see
 * the subject's sensitive info?
 */
export function canViewSensitive(ctx: SensitiveAccessContext, subjectUserId: string): boolean {
	if (!ctx.viewerId) return false;
	// Own info stays visible regardless — someone mid-offboarding can still
	// read their own record; it is seeing OTHER people that requires standing.
	if (ctx.viewerId === subjectUserId) return true;
	if (!ctx.viewerIsActive) return false;
	if (ctx.viewerIsPeopleManager) return true;
	if (ctx.viewerRole === 'exec' || ctx.viewerRole === 'admin') return true;
	return false;
}

/**
 * Returns whether the viewer can edit personnel-management UI: people_managers,
 * profile_sensitive, leaderboard config, project_templates, etc.
 */
export function canManagePeople(ctx: SensitiveAccessContext): boolean {
	if (!ctx.viewerId || !ctx.viewerIsActive) return false;
	if (ctx.viewerIsPeopleManager) return true;
	if (ctx.viewerRole === 'exec' || ctx.viewerRole === 'admin') return true;
	return false;
}

/**
 * Structure fields on profiles (title, department, manager_id) are editable
 * only by people-managers / exec / admin — self-edit covers everything else
 * (decision 2026-08-18). Alias of canManagePeople so call sites read as what
 * they gate; the DB enforces the same via protect_profile_structure (0024).
 */
export function canEditStructure(ctx: SensitiveAccessContext): boolean {
	return canManagePeople(ctx);
}

/**
 * Returns whether the viewer can edit wiki content.
 */
export function canEditWiki(ctx: SensitiveAccessContext): boolean {
	if (!ctx.viewerId || !ctx.viewerIsActive) return false;
	if (ctx.viewerRole === 'exec' || ctx.viewerRole === 'admin' || ctx.viewerRole === 'manager') return true;
	if (ctx.viewerIsPeopleManager) return true;
	return false;
}

/**
 * Filter a list of wiki pages/spaces by visibility against the viewer.
 */
export function isVisibleTo(
	ctx: SensitiveAccessContext,
	visibility: string | null | undefined,
): boolean {
	if (!visibility || visibility === 'public') return true;
	if (visibility === 'team') return ctx.viewerId !== null;
	if (visibility === 'managers') return canManagePeople(ctx);
	if (visibility === 'self') return false; // would need subject id
	return false;
}

/**
 * Who may edit a 4R (migration 0093). Mirrors `public.can_edit_four_r`: the
 * person, anyone above them in the manager chain, people-managers, exec/admin.
 * The chain check needs data this context does not carry; the caller computes
 * `viewerIsInLeadershipChain` once with `isInLeadershipChain` (lib/people/fourR).
 */
export function canEditFourR(
	ctx: SensitiveAccessContext,
	subjectUserId: string,
	viewerIsInLeadershipChain: boolean,
): boolean {
	if (!ctx.viewerId || !ctx.viewerIsActive) return false;
	if (ctx.viewerId === subjectUserId) return true;
	if (canManagePeople(ctx)) return true;
	return viewerIsInLeadershipChain;
}
