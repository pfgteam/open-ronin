// /admin/tags — Manage the department / sub-team taxonomy used across The
// Work (department_tag_id / sub_team_tag_id on projects) and as generic
// work-item tags. See actions.ts for why this page exists.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import TagsAdminView from './TagsAdminView';

export const dynamic = 'force-dynamic';

export default async function TagsAdminPage() {
	const supabase = await createClient();

	const [{ data: tags }, { data: deptUsageRows }, { data: subUsageRows }, { data: tagUsageRows }] = await Promise.all([
		supabase
			.from('tags')
			.select('id, slug, label, color, category, parent_tag_id, is_system, position')
			.in('category', ['org', 'department', 'sub_team'])
			.order('position'),
		supabase.from('projects').select('department_tag_id').eq('archived', false).not('department_tag_id', 'is', null),
		supabase.from('projects').select('sub_team_tag_id').eq('archived', false).not('sub_team_tag_id', 'is', null),
		supabase.from('work_item_tags').select('tag_id'),
	]);

	const usage = new Map<string, number>();
	for (const row of deptUsageRows ?? []) {
		if (row.department_tag_id) usage.set(row.department_tag_id, (usage.get(row.department_tag_id) ?? 0) + 1);
	}
	for (const row of subUsageRows ?? []) {
		if (row.sub_team_tag_id) usage.set(row.sub_team_tag_id, (usage.get(row.sub_team_tag_id) ?? 0) + 1);
	}
	for (const row of tagUsageRows ?? []) {
		if (row.tag_id) usage.set(row.tag_id, (usage.get(row.tag_id) ?? 0) + 1);
	}

	const allTags = tags ?? [];
	const orgs = allTags.filter((t) => t.category === 'org');
	const departments = allTags.filter((t) => t.category === 'department');
	const subTeams = allTags.filter((t) => t.category === 'sub_team');

	return (
		<>
			<div className="space-y-4">
				<PageHeader
					flush
					title={<>Org, Departments &amp; Sub-Teams</>}
					description={orgs.length > 0 ? "Three levels: Org (Open Ronin, Beacon, Premium) → Department → Sub-team. Set each department's org with the picker on its card; departments with no org show amber until assigned. Renaming keeps the slug — only the label changes." : "Powers the Department / Sub-Department fields and filters across The Work. The Org level (Open Ronin, Beacon, Premium) appears once Ops enables it. Renaming keeps the slug — only the label changes."}
				/>

				{allTags.length === 0 ? (
					<Card>
						<div className="text-center py-10 text-sm text-slate-500">No departments yet.</div>
					</Card>
				) : (
					<TagsAdminView
						orgs={orgs}
						departments={departments}
						subTeams={subTeams}
						usage={Object.fromEntries(usage)}
					/>
				)}
			</div>
		</>
	);
}
