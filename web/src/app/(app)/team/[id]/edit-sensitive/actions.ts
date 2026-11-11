'use server';

// Server action for /team/[id]/edit-sensitive — writes public.profile_sensitive
// (compensation structure + PAP tracking + HR notes).
//
// Defense layers:
//   1. zod validation
//   2. authorization — canManagePeople only (people_managers / exec / admin);
//      the subject can READ their own row but cannot edit it
//   3. DB enforcement — RLS policy `ps_write` on profile_sensitive
//
// Audit note: the diff records WHICH fields changed, never their values —
// compensation and HR notes must not be duplicated into audit_log.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { PAY_STRUCTURES, REVIEW_CYCLES, PAP_STATUSES, CURRENCIES } from '@/lib/people/constants';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SensitiveInput = z.object({
	comp_base_cents: z.number().int().min(0).max(100_000_000).nullable(),
	comp_currency: z.enum(CURRENCIES),
	pay_structure: z.enum(PAY_STRUCTURES).nullable(),
	comp_review_cycle: z.enum(REVIEW_CYCLES).nullable(),
	comp_next_review_on: z.string().regex(DATE_RE, 'Use a valid date').nullable(),
	pap_status: z.enum(PAP_STATUSES),
	pap_started_on: z.string().regex(DATE_RE, 'Use a valid date').nullable(),
	pap_ends_on: z.string().regex(DATE_RE, 'Use a valid date').nullable(),
	pap_doc_url: z.string().url('PAP doc must be a full URL').max(600).nullable(),
	pap_owner_id: z.string().uuid().nullable(),
	gusto_employee_id: z.string().max(60).nullable(),
	emergency_contact_md: z.string().max(2000).nullable(),
	notes_md: z.string().max(8000).nullable(),
});

type SensitivePatch = z.infer<typeof SensitiveInput>;

function fail(userId: string, message: string): never {
	redirect(`/team/${userId}/edit-sensitive?error=${encodeURIComponent(message)}`);
}

export async function saveSensitive(userId: string, formData: FormData): Promise<void> {
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();

	if (!ctx.viewerId) fail(userId, 'You are signed out — sign in again and retry.');
	if (!canManagePeople(ctx)) {
		fail(userId, 'Compensation and PAP are editable by people-managers, exec, and admin only.');
	}

	const str = (k: string) => {
		const v = formData.get(k);
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	};

	// Base pay is typed in whole currency units and stored in cents.
	const rawBase = str('comp_base');
	let baseCents: number | null = null;
	if (rawBase !== null) {
		const cleaned = Number(rawBase.replace(/[^0-9.]/g, ''));
		if (!Number.isFinite(cleaned)) {
			fail(userId, 'Base pay must be a number (no currency symbols needed).');
		}
		baseCents = Math.round(cleaned * 100);
	}

	const parsed = SensitiveInput.safeParse({
		comp_base_cents: baseCents,
		comp_currency: str('comp_currency') ?? 'USD',
		pay_structure: str('pay_structure'),
		comp_review_cycle: str('comp_review_cycle'),
		comp_next_review_on: str('comp_next_review_on'),
		pap_status: str('pap_status') ?? 'not_on_pap',
		pap_started_on: str('pap_started_on'),
		pap_ends_on: str('pap_ends_on'),
		pap_doc_url: str('pap_doc_url'),
		pap_owner_id: str('pap_owner_id'),
		gusto_employee_id: str('gusto_employee_id'),
		emergency_contact_md: str('emergency_contact_md'),
		notes_md: str('notes_md'),
	});

	if (!parsed.success) {
		const first = parsed.error.issues[0];
		fail(userId, `${first.path.join('.') || 'Form'}: ${first.message}`);
	}

	const patch: SensitivePatch = parsed.data;

	if (patch.pap_status !== 'not_on_pap' && !patch.pap_started_on) {
		fail(userId, 'A PAP that is not "not_on_pap" needs a start date.');
	}
	if (patch.pap_ends_on && patch.pap_started_on && patch.pap_ends_on < patch.pap_started_on) {
		fail(userId, 'The PAP end date is before its start date.');
	}

	const { data: subject } = await supabase
		.from('profiles')
		.select('id, email')
		.eq('id', userId)
		.maybeSingle();
	if (!subject) fail(userId, 'Profile not found.');

	const { data: beforeRow } = await supabase
		.from('profile_sensitive')
		.select('*')
		.eq('user_id', userId)
		.maybeSingle();

	const { error } = await supabase
		.from('profile_sensitive')
		.upsert(
			{ user_id: userId, ...patch, updated_at: new Date().toISOString() },
			{ onConflict: 'user_id' },
		);

	if (error) {
		fail(
			userId,
			error.message.includes('row-level security')
				? 'The database rejected this write — your account is not in the people-manager list.'
				: `Could not save: ${error.message}`,
		);
	}

	const before = (beforeRow ?? {}) as Record<string, unknown>;
	const changedFields = (Object.keys(patch) as (keyof SensitivePatch)[]).filter(
		(k) => (before[k] ?? null) !== patch[k],
	);

	if (changedFields.length > 0) {
		await recordAudit({
			actor_id: ctx.viewerId,
			entity_kind: 'supabase',
			entity_ref: `profile_sensitive/${userId}`,
			action: 'team.sensitive.update',
			// Field names only — never the values.
			diff: { subject_email: subject.email, changed_fields: changedFields, created: !beforeRow },
		});
	}

	revalidatePath(`/team/${userId}`);
	revalidatePath('/team/pap');
	redirect(`/team/${userId}?tab=pap`);
}
