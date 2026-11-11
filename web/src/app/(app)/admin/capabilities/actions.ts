'use server';

// Server actions for /admin/capabilities: grant and revoke per person
// capabilities (user_capabilities, migration 0055).
//
// Moved here from /admin/roles/actions.ts when the capability editor became
// its own page (Module 10). Guards, in order:
//   1. requireAdmin()         only exec/admin write (RLS enforces the same).
//   2. canGrantCapability()   R6: `acquisitions` is grantable and revocable
//                             only by Alex. The user_capabilities_r6_guard
//                             trigger (0072) refuses everyone else in SQL, so
//                             this check exists for the readable error.
//   3. recordAudit            every grant and revoke lands in audit_log.
//
// Authorization is re-checked here and not merely in the UI. RLS refuses a
// non admin write anyway, but a policy filtered write affects zero rows and
// otherwise reports success; the operator would see the toggle move and
// nothing happen.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { CAPABILITIES, canGrantCapability, hasAdminFloor } from '@/lib/permissions/constants';

const PATH = '/admin/capabilities';

const CapabilityInput = z.object({
	userId: z.string().uuid(),
	capability: z.enum(CAPABILITIES),
	granted: z.boolean(),
});

function fail(message: string): never {
	redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

async function requireAdmin() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) fail('You are signed out. Sign in again and retry.');

	const { data: me } = await supabase
		.from('profiles')
		.select('id, role, is_active')
		.eq('id', user.id)
		.maybeSingle();

	if (!me || !me.is_active || !['admin', 'exec'].includes(me.role)) {
		fail('Only exec and admin accounts can change capabilities.');
	}
	return { supabase, actorId: user.id };
}

export async function setCapability(formData: FormData): Promise<void> {
	const { supabase, actorId } = await requireAdmin();

	const parsed = CapabilityInput.safeParse({
		userId: formData.get('user_id'),
		capability: formData.get('capability'),
		granted: formData.get('granted') === 'true',
	});
	if (!parsed.success) fail('Invalid capability toggle.');
	const { userId, capability, granted } = parsed.data;

	if (!canGrantCapability(capability, actorId)) {
		fail('Only Alex can grant or revoke acquisition sourcing.');
	}

	if (granted) {
		// Granting a floored capability to an admin creates a row that changes
		// nothing; refuse so the table stays an honest record of real grants.
		if (hasAdminFloor(capability)) {
			const { data: target } = await supabase
				.from('profiles')
				.select('role')
				.eq('id', userId)
				.maybeSingle();
			if (target && ['admin', 'exec'].includes(target.role)) {
				fail('Admin and exec already hold this capability without a grant.');
			}
		}
		// granted_by is the audit trail's other half: who handed this out, kept
		// on the row itself rather than only in audit_log.
		const { error } = await supabase
			.from('user_capabilities')
			.upsert(
				{ user_id: userId, capability, granted_by: actorId, granted_at: new Date().toISOString() },
				{ onConflict: 'user_id,capability' },
			);
		if (error) fail(`Could not grant: ${friendly(error.message)}`);
	} else {
		// .select() so an RLS denial is visible: a DELETE the policy filters out
		// removes zero rows and reports success.
		const { data: removed, error } = await supabase
			.from('user_capabilities')
			.delete()
			.eq('user_id', userId)
			.eq('capability', capability)
			.select('user_id');
		if (error) fail(`Could not revoke: ${friendly(error.message)}`);
		if (!removed || removed.length === 0) {
			fail('Nothing was revoked. The grant may already be gone, or you may lack permission.');
		}
	}

	await recordAudit({
		actor_id: actorId,
		entity_kind: 'supabase',
		entity_ref: `user_capabilities/${userId}/${capability}`,
		action: granted ? 'capability.grant' : 'capability.revoke',
		diff: { user_id: userId, capability, granted },
	});

	// The capability gates and the Home quick action read this per request.
	revalidatePath('/', 'layout');
	revalidatePath(PATH);
	redirect(PATH);
}

/** The R6 trigger raises with its own sentence; show that rather than the
 *  Postgres wrapper around it. */
function friendly(message: string): string {
	const r6 = message.match(/R6: [^\n]+/);
	return r6 ? r6[0] : message;
}
