'use server';

// Server actions for /admin/metrics — CRUD for the metric catalog
// (public.metric_definitions, migration 0025). This is the "manage the
// tables as data" pattern (à la Beacon's lookup tables): counting rules
// change by editing rows here, not by deploying.
//
// Gate: people-managers/exec/admin (matches the metric_definitions RLS).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { METRIC_SOURCES, BONUS_TYPES } from '@/lib/people/constants';
import { METRIC_SURFACES, isMissingColumnError } from '@/lib/metrics/surfaces';

const CreateInput = z.object({
	name: z.string().min(2, 'Give the metric a name.').max(200),
	pap_positions: z.array(z.string().min(1).max(80)).max(64),
	department_tag_id: z.string().uuid().nullable(),
	unit: z.string().max(60).nullable(),
	source: z.enum(METRIC_SOURCES),
	bonus_type: z.enum(BONUS_TYPES).nullable(),
	requires_goal: z.boolean(),
	description: z.string().max(2000).nullable(),
	// 0082: how it is calculated, where it comes from, where it surfaces.
	calc_notes: z.string().max(4000).nullable(),
	sheet_definition: z.string().max(4000).nullable(),
	sheet_source_of_truth: z.string().max(1000).nullable(),
	surfaces: z.array(z.enum(METRIC_SURFACES)).max(8),
});

function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/%/g, ' pct ')
		.replace(/[^a-zA-Z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase()
		.slice(0, 60);
}

function fail(message: string): never {
	redirect(`/admin/metrics?error=${encodeURIComponent(message)}`);
}

/** Positions are data (0030) — validate against the pap_positions catalog. */
async function assertValidPositions(
	supabase: Awaited<ReturnType<typeof createClient>>,
	slugs: string[],
): Promise<void> {
	if (slugs.length === 0) return;
	const { data } = await supabase.from('pap_positions').select('slug').in('slug', slugs);
	const known = new Set((data ?? []).map((r) => r.slug as string));
	const unknown = slugs.filter((s) => !known.has(s));
	if (unknown.length > 0) fail(`Unknown position(s): ${unknown.join(', ')} — manage them in /admin/positions.`);
}

async function requirePeopleManager() {
	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) fail('You are signed out — sign in again and retry.');
	if (!canManagePeople(ctx)) fail('Only people-managers, exec or admin can manage the metric catalog.');
	return ctx;
}

// The 0082 columns are written in a second statement so a catalog edit
// still saves everything else before that migration is applied. When the
// columns are missing the write is skipped and the page's banner says why;
// any other error is a real failure and surfaces.
async function writeSurfaceFields(
	supabase: Awaited<ReturnType<typeof createClient>>,
	key: string,
	input: { surfaces: string[]; sheet_definition: string | null; sheet_source_of_truth: string | null },
): Promise<void> {
	const { error } = await supabase
		.from('metric_definitions')
		.update({
			surfaces: input.surfaces,
			sheet_definition: input.sheet_definition,
			sheet_source_of_truth: input.sheet_source_of_truth,
		})
		.eq('key', key);
	if (error && !isMissingColumnError(error)) fail(`Saved, but could not update where it surfaces: ${error.message}`);
}

