'use server';

// Admin -> Time Study: kick off, change status, manage categories (0083).
// Admin only in code and in RLS (time_studies_* / time_study_categories_*
// policies are is_admin()).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

const PATH = '/admin/time-study';

function fail(message: string): never {
	redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

async function requireAdmin() {
	const profile = await getAuthProfile();
	if (!profile) fail('You are signed out — sign in again and retry.');
	if (profile.role !== 'admin') fail('Only an admin kicks off or edits a time study.');
	return profile;
}

const KickoffInput = z.object({
	name: z.string().trim().min(3).max(120),
	starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	day_start_hour: z.coerce.number().int().min(0).max(23),
	day_end_hour: z.coerce.number().int().min(1).max(24),
	status: z.enum(['draft', 'open']),
}).refine((v) => v.day_end_hour > v.day_start_hour, { message: 'The day must end after it starts.' });

export async function kickoffTimeStudy(formData: FormData): Promise<void> {
	const admin = await requireAdmin();
	const parsed = KickoffInput.safeParse({
		name: formData.get('name'),
		starts_on: formData.get('starts_on'),
		day_start_hour: formData.get('day_start_hour'),
		day_end_hour: formData.get('day_end_hour'),
		status: formData.get('status') ?? 'open',
	});
	if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid input.');
	const supabase = await createClient();

	if (parsed.data.status === 'open') {
		const { data: open } = await supabase.from('time_studies').select('id, name').eq('status', 'open').limit(1);
		if (open && open.length) fail(`"${open[0].name}" is still open. Move it to review or close it before opening another.`);
	}
	const { data, error } = await supabase
		.from('time_studies')
		.insert({ ...parsed.data, opened_by: admin.id })
		.select('id')
		.single();
	if (error) fail(error.message);

	// Everyone gets a bell when a study opens (0039 notifications, dedupe on study).
	if (parsed.data.status === 'open') {
		const { data: people } = await supabase.from('profiles').select('id').eq('is_active', true);
		if (people?.length) {
			await supabase.from('notifications').upsert(
				people.map((p) => ({
					user_id: p.id,
					kind: 'time_study_opened',
					title: 'Time study open',
					body: `${parsed.data.name}: two weeks from ${parsed.data.starts_on}. Fill your 10-minute grid as you go.`,
					href: '/social/time-study',
					dedupe_key: `time-study:${data.id}:opened`,
				})),
				{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
			);
		}
	}
	await recordAudit({ actor_id: admin.id, entity_kind: 'supabase', entity_ref: `time_studies/${data.id}`, action: 'time_study.kickoff', diff: parsed.data });
	revalidatePath(PATH);
	revalidatePath('/social/time-study');
	redirect(PATH);
}

export async function setTimeStudyStatus(formData: FormData): Promise<void> {
	const admin = await requireAdmin();
	const id = formData.get('id');
	const status = formData.get('status');
	if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) fail('Invalid study.');
	if (!['draft', 'open', 'review', 'closed'].includes(String(status))) fail('Invalid status.');
	const supabase = await createClient();
	if (status === 'open') {
		const { data: open } = await supabase.from('time_studies').select('id').eq('status', 'open').neq('id', id).limit(1);
		if (open && open.length) fail('Another study is already open.');
	}
	const { error } = await supabase
		.from('time_studies')
		.update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null })
		.eq('id', id);
	if (error) fail(error.message);
	await recordAudit({ actor_id: admin.id, entity_kind: 'supabase', entity_ref: `time_studies/${id}`, action: `time_study.status.${status}` });
	revalidatePath(PATH);
	revalidatePath('/social/time-study');
	redirect(PATH);
}

const CategoryInput = z.object({
	slug: z.string().regex(/^[a-z0-9_]{2,40}$/, 'Slug: lowercase letters, digits, underscores.'),
	label: z.string().trim().min(2).max(60),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal('')),
	sort: z.coerce.number().int().min(0).max(1000),
});

export async function upsertTimeStudyCategory(formData: FormData): Promise<void> {
	const admin = await requireAdmin();
	const parsed = CategoryInput.safeParse({
		slug: formData.get('slug'),
		label: formData.get('label'),
		color: formData.get('color') ?? '',
		sort: formData.get('sort') ?? 100,
	});
	if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid category.');
	const supabase = await createClient();
	const { error } = await supabase
		.from('time_study_categories')
		.upsert({ slug: parsed.data.slug, label: parsed.data.label, color: parsed.data.color || null, sort: parsed.data.sort, is_active: true }, { onConflict: 'slug' });
	if (error) fail(error.message);
	await recordAudit({ actor_id: admin.id, entity_kind: 'supabase', entity_ref: `time_study_categories/${parsed.data.slug}`, action: 'time_study.category.upsert' });
	revalidatePath(PATH);
	redirect(PATH);
}

export async function toggleTimeStudyCategory(formData: FormData): Promise<void> {
	const admin = await requireAdmin();
	const slug = formData.get('slug');
	if (typeof slug !== 'string') fail('Invalid category.');
	const supabase = await createClient();
	const { data: cur } = await supabase.from('time_study_categories').select('is_active').eq('slug', slug).maybeSingle();
	if (!cur) fail('Category not found.');
	const { error } = await supabase.from('time_study_categories').update({ is_active: !cur.is_active }).eq('slug', slug);
	if (error) fail(error.message);
	await recordAudit({ actor_id: admin.id, entity_kind: 'supabase', entity_ref: `time_study_categories/${slug}`, action: cur.is_active ? 'time_study.category.deactivate' : 'time_study.category.activate' });
	revalidatePath(PATH);
	redirect(PATH);
}
