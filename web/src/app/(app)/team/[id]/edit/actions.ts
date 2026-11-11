'use server';

// Server action for /team/[id]/edit — the only write path for people-data
// fields on `profiles` outside /admin/users.
//
// Defense layers (in order):
//   1. zod validation   — reject malformed input before touching anything
//   2. authorization    — the subject themselves, or a people-manager/exec/admin
//   3. reporting guard  — no self-manager, no cycle in the manager chain
//   4. DB enforcement   — RLS (`profiles_update_own` / `profiles_admin_all`) and
//                         the 0021 trigger, which blocks role/is_active changes
// `role` and `is_active` are deliberately NOT editable here: they stay in
// /admin/users so there is exactly one privilege-changing surface.
// Every change is recorded in audit_log (before → after, changed fields only).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { EMPLOYMENT_STATUSES } from '@/lib/people/constants';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Position is composed (0033): {department_tag_id} {position_track} {position_level}.
// The legacy free-text `title` and `department` columns are no longer editable
// here — they are preserved as-is until the unification cleanup removes them.
const ProfileInput = z.object({
	first_name: z.string().max(80).nullable(),
	last_name: z.string().max(80).nullable(),
	department_tag_id: z.string().uuid().nullable(),
	position_track: z.string().min(1).max(80).nullable(), // validated against position_tracks below
	position_level: z.preprocess(
		(v) => (v == null || v === '' ? null : Number(v)),
		z.number().int().min(1, 'Level is I, II or III').max(3, 'Level is I, II or III').nullable(),
	),
	job_role: z.string().max(160).nullable(),
	manager_id: z.string().uuid().nullable(),
	pap_position: z.string().min(1).max(80).nullable(), // validated against pap_positions (0030) below
	date_started: z.string().regex(DATE_RE, 'Use a valid date').nullable(),
	birthday: z.string().regex(DATE_RE, 'Use a valid date').nullable(),
	disc: z.string().max(40).nullable(),
	employment_status: z.enum(EMPLOYMENT_STATUSES),
	in_office: z.boolean(),
	photo_url: z.string().url('Photo URL must start with http(s)://').max(600).nullable(),
	bio_md: z.string().max(4000).nullable(),
	why_us_md: z.string().max(2000).nullable(),
});

type ProfilePatch = z.infer<typeof ProfileInput>;

const EDITABLE_KEYS = [
	'first_name',
	'last_name',
	'department_tag_id',
	'position_track',
	'position_level',
	'job_role',
	'manager_id',
	'pap_position',
	'date_started',
	'birthday',
	'disc',
	'employment_status',
	'in_office',
	'photo_url',
	'bio_md',
	'why_us_md',
] as const;

function fail(userId: string, message: string): never {
	redirect(`/team/${userId}/edit?error=${encodeURIComponent(message)}`);
}

