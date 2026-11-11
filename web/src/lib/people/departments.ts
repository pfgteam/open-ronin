// Department lookup — the canon department of a person.
//
// Departments are rows in `tags` (category 'department'), and a profile
// points at one through `department_tag_id` (0033). The old free-text
// `profiles.department` column was retired in 0089: it carried a CHECK
// pinned to a stale vocabulary (Media / Lead Gen / Dev / Sales) that
// disagreed with the tag labels (Delivery / Revenue / Beacon / Social
// Media), so writing a real label to it raised 23514.
//
// Every surface that used to read that text now resolves the label here.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Label shown when a profile has no department set. */
export const NO_DEPARTMENT = 'Unassigned';

export interface DepartmentTag {
	id: string;
	label: string;
	/** The org this department belongs to (0084), when assigned. */
	parent_tag_id: string | null;
}

/**
 * Departments in canon order (/admin/tags position).
 *
 * Takes any Supabase client so server components, server actions and route
 * handlers can all share it.
 */
export async function loadDepartments(
	supabase: SupabaseClient,
): Promise<DepartmentTag[]> {
	const { data } = await supabase
		.from('tags')
		.select('id, label, parent_tag_id')
		.eq('category', 'department')
		.order('position');
	return (data ?? []) as DepartmentTag[];
}

/** id -> label, for resolving a profile's department_tag_id. */
export function departmentLabelById(rows: DepartmentTag[]): Map<string, string> {
	return new Map(rows.map((d) => [d.id, d.label]));
}

/**
 * The department label for one profile. Returns null when unset so callers
 * decide between NO_DEPARTMENT, an em dash, or hiding the row — the old
 * free-text reads were inconsistent about this and this keeps the choice at
 * the call site.
 */
export function departmentOf(
	profile: { department_tag_id?: string | null },
	labels: Map<string, string>,
): string | null {
	const id = profile.department_tag_id;
	if (!id) return null;
	return labels.get(id) ?? null;
}
