'use server';

// First-run setup: claim admin on a fresh install, then apply the org config
// through public.apply_org_config() (the same RPC `pnpm setup:apply` uses), so
// the wizard and the CLI cannot drift. RLS + the RPC's own admin check are the
// real guard; this file only turns their refusals into readable errors.

import { revalidateTag } from 'next/cache';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { parseOrgConfig, type ApplyResult } from '@/lib/tenant/config';
import { ORG_TAG } from '@/lib/tenant/server';
import { DESIGN_TAG } from '@/lib/design/server';

export async function applySetup(input: unknown): Promise<ApplyResult> {
	const user = await getAuthUser();
	if (!user) return { ok: false, error: 'Sign in first.' };

	const parsed = parseOrgConfig(input);
	if (!parsed.ok) return { ok: false, error: 'The config has errors.', errors: parsed.errors };

	const supabase = await createClient();

	// Fresh install: the first signed-in user becomes admin (only while no
	// admin exists and setup is open; the RPC enforces both).
	const { data: state } = await supabase.rpc('setup_state');
	const st = (state ?? {}) as { has_admin?: boolean; setup_completed?: boolean };
	if (!st.has_admin) {
		const { error } = await supabase.rpc('setup_claim_admin');
		if (error) return { ok: false, error: `Could not make you the first admin: ${error.message}` };
	}

	const { data, error } = await supabase.rpc('apply_org_config', { p_config: parsed.config, p_complete: true });
	if (error) {
		const denied = /insufficient_privilege|only an admin/i.test(error.message);
		return { ok: false, error: denied ? 'Only an admin can run setup. Ask your admin to finish it.' : error.message };
	}

	revalidateTag(ORG_TAG);
	revalidateTag(DESIGN_TAG);
	const d = (data ?? {}) as { service_lines?: number; departments?: number; modules?: Record<string, boolean> };
	return { ok: true, summary: { service_lines: d.service_lines ?? 0, departments: d.departments ?? 0, modules: d.modules ?? {} } };
}
