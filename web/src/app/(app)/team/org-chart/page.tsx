// /team/org-chart - Live org chart.
//
// Two data sources, with a toggle:
//   (1) Supabase profiles via manager_id chain (canonical once profiles are
//       backfilled).
//   (2) The "Open Ronin Master Org Chart" graph_documents seed from Lucidchart
//       (supabase/seeds/0006_seed_org_chart_master.sql).
//
// The page picks the source with the most nodes by default. The toggle stays
// useful while the team is mid-migration.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import OrgChartView, { type StructureTag } from './OrgChartView';
import { Upload, BookOpen } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ProfileLite {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	title: string | null;
	department_tag_id: string | null;
	avatar_url: string | null;
	photo_url: string | null;
	manager_id: string | null;
	employment_status: string | null;
	is_active: boolean;
}

interface GraphNodeRow {
	id: string;
	parent_node_id: string | null;
	label: string | null;
	notes_md: string | null;
	user_id: string | null;
}

export default async function OrgChartPage() {
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const canImport = canManagePeople(ctx);

	const [profilesRes, masterDocRes, structureRes] = await Promise.all([
		supabase
			.from('profiles')
			.select('id, first_name, last_name, email, title, department_tag_id, avatar_url, photo_url, manager_id, employment_status, is_active')
			.eq('is_active', true),
		supabase
			.from('graph_documents')
			.select('id, name')
			.eq('kind', 'org_chart')
			.eq('name', 'Open Ronin Master Org Chart')
			.maybeSingle(),
		// Org -> Department -> Sub-team (tags; org level from 0084)
		supabase
			.from('tags')
			.select('id, slug, label, color, category, parent_tag_id, position')
			.in('category', ['org', 'department', 'sub_team'])
			.order('position'),
	]);

	const profileRows = (profilesRes.data ?? []) as ProfileLite[];
	const structure = (structureRes.data ?? []) as StructureTag[];
	// OrgChartView groups by a department NAME. profiles.department was
	// retired in 0089, so resolve the label from the tags already loaded here
	// and hand the view the shape it expects.
	const deptLabelById = new Map(
		structure.filter((t) => t.category === 'department').map((t) => [t.id, t.label]),
	);
	const profilesForView = profileRows.map((p) => ({
		id: p.id,
		first_name: p.first_name,
		last_name: p.last_name,
		email: p.email,
		title: p.title,
		department: p.department_tag_id ? (deptLabelById.get(p.department_tag_id) ?? null) : null,
		avatar_url: p.avatar_url,
		photo_url: p.photo_url,
		manager_id: p.manager_id,
	}));
	const orgCount = structure.filter((t) => t.category === 'org').length;

	let masterNodes: GraphNodeRow[] = [];
	if (masterDocRes.data?.id) {
		const { data: nodes } = await supabase
			.from('graph_nodes')
			.select('id, parent_node_id, label, notes_md, user_id')
			.eq('document_id', masterDocRes.data.id);
		masterNodes = (nodes ?? []) as GraphNodeRow[];
	}

	const profilesWithManager = profileRows.filter((p) => p.manager_id).length;
	const masterCount = masterNodes.length;

	return (
		<>
			<PageHeader
				title="Org Chart"
				description={
					<>
						{profilesWithManager > 0 && `${profilesWithManager} of ${profileRows.length} people have a manager assigned`}
						{profilesWithManager > 0 && masterCount > 0 && ' · '}
						{masterCount > 0 && `Master CSV seed: ${masterCount} nodes`}
						{orgCount > 0 ? ` · ${orgCount} orgs` : ' · org level not set up yet'}
					</>
				}
				actions={
					canImport ? (
						<Link href="/team/org-chart/import">
							<button className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs hover:bg-hover transition-colors">
								<Upload className="w-3 h-3" /> Import CSV
							</button>
						</Link>
					) : null
				}
			/>

			{profileRows.length === 0 && masterCount === 0 ? (
				<Card>
					<div className="text-center py-12">
						<BookOpen className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
						<p className="text-sm text-slate-500">No org chart data yet.</p>
						<p className="text-xs text-slate-400 mt-1">
							The org chart seed hasn&apos;t been loaded yet. Ask Ops to import it.
						</p>
					</div>
				</Card>
			) : (
				<OrgChartView
					profiles={profilesForView}
					structure={structure}
					masterNodes={masterNodes}
					defaultSource={orgCount > 0 ? 'structure' : profilesWithManager >= masterCount ? 'profiles' : 'master'}
				/>
			)}
		</>
	);
}
