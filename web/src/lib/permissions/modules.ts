// App-wide module permissions — server helpers over the module × role matrix
// introduced in migration 0024 (`app_modules` + `role_permissions`).
//
// How the pieces fit (defense in depth, decided 2026-08-18):
//   1. DB      — `role_permissions` is the source of truth; RLS policies call
//                `has_module_access()` where a module owns tables (data_*).
//   2. Server  — section layouts render <ModuleGate> and server actions call
//                `hasModuleAccess()` before writing.
//   3. UI      — TopNav/SideNav hide entries for modules the viewer lacks
//                (AppLayout seeds the auth store with the resolved set).
//
// Anti-lockout floor (mirrors the SQL function): `admin` and `exec` always
// have every module — the matrix cannot demote them. This guarantees an
// admin can never lock admins out of /admin/roles itself.

import { cache } from 'react';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { MODULE_KEYS, isElevatedRole, legacyDefaultModules, type ModuleKey } from './constants';

export { MODULE_KEYS, MODULE_LABELS, ROLES, ROUTE_MODULES, moduleForPath } from './constants';
export type { ModuleKey, RoleKey } from './constants';

/**
 * Resolve the viewer's accessible modules for this request (React-cached —
 * one role_permissions SELECT per RSC render, shared by layout + nav + pages).
 * Inactive / signed-out viewers get an empty set.
 */
export const getAccessibleModules = cache(async (): Promise<Set<ModuleKey>> => {
	const profile = await getAuthProfile();
	if (!profile || profile.is_active === false) return new Set();

	const supabase = await createClient();
	// Org-wide switches (setup wizard / app_modules.enabled). Unreadable = all on.
	const { data: mods } = await supabase.from('app_modules').select('key, enabled');
	const off = new Set((mods ?? []).filter((m: { enabled?: boolean }) => m.enabled === false).map((m: { key: string }) => m.key));
	if (isElevatedRole(profile.role)) return new Set(MODULE_KEYS.filter((k) => !off.has(k)));

	const { data, error } = await supabase
		.from('role_permissions')
		.select('module_key')
		.eq('role', profile.role)
		.eq('allowed', true);

	// Matrix unreadable (0024 not applied yet / transient failure) → fall back
	// to the legacy honest-nav rules instead of locking the whole app.
	if (error) return new Set(legacyDefaultModules(profile.role));

	const keys = (data ?? [])
		.map((r) => r.module_key as ModuleKey)
		.filter((k) => (MODULE_KEYS as readonly string[]).includes(k) && !off.has(k));
	return new Set(keys);
});

export async function hasModuleAccess(module: ModuleKey): Promise<boolean> {
	const modules = await getAccessibleModules();
	return modules.has(module);
}