export async function saveProfile(userId: string, formData: FormData): Promise<void> {
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();

	if (!ctx.viewerId) fail(userId, 'You are signed out — sign in again and retry.');
	if (ctx.viewerId !== userId && !canManagePeople(ctx)) {
		fail(userId, 'Only the team member, a people-manager, exec, or admin can edit this profile.');
	}

	const str = (k: string) => {
		const v = formData.get(k);
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	};

	const parsed = ProfileInput.safeParse({
		first_name: str('first_name'),
		last_name: str('last_name'),
		department_tag_id: str('department_tag_id'),
		position_track: str('position_track'),
		position_level: str('position_level'),
		job_role: str('job_role'),
		manager_id: str('manager_id'),
		pap_position: str('pap_position'),
		date_started: str('date_started'),
		birthday: str('birthday'),
		disc: str('disc'),
		employment_status: str('employment_status') ?? 'Active',
		in_office: formData.get('in_office') === 'on',
		photo_url: str('photo_url'),
		bio_md: str('bio_md'),
		why_us_md: str('why_us_md'),
	});

	if (!parsed.success) {
		const first = parsed.error.issues[0];
		fail(userId, `${first.path.join('.') || 'Form'}: ${first.message}`);
	}

	const patch: ProfilePatch = parsed.data;

	// Structure fields (department / track / level / role / manager_id /
	// pap_position) are people-manager/exec/admin only (decisions 2026-08-18/19).
	// For a self-edit by anyone else the form renders them disabled, so the
	// values arrive as null — restore the current values instead of nulling
	// them out. The DB trigger protect_profile_structure (0024, extended in
	// 0033) enforces the same rule authoritatively.
	const canEditStructure = canManagePeople(ctx);

	// Reporting guard — a profile can't manage itself, and the manager chain
	// must stay acyclic (otherwise the org chart and every rollup loops forever).
	if (canEditStructure && patch.manager_id) {
		if (patch.manager_id === userId) {
			fail(userId, "A person can't report to themselves — pick a different manager.");
		}
		let cursor: string | null = patch.manager_id;
		for (let hops = 0; cursor && hops < 25; hops++) {
			if (cursor === userId) {
				fail(userId, 'That manager already reports to this person — the chain would loop.');
			}
			const res = await supabase
				.from('profiles')
				.select('manager_id')
				.eq('id', cursor)
				.maybeSingle();
			// Explicit cast: without it TS tries to infer `up` from `cursor`,
			// which is assigned from `up` — a circular initializer (TS7022).
			const up = res.data as { manager_id: string | null } | null;
			cursor = up?.manager_id ?? null;
		}
	}

	const { data: before } = await supabase
		.from('profiles')
		.select(
			'id, email, first_name, last_name, department_tag_id, position_track, position_level, job_role, manager_id, pap_position, date_started, birthday, disc, employment_status, in_office, photo_url, bio_md, why_us_md',
		)
		.eq('id', userId)
		.maybeSingle();

	if (!before) fail(userId, 'Profile not found.');

	if (!canEditStructure) {
		const b = before as unknown as Record<string, unknown>;
		patch.department_tag_id = (b.department_tag_id as string | null) ?? null;
		patch.position_track = (b.position_track as string | null) ?? null;
		patch.position_level = (b.position_level as number | null) ?? null;
		patch.job_role = (b.job_role as string | null) ?? null;
		patch.manager_id = (b.manager_id as string | null) ?? null;
		patch.pap_position = (b.pap_position as ProfilePatch['pap_position']) ?? null;
		// Employment status is structure too — without this a contributor could
		// mark themselves Terminated/On leave from their own edit screen.
		patch.employment_status = (b.employment_status as ProfilePatch['employment_status']) ?? null;
	}

	// Positions are data (0030) — reject values that aren't in the catalog.
	if (patch.pap_position) {
		const { data: pos } = await supabase
			.from('pap_positions')
			.select('slug')
			.eq('slug', patch.pap_position)
			.maybeSingle();
		if (!pos) fail(userId, `Unknown specialty "${patch.pap_position}" — manage specialties in /admin/positions.`);
	}

	// Tracks are data too (0033) — same rule.
	if (patch.position_track) {
		const { data: track } = await supabase
			.from('position_tracks')
			.select('slug')
			.eq('slug', patch.position_track)
			.maybeSingle();
		if (!track) fail(userId, `Unknown position "${patch.position_track}" — manage positions in /admin/positions.`);
	}

	const { error } = await supabase
		.from('profiles')
		.update({ ...patch, updated_at: new Date().toISOString() })
		.eq('id', userId);

	if (error) {
		fail(
			userId,
			error.message.includes('row-level security')
				? 'The database rejected this change — you may not have permission for this profile.'
				: `Could not save: ${error.message}`,
		);
	}

	const beforeRow = before as unknown as Record<string, unknown>;
	const changed: Record<string, { before: unknown; after: unknown }> = {};
	for (const key of EDITABLE_KEYS) {
		if (beforeRow[key] !== patch[key]) {
			changed[key] = { before: beforeRow[key] ?? null, after: patch[key] };
		}
	}

	if (Object.keys(changed).length > 0) {
		await recordAudit({
			actor_id: ctx.viewerId,
			entity_kind: 'supabase',
			entity_ref: `profiles/${userId}`,
			action: 'team.profile.update',
			diff: { email: beforeRow.email, changed },
		});
	}

	revalidatePath('/team');
	revalidatePath(`/team/${userId}`);
	revalidatePath('/team/org-chart');
	redirect(`/team/${userId}`);
}
