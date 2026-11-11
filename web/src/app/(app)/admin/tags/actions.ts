'use server';

// Server actions for /admin/tags — CRUD + re-parent for the department /
// sub-team taxonomy that lives in public.tags.
//
// Why this page exists: the whole taxonomy was seeded once in migration
// 0009 as a best-guess ("re-parent in /admin if any are wrong" — Alex's
// own comment), with zero admin UI ever built to actually do that. Toni
// found it wrong in practice (missing Social Media, wrong Delivery
// sub-teams) and it took a migration + a Slack thread to fix. This page
// means the next correction is a form, not a deploy.

import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { explainAndLog } from '@/lib/errors';

// 0024 hardening: these actions previously had NO auth check in code and
// relied on RLS alone. Taxonomy writes are admin work — verify in the action
// too, so a rejected call fails with a clear message instead of an RLS error.
async function requireAdmin(): Promise<string | null> {
	const viewer = await getAuthProfile();
	if (!viewer || !viewer.is_active || !['admin', 'exec'].includes(viewer.role)) {
		return 'Only exec and admin accounts can change the taxonomy.';
	}
	return null;
}

function slugify(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

async function uniqueSlug(base: string, existing: Set<string>): Promise<string> {
	let slug = base || 'tag';
	let n = 2;
	while (existing.has(slug)) {
		slug = `${base}-${n}`;
		n += 1;
	}
	return slug;
}

async function existingSlugs(): Promise<Set<string>> {
	const supabase = await createClient();
	const { data } = await supabase.from('tags').select('slug');
	return new Set((data ?? []).map((t) => t.slug));
}

export async function createDepartment(label: string) {
	const denied = await requireAdmin();
	if (denied) return { ok: false as const, error: denied };

	const trimmed = label.trim();
	if (!trimmed) return { ok: false as const, error: 'Name is required.' };

	const supabase = await createClient();
	const slug = await uniqueSlug(slugify(trimmed), await existingSlugs());
	const { data: maxPos } = await supabase
		.from('tags')
		.select('position')
		.eq('category', 'department')
		.order('position', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { error } = await supabase.from('tags').insert({
		slug,
		label: trimmed,
		category: 'department',
		is_system: false,
		position: (maxPos?.position ?? 0) + 10,
	});
	if (error) return { ok: false as const, error: explainAndLog(error, 'tags.actions') };
	revalidatePath('/admin/tags');
	return { ok: true as const };
}

export async function createSubTeam(label: string, parentId: string) {
	const denied = await requireAdmin();
	if (denied) return { ok: false as const, error: denied };

	const trimmed = label.trim();
	if (!trimmed) return { ok: false as const, error: 'Name is required.' };
	if (!parentId) return { ok: false as const, error: 'Pick a department first.' };

	const supabase = await createClient();
	const slug = await uniqueSlug(slugify(trimmed), await existingSlugs());
	const { data: maxPos } = await supabase
		.from('tags')
		.select('position')
		.eq('parent_tag_id', parentId)
		.order('position', { ascending: false })
		.limit(1)
		.maybeSingle();

	const { error } = await supabase.from('tags').insert({
		slug,
		label: trimmed,
		category: 'sub_team',
		parent_tag_id: parentId,
		is_system: false,
		position: (maxPos?.position ?? 0) + 10,
	});
	if (error) return { ok: false as const, error: explainAndLog(error, 'tags.actions') };
	revalidatePath('/admin/tags');
	return { ok: true as const };
}

export async function renameTag(id: string, label: string) {
	const denied = await requireAdmin();
	if (denied) return { ok: false as const, error: denied };

	const trimmed = label.trim();
	if (!trimmed) return { ok: false as const, error: 'Name is required.' };

	const supabase = await createClient();
	// Slug stays put on rename — work_item filters + saved links reference
	// slug (e.g. ?tag=copywriting), and changing it on every relabel would
	// silently break those. Only label (what people read) updates.
	const { error } = await supabase.from('tags').update({ label: trimmed }).eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'tags.actions') };
	revalidatePath('/admin/tags');
	return { ok: true as const };
}

export async function reparentSubTeam(id: string, newParentId: string) {
	const denied = await requireAdmin();
	if (denied) return { ok: false as const, error: denied };

	if (!newParentId) return { ok: false as const, error: 'Pick a department.' };
	const supabase = await createClient();
	const { error } = await supabase
		.from('tags')
		.update({ parent_tag_id: newParentId })
		.eq('id', id)
		.eq('category', 'sub_team');
	if (error) return { ok: false as const, error: explainAndLog(error, 'tags.actions') };
	revalidatePath('/admin/tags');
	return { ok: true as const };
}

/**
 * Org level (0084): assign a department to one of the orgs (Open Ronin, Beacon,
 * Premium) or clear it. Which department belongs where is Alex's call; this
 * is the control he uses to make it, so nothing is backfilled by code.
 */
export async function setDepartmentOrg(id: string, orgId: string | null) {
	const denied = await requireAdmin();
	if (denied) return { ok: false as const, error: denied };
	const supabase = await createClient();
	if (orgId) {
		const { data: org } = await supabase.from('tags').select('id').eq('id', orgId).eq('category', 'org').maybeSingle();
		if (!org) return { ok: false as const, error: 'Unknown org.' };
	}
	const { error } = await supabase
		.from('tags')
		.update({ parent_tag_id: orgId })
		.eq('id', id)
		.eq('category', 'department');
	if (error) return { ok: false as const, error: explainAndLog(error, 'tags.actions') };
	revalidatePath('/admin/tags');
	revalidatePath('/team/org-chart');
	return { ok: true as const };
}

export async function deleteTag(id: string) {
	const denied = await requireAdmin();
	if (denied) return { ok: false as const, error: denied };

	const supabase = await createClient();

	const { data: tag } = await supabase.from('tags').select('id, category, is_system').eq('id', id).single();
	if (!tag) return { ok: false as const, error: 'Tag not found.' };

	if (tag.category === 'department') {
		const { count } = await supabase
			.from('tags')
			.select('id', { count: 'exact', head: true })
			.eq('parent_tag_id', id);
		if ((count ?? 0) > 0) {
			return { ok: false as const, error: 'This department still has sub-departments under it — move or delete those first.' };
		}
	}

	const [{ count: deptUse }, { count: subUse }, { count: tagUse }] = await Promise.all([
		supabase.from('projects').select('id', { count: 'exact', head: true }).eq('department_tag_id', id),
		supabase.from('projects').select('id', { count: 'exact', head: true }).eq('sub_team_tag_id', id),
		supabase.from('work_item_tags').select('work_item_id', { count: 'exact', head: true }).eq('tag_id', id),
	]);
	const usageCount = (deptUse ?? 0) + (subUse ?? 0) + (tagUse ?? 0);
	if (usageCount > 0) {
		return { ok: false as const, error: `In use by ${usageCount} work item${usageCount === 1 ? '' : 's'} — re-parent them first, or leave this tag and rename it instead of deleting.` };
	}

	const { error } = await supabase.from('tags').delete().eq('id', id);
	if (error) return { ok: false as const, error: explainAndLog(error, 'tags.actions') };
	revalidatePath('/admin/tags');
	return { ok: true as const };
}
