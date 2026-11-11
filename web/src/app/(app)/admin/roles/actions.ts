'use server';

// Server actions for /admin/roles — the editor for the module × role matrix
// (public.role_permissions, migration 0024).
//
// Guards, in order:
//   1. requireAdmin()      — only exec/admin change the matrix (RLS enforces
//                            the same at the DB layer).
//   2. anti-lockout floor  — exec/admin rows are not editable: the SQL
//                            function has_module_access() ignores them, so
//                            accepting an edit here would only create a lie.
//   3. recordAudit         — every toggle lands in audit_log.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { MODULE_KEYS, ROLES } from '@/lib/permissions/constants';

const ToggleInput = z.object({
	role: z.enum(ROLES),
	module: z.enum(MODULE_KEYS),
	allowed: z.boolean(),
});

function fail(message: string): never {
	redirect(`/admin/roles?error=${encodeURIComponent(message)}`);
}

async function requireAdmin() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) fail('You are signed out — sign in again and retry.');

	const { data: me } = await supabase
		.from('profiles')
		.select('id, role, is_active')
		.eq('id', user.id)
		.maybeSingle();

	if (!me || !me.is_active || !['admin', 'exec'].includes(me.role)) {
		fail('Only exec and admin accounts can change permissions.');
	}
	return { supabase, actorId: user.id };
}

export async function setModulePermission(formData: FormData): Promise<void> {
	const { supabase, actorId } = await requireAdmin();

	const parsed = ToggleInput.safeParse({
		role: formData.get('role'),
		module: formData.get('module'),
		allowed: formData.get('allowed') === 'true',
	});
	if (!parsed.success) fail('Invalid permission toggle.');
	const { role, module, allowed } = parsed.data;

	// Anti-lockout floor: exec/admin always have every module (enforced inside
	// has_module_access()), so their rows are display-only.
	if (role === 'exec' || role === 'admin') {
		fail('Exec and admin always have full access — that row is locked.');
	}

	const { error } = await supabase
		.from('role_permissions')
		.upsert(
			{ role, module_key: module, allowed, updated_by: actorId, updated_at: new Date().toISOString() },
			{ onConflict: 'role,module_key' },
		);

	if (error) fail(`Could not save: ${error.message}`);

	await recordAudit({
		actor_id: actorId,
		entity_kind: 'supabase',
		entity_ref: `role_permissions/${role}/${module}`,
		action: allowed ? 'permission.grant' : 'permission.revoke',
		diff: { role, module, allowed },
	});

	// Nav + gates read the matrix per request; refresh everything visible.
	revalidatePath('/', 'layout');
	revalidatePath('/admin/roles');
	redirect('/admin/roles');
}
