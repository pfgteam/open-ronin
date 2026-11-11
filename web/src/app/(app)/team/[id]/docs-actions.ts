'use server';

// Server actions for the profile Documents card (public.profile_docs, 0024) —
// 4R / PAP doc links attached to a person's profile.
//
// Visibility rule (decision 2026-08-18): the person themselves, their DIRECT
// manager, people-managers, exec/admin. Writes: people-managers/exec/admin
// only. RLS enforces both; these checks just fail with a clear message.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { DOC_KINDS } from '@/lib/people/constants';

const AddInput = z.object({
	kind: z.enum(DOC_KINDS),
	title: z.string().min(1, 'Give the document a title.').max(200),
	drive_url: z.string().url('Paste a full Drive link (https://…)').max(600),
});

function fail(userId: string, message: string): never {
	// `?tab=docs` is not optional: <FormError> only renders inside the docs tab,
	// so without it a bad Drive link fails in total silence.
	redirect(`/team/${userId}?tab=docs&docsError=${encodeURIComponent(message)}`);
}

async function requirePeopleManager(userId: string) {
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) fail(userId, 'You are signed out — sign in again and retry.');
	if (!canManagePeople(ctx)) {
		fail(userId, 'Only people-managers, exec or admin can manage profile documents.');
	}
	return ctx;
}

export async function addProfileDoc(userId: string, formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager(userId);
	const supabase = await createClient();

	const parsed = AddInput.safeParse({
		kind: formData.get('kind'),
		title: ((formData.get('title') as string) ?? '').trim(),
		drive_url: ((formData.get('drive_url') as string) ?? '').trim(),
	});
	if (!parsed.success) fail(userId, parsed.error.issues[0].message);

	const { error } = await supabase.from('profile_docs').insert({
		user_id: userId,
		kind: parsed.data.kind,
		title: parsed.data.title,
		drive_url: parsed.data.drive_url,
		added_by: ctx.viewerId,
	});
	if (error) fail(userId, `Could not add: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `profile_docs/${userId}`,
		action: 'profile_doc.add',
		diff: { kind: parsed.data.kind, title: parsed.data.title },
	});

	revalidatePath(`/team/${userId}`);
	redirect(`/team/${userId}?tab=docs`);
}

export async function removeProfileDoc(userId: string, formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager(userId);
	const supabase = await createClient();

	const docId = (formData.get('doc_id') as string) ?? '';
	if (!z.string().uuid().safeParse(docId).success) fail(userId, 'Invalid document.');

	const { data: doc } = await supabase
		.from('profile_docs')
		.select('id, kind, title')
		.eq('id', docId)
		.maybeSingle();

	const { error } = await supabase.from('profile_docs').delete().eq('id', docId);
	if (error) fail(userId, `Could not remove: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `profile_docs/${userId}`,
		action: 'profile_doc.remove',
		diff: { kind: doc?.kind ?? null, title: doc?.title ?? null },
	});

	revalidatePath(`/team/${userId}`);
	redirect(`/team/${userId}?tab=docs`);
}
