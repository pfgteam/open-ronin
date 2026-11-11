'use server';

// Server actions for /social/podcast (0111, Tier B #14, Elsa). The release
// gate lives in the database (CHECK + trigger with the PODCAST_RELEASE_GATE:
// prefix); these actions validate shape, pass through, and turn that prefix
// into a readable ?error=. Signed-in write (RLS), admin delete.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { EPISODE_STATUSES } from '@/lib/podcast/shared';

const PATH = '/social/podcast';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
	redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}
function done(): never {
	revalidatePath(PATH);
	redirect(PATH);
}
function readable(message: string): string {
	const i = message.indexOf('PODCAST_RELEASE_GATE:');
	if (i >= 0) return 'Release gate: ' + message.slice(i + 'PODCAST_RELEASE_GATE:'.length).trim();
	if (message.includes('podcast_episodes_release_gate')) return 'Release gate: a guest in a two-party-consent state needs a signed release before the episode can be Recorded.';
	if (message.includes('podcast_episodes') && message.includes('does not exist')) return 'Podcast episodes need migration 0111 applied first.';
	return message;
}

const EpisodeInput = z.object({
	id: z.string().uuid().optional(),
	title: z.string().trim().min(1).max(300),
	guest_name: z.string().trim().min(1).max(200),
	guest_email: z.string().trim().email().optional().or(z.literal('')),
	guest_state: z.string().trim().regex(/^[A-Za-z]{2}$/).optional().or(z.literal('')),
	release_signed: z.boolean(),
	status: z.enum(EPISODE_STATUSES).default('planned'),
	scheduled_for: z.string().regex(DATE_RE).optional().or(z.literal('')),
	notes_md: z.string().trim().max(5000).optional(),
});

export async function saveEpisode(formData: FormData): Promise<void> {
	const parsed = EpisodeInput.safeParse({
		id: formData.get('id') || undefined,
		title: formData.get('title'),
		guest_name: formData.get('guest_name'),
		guest_email: formData.get('guest_email') || '',
		guest_state: formData.get('guest_state') || '',
		release_signed: formData.get('release_signed') === 'on',
		status: formData.get('status') || 'planned',
		scheduled_for: formData.get('scheduled_for') || '',
		notes_md: formData.get('notes_md') || undefined,
	});
	if (!parsed.success) fail(String(parsed.error.issues[0]?.message ?? 'Invalid input.'));
	const v = parsed.data;

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail('Not signed in.');

	const row = {
		title: v.title,
		guest_name: v.guest_name,
		guest_email: v.guest_email || null,
		guest_state: v.guest_state ? v.guest_state.toUpperCase() : null,
		release_signed: v.release_signed,
		status: v.status,
		scheduled_for: v.scheduled_for || null,
		notes_md: v.notes_md ?? null,
	};

	if (v.id) {
		const { data, error } = await supabase.from('podcast_episodes').update(row).eq('id', v.id).select('id');
		if (error) fail(readable(error.message));
		if (!data || data.length === 0) fail('Nothing was saved.');
		await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `podcast_episodes/${v.id}`, action: 'podcast.episode.update', diff: row });
	} else {
		const { data, error } = await supabase.from('podcast_episodes').insert({ ...row, created_by: auth.user.id }).select('id').single();
		if (error) fail(readable(error.message));
		await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `podcast_episodes/${data.id}`, action: 'podcast.episode.create', diff: row });
	}
	done();
}

const StatusInput = z.object({ id: z.string().uuid(), status: z.enum(EPISODE_STATUSES) });

export async function setEpisodeStatus(formData: FormData): Promise<void> {
	const parsed = StatusInput.safeParse({ id: formData.get('id'), status: formData.get('status') });
	if (!parsed.success) fail('Invalid status change.');
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail('Not signed in.');
	const { data, error } = await supabase.from('podcast_episodes').update({ status: parsed.data.status }).eq('id', parsed.data.id).select('id');
	if (error) fail(readable(error.message));
	if (!data || data.length === 0) fail('Nothing was changed.');
	await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `podcast_episodes/${parsed.data.id}`, action: 'podcast.episode.status', diff: { status: parsed.data.status } });
	done();
}

export async function setReleaseSigned(formData: FormData): Promise<void> {
	const id = formData.get('id');
	const signed = formData.get('signed') === 'true';
	if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('Invalid episode.');
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail('Not signed in.');
	const { data, error } = await supabase.from('podcast_episodes').update({ release_signed: signed }).eq('id', id).select('id');
	if (error) fail(readable(error.message));
	if (!data || data.length === 0) fail('Nothing was changed.');
	await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `podcast_episodes/${id}`, action: signed ? 'podcast.release.signed' : 'podcast.release.unsigned' });
	done();
}