export async function createMetricDefinition(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const str = (k: string) => {
		const v = formData.get(k);
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	};

	const parsed = CreateInput.safeParse({
		name: str('name') ?? '',
		pap_positions: formData.getAll('pap_positions').filter((v) => typeof v === 'string' && v),
		department_tag_id: str('department_tag_id'),
		unit: str('unit'),
		source: str('source') ?? 'manual',
		bonus_type: str('bonus_type'),
		requires_goal: formData.get('requires_goal') === 'on',
		description: str('description'),
		calc_notes: str('calc_notes'),
		sheet_definition: str('sheet_definition'),
		sheet_source_of_truth: str('sheet_source_of_truth'),
		surfaces: formData.getAll('surfaces').filter((v) => typeof v === 'string' && v),
	});
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const input = parsed.data;
	await assertValidPositions(supabase, input.pap_positions);

	// Unique key from the name; suffix on collision.
	const base = slugify(input.name) || 'metric';
	const { data: taken } = await supabase
		.from('metric_definitions')
		.select('key')
		.like('key', `${base}%`);
	const takenSet = new Set((taken ?? []).map((r) => r.key as string));
	let key = base;
	for (let n = 2; takenSet.has(key); n += 1) key = `${base}_${n}`;

	const { data: maxSort } = await supabase
		.from('metric_definitions')
		.select('sort')
		.order('sort', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { error } = await supabase.from('metric_definitions').insert({
		key,
		name: input.name,
		pap_positions: input.pap_positions,
		department_tag_id: input.department_tag_id,
		unit: input.unit,
		source: input.source,
		bonus_type: input.bonus_type,
		requires_goal: input.requires_goal,
		description: input.description,
		calc_notes: input.calc_notes,
		sort: (maxSort?.sort ?? 0) + 10,
	});
	if (error) fail(`Could not create: ${error.message}`);
	await writeSurfaceFields(supabase, key, input);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `metric_definitions/${key}`,
		action: 'metric_definition.create',
		diff: { name: input.name, pap_positions: input.pap_positions, source: input.source },
	});

	revalidatePath('/admin/metrics');
	redirect('/admin/metrics');
}

/** Edit an existing definition — name/positions/unit/source/bonus/goal/description. */
export async function updateMetricDefinition(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const key = (formData.get('key') as string) ?? '';
	if (!key) fail('Invalid metric.');

	const str = (k: string) => {
		const v = formData.get(k);
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	};

	const parsed = CreateInput.safeParse({
		name: str('name') ?? '',
		pap_positions: formData.getAll('pap_positions').filter((v) => typeof v === 'string' && v),
		department_tag_id: str('department_tag_id'),
		unit: str('unit'),
		source: str('source') ?? 'manual',
		bonus_type: str('bonus_type'),
		requires_goal: formData.get('requires_goal') === 'on',
		description: str('description'),
		calc_notes: str('calc_notes'),
		sheet_definition: str('sheet_definition'),
		sheet_source_of_truth: str('sheet_source_of_truth'),
		surfaces: formData.getAll('surfaces').filter((v) => typeof v === 'string' && v),
	});
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const input = parsed.data;
	await assertValidPositions(supabase, input.pap_positions);

	const { error } = await supabase
		.from('metric_definitions')
		.update({
			name: input.name,
			pap_positions: input.pap_positions,
			department_tag_id: input.department_tag_id,
			unit: input.unit,
			source: input.source,
			bonus_type: input.bonus_type,
			requires_goal: input.requires_goal,
			description: input.description,
			calc_notes: input.calc_notes,
		})
		.eq('key', key);
	if (error) fail(`Could not update: ${error.message}`);
	await writeSurfaceFields(supabase, key, input);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `metric_definitions/${key}`,
		action: 'metric_definition.update',
		diff: { name: input.name, pap_positions: input.pap_positions, source: input.source },
	});

	revalidatePath('/admin/metrics');
	redirect('/admin/metrics');
}

export async function toggleMetricActive(formData: FormData): Promise<void> {
	const ctx = await requirePeopleManager();
	const supabase = await createClient();

	const key = (formData.get('key') as string) ?? '';
	if (!key) fail('Invalid metric.');

	const { data: def } = await supabase
		.from('metric_definitions')
		.select('key, name, is_active')
		.eq('key', key)
		.maybeSingle();
	if (!def) fail('Metric not found — refresh the page.');

	const { error } = await supabase
		.from('metric_definitions')
		.update({ is_active: !def.is_active })
		.eq('key', key);
	if (error) fail(`Could not update: ${error.message}`);

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `metric_definitions/${key}`,
		action: def.is_active ? 'metric_definition.deactivate' : 'metric_definition.activate',
		diff: { name: def.name },
	});

	revalidatePath('/admin/metrics');
	redirect('/admin/metrics');
}
