'use server';

// Server actions for /admin/people-managers — the UI for public.people_managers,
// the ACL that grants access to compensation, PAP and HR notes across the team.
// Before this page existed the only way to change it was hand-written SQL.
//
// Gate: exec/admin only. A people-manager cannot expand the list that grants
// their own privilege — that stays with the account owners.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { SCOPES } from '@/lib/people/constants';

const ELEVATED: readonly string[] = ['admin', 'exec'];

const AddInput = z.object({
	userId: z.string().uuid('Pick a team member.'),
	scope: z.enum(SCOPES),
	note: z.string().max(300).nullable(),
});

function fail(message: string): never {
	redirect(`/admin/people-managers?error=${encodeURIComponent(message)}`);
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

	if (!me || !me.is_active || !ELEVATED.includes(me.role)) {
		fail('Only exec and admin accounts can change the people-manager list.');
	}
	return { supabase, actorId: user.id };
}

export async function addPeopleManager(formData: FormData): Promise<void> {
	const { supabase, actorId } = await requireAdmin();

	const raw = {
		userId: (formData.get('user_id') as string) ?? '',
		scope: ((formData.get('scope') as string) || 'all') as (typeof SCOPES)[number],
		note: ((formData.get('note') as string) ?? '').trim() || null,
	};

	const parsed = AddInput.safeParse(raw);
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const { userId, scope, note } = parsed.data;

	const { data: subject } = await supabase
		.from('profiles')
		.select('id, email, is_active')
		.eq('id', userId)
		.maybeSingle();
	if (!subject) fail('That profile no longer exists — refresh the page.');
	if (!subject.is_active) fail('That account is deactivated — reactivate it in Admin → Users first.');

	const { error } = await supabase
		.from('people_managers')
		.upsert({ user_id: userId, scope, note, added_by: actorId }, { onConflict: 'user_id' });

	if (error) fail(`Could not add: ${error.message}`);

	await recordAudit({
		actor_id: actorId,
		entity_kind: 'supabase',
		entity_ref: `people_managers/${userId}`,
		action: 'people_manager.grant',
		diff: { email: subject.email, scope, note },
	});

	revalidatePath('/admin/people-managers');
	redirect('/admin/people-managers');
}

export async function removePeopleManager(formData: FormData): Promise<void> {
	const { supabase, actorId } = await requireAdmin();

	const userId = (formData.get('user_id') as string) ?? '';
	if (!z.string().uuid().safeParse(userId).success) fail('Invalid team member.');

	const { data: subject } = await supabase
		.from('profiles')
		.select('email')
		.eq('id', userId)
		.maybeSingle();

	const { error } = await supabase.from('people_managers').delete().eq('user_id', userId);
	if (error) fail(`Could not remove: ${error.message}`);

	await recordAudit({
		actor_id: actorId,
		entity_kind: 'supabase',
		entity_ref: `people_managers/${userId}`,
		action: 'people_manager.revoke',
		diff: { email: subject?.email ?? null },
	});

	revalidatePath('/admin/people-managers');
	redirect('/admin/people-managers');
}
