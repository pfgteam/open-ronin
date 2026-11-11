'use server';

// Server actions for /admin/users — the ONLY write path for role /
// department / active changes from the UI.
//
// Defense layers (in order):
//   1. zod validation  — reject malformed input before touching anything
//   2. authorization   — caller must be an active admin/exec
//   3. anti-lockout    — no self-demotion; never demote/deactivate the last
//                        active admin
//   4. DB enforcement  — RLS `profiles_admin_all` + the 0021 trigger blocks
//                        role/is_active changes by non-admins even if this
//                        action is bypassed entirely
// Every change is recorded in audit_log (who changed whom, before → after).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { explainAndLog } from '@/lib/errors';

const ROLES = ['exec', 'admin', 'manager', 'contributor'] as const;

export type UserRole = (typeof ROLES)[number];

// The hardcoded DEPARTMENTS enum is gone (0089). It was a second, stale
// vocabulary — Media / Lead Gen / Dev / Sales — that no longer matched the
// canon tags (Delivery / Ops / Revenue / Marketing / Social Media / Beacon),
// and it is what made this screen able to write a value the rest of the app
// could not resolve. The department is now a tag id, validated against the
// tags table at write time rather than against a list in this file.
const UpdateUserProfileInput = z.object({
	userId: z.string().uuid(),
	role: z.enum(ROLES).optional(),
	departmentTagId: z.string().uuid().nullable().optional(),
	isActive: z.boolean().optional(),
	/** 0117: active but never assessed in Calibration / Vantage Point. */
	calibrationExcluded: z.boolean().optional(),
});

export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileInput>;

const ELEVATED: readonly string[] = ['admin', 'exec'];

export async function updateUserProfile(raw: UpdateUserProfileInput) {
	// 1. Validate shape/values before anything else.
	const parsed = UpdateUserProfileInput.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false as const,
			error: 'Invalid input — refresh the page and try again.',
		};
	}
	const { userId, role, departmentTagId, isActive, calibrationExcluded } = parsed.data;
	if (role === undefined && departmentTagId === undefined && isActive === undefined && calibrationExcluded === undefined) {
		return { ok: false as const, error: 'Nothing to update.' };
	}

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { ok: false as const, error: 'Not signed in.' };

	// 2. Authorization: only active admins/execs manage users.
	const { data: me } = await supabase
		.from('profiles')
		.select('id, role, is_active')
		.eq('id', user.id)
		.maybeSingle();
	if (!me || !me.is_active || !ELEVATED.includes(me.role)) {
		return { ok: false as const, error: 'Only admins can manage users.' };
	}

	// `*` rather than a column list: calibration_excluded (0117) is read when
	// present and simply absent before the migration lands, so role/active
	// edits keep working either way.
	const { data: targetRow } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', userId)
		.maybeSingle();
	const target = targetRow as
		| { id: string; email: string; role: string; department_tag_id: string | null; is_active: boolean; calibration_excluded?: boolean | null }
		| null;
	if (!target) return { ok: false as const, error: 'User not found.' };

	// 3a. Anti-lockout: you can't demote or deactivate yourself.
	if (userId === user.id) {
		const changingOwnRole = role !== undefined && role !== me.role;
		if (changingOwnRole || isActive === false) {
			return {
				ok: false as const,
				error: "You can't change your own role or deactivate yourself — ask another admin.",
			};
		}
	}

	// 3b. Anti-lockout: never demote/deactivate the last active admin.
	const losesElevation =
		ELEVATED.includes(target.role) &&
		((role !== undefined && !ELEVATED.includes(role)) || isActive === false);
	if (losesElevation && target.is_active) {
		const { count } = await supabase
			.from('profiles')
			.select('id', { count: 'exact', head: true })
			.in('role', [...ELEVATED])
			.eq('is_active', true);
		if ((count ?? 0) <= 1) {
			return {
				ok: false as const,
				error: 'This is the last active admin — promote someone else first.',
			};
		}
	}

	// A tag id from the client is only trusted once it resolves to a real
	// department row — otherwise this screen could point a profile at a
	// sub-team or an org and break every department filter downstream.
	if (departmentTagId) {
		const { data: tag } = await supabase
			.from('tags')
			.select('id')
			.eq('id', departmentTagId)
			.eq('category', 'department')
			.maybeSingle();
		if (!tag) return { ok: false as const, error: 'That department no longer exists.' };
	}

	const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (role !== undefined) patch.role = role;
	if (departmentTagId !== undefined) patch.department_tag_id = departmentTagId;
	if (isActive !== undefined) patch.is_active = isActive;
	if (calibrationExcluded !== undefined) patch.calibration_excluded = calibrationExcluded;

	const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
	if (error) {
		if (calibrationExcluded !== undefined && /calibration_excluded/.test(error.message)) {
			return { ok: false as const, error: 'Calibration exclusion is not set up yet (migration 0117 pending).' };
		}
		return { ok: false as const, error: explainAndLog(error, 'users.actions') };
	}

	await recordAudit({
		actor_id: user.id,
		entity_kind: 'supabase',
		entity_ref: `profiles/${userId}`,
		action: 'user.profile.update',
		diff: {
			email: target.email,
			before: {
				role: target.role,
				department_tag_id: target.department_tag_id,
				is_active: target.is_active,
				calibration_excluded: target.calibration_excluded ?? false,
			},
			after: {
				role: role ?? target.role,
				department_tag_id:
					departmentTagId === undefined ? target.department_tag_id : departmentTagId,
				is_active: isActive ?? target.is_active,
				calibration_excluded: calibrationExcluded ?? target.calibration_excluded ?? false,
			},
		},
	});

	revalidatePath('/admin/users');
	return { ok: true as const };
}
