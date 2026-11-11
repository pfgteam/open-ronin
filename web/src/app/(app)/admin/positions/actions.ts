'use server';

// Server actions for /admin/positions — CRUD for the two catalogs on that
// screen (terminology fixed 19/08/2026, migration 0034):
//   SPECIALTIES (public.pap_positions) — Media, Publicist, Content…; each
//     lives inside a department OR sub-team (tags row), assigned manually,
//     never derived. Links a person to their metric set.
//   POSITIONS (public.position_tracks) — the PAP progression: Assistant,
//     Analyst, Specialist, Coordinator, Manager. Not linked to departments.
// Both are data, like metric definitions and tags.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

const Input = z.object({
	label: z.string().min(2, 'Give the position a name.').max(80),
	tag_id: z.string().uuid().nullable(),
});

function fail(message: string): never {
	redirect(`/admin/positions?error=${encodeURIComponent(message)}`);
}

async function requirePeopleManager() {
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) fail('You are signed out — sign in again and retry.');
	if (!canManagePeople(ctx)) fail('Only people-managers, exec or admin can manage positions.');
	return ctx;
}

function str(formData: FormData, k: string): string | null {
	const v = formData.get(k);
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function createPapPosition(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const parsed = Input.safeParse({ label: str(formData, 'label') ?? '', tag_id: str(formData, 'tag_id') });
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const input = parsed.data;

	// Slug = the label at creation time; immutable afterwards (it's the value
	// stored in profiles.pap_position / metric_definitions.pap_positions).
	const slug = input.label;

	const { data: maxSort } = await supabase
		.from('pap_positions')
		.select('sort')
		.order('sort', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { error } = await supabase.from('pap_positions').insert({
		slug,
		label: input.label,
		tag_id: input.tag_id,
		sort: (maxSort?.sort ?? 0) + 10,
	});
	if (error) fail(`Could not create: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `pap_positions/${slug}`,
		action: 'pap_position.create',
		diff: { label: input.label, tag_id: input.tag_id },
	});

	revalidatePath('/admin/positions');
	redirect('/admin/positions');
}

export async function updatePapPosition(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const slug = str(formData, 'slug');
	if (!slug) fail('Invalid position.');

	const parsed = Input.safeParse({ label: str(formData, 'label') ?? '', tag_id: str(formData, 'tag_id') });
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const input = parsed.data;

	const { error } = await supabase
		.from('pap_positions')
		.update({ label: input.label, tag_id: input.tag_id })
		.eq('slug', slug);
	if (error) fail(`Could not update: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `pap_positions/${slug}`,
		action: 'pap_position.update',
		diff: { label: input.label, tag_id: input.tag_id },
	});

	revalidatePath('/admin/positions');
	redirect('/admin/positions');
}

// --- Position tracks (0033) ---------------------------------------------
// The track component of the composed position: {department} {track} {level}.
// Same data-not-code rule as pap_positions: slug immutable, label editable.

const TrackInput = z.object({
	label: z.string().min(2, 'Give the track a name.').max(60),
});

export async function createPositionTrack(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const parsed = TrackInput.safeParse({ label: str(formData, 'label') ?? '' });
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const slug = parsed.data.label;

	const { data: maxSort } = await supabase
		.from('position_tracks')
		.select('sort')
		.order('sort', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { error } = await supabase.from('position_tracks').insert({
		slug,
		label: parsed.data.label,
		sort: (maxSort?.sort ?? 0) + 10,
	});
	if (error) fail(`Could not create track: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `position_tracks/${slug}`,
		action: 'position_track.create',
		diff: { label: parsed.data.label },
	});

	revalidatePath('/admin/positions');
	redirect('/admin/positions');
}

export async function updatePositionTrack(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const slug = str(formData, 'slug');
	if (!slug) fail('Invalid track.');

	const parsed = TrackInput.safeParse({ label: str(formData, 'label') ?? '' });
	if (!parsed.success) fail(parsed.error.issues[0].message);

	const { error } = await supabase
		.from('position_tracks')
		.update({ label: parsed.data.label })
		.eq('slug', slug);
	if (error) fail(`Could not update track: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `position_tracks/${slug}`,
		action: 'position_track.update',
		diff: { label: parsed.data.label },
	});

	revalidatePath('/admin/positions');
	redirect('/admin/positions');
}

export async function togglePositionTrackActive(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const slug = str(formData, 'slug');
	if (!slug) fail('Invalid track.');

	const { data: row } = await supabase
		.from('position_tracks')
		.select('slug, is_active')
		.eq('slug', slug)
		.maybeSingle();
	if (!row) fail('Track not found — refresh the page.');

	const { error } = await supabase
		.from('position_tracks')
		.update({ is_active: !row.is_active })
		.eq('slug', slug);
	if (error) fail(`Could not update track: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `position_tracks/${slug}`,
		action: row.is_active ? 'position_track.deactivate' : 'position_track.activate',
	});

	revalidatePath('/admin/positions');
	redirect('/admin/positions');
}

export async function togglePapPositionActive(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const slug = str(formData, 'slug');
	if (!slug) fail('Invalid position.');

	const { data: row } = await supabase
		.from('pap_positions')
		.select('slug, is_active')
		.eq('slug', slug)
		.maybeSingle();
	if (!row) fail('Position not found — refresh the page.');

	const { error } = await supabase
		.from('pap_positions')
		.update({ is_active: !row.is_active })
		.eq('slug', slug);
	if (error) fail(`Could not update: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `pap_positions/${slug}`,
		action: row.is_active ? 'pap_position.deactivate' : 'pap_position.activate',
	});

	revalidatePath('/admin/positions');
	redirect('/admin/positions');
}
