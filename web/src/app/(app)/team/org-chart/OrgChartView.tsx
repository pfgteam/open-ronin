'use client';

// Org chart client component - supports two data sources:
//   - "profiles": Supabase profiles wired via manager_id
//   - "master":   The Open Ronin Master Org Chart graph_document (seeded from
//                 Lucidchart export, 86 nodes)
//
// Click a node: if it's bound to a profile (user_id), open /team/[id];
// otherwise stay on the page (or open an edit modal in a future iteration).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import GraphCanvas, { type GraphNode } from '@/components/graph/GraphCanvas';
import Card from '@/components/ui/Card';
import { Search, Users, FileSpreadsheet, Network } from 'lucide-react';

interface ProfileLite {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	title: string | null;
	department: string | null;
	avatar_url: string | null;
	photo_url: string | null;
	manager_id: string | null;
}

export interface StructureTag {
	id: string;
	slug: string;
	label: string;
	color: string | null;
	category: string | null;
	parent_tag_id: string | null;
	position: number;
}

interface MasterNode {
	id: string;
	parent_node_id: string | null;
	label: string | null;
	notes_md: string | null;
	user_id: string | null;
}

interface Props {
	profiles: ProfileLite[];
	/** Org -> Department -> Sub-team tags (0084). Orgs are empty until applied. */
	structure: StructureTag[];
	masterNodes: MasterNode[];
	defaultSource: 'profiles' | 'master' | 'structure';
}

type Source = 'profiles' | 'master' | 'structure';

export default function OrgChartView({ profiles, structure, masterNodes, defaultSource }: Props) {
	const router = useRouter();
	const [source, setSource] = useState<Source>(defaultSource);
	const [search, setSearch] = useState('');
	const [deptFilter, setDeptFilter] = useState<string>('');

	const departments = useMemo(() => {
		if (source !== 'profiles') return [];
		const set = new Set<string>();
		for (const p of profiles) if (p.department) set.add(p.department);
		return Array.from(set).sort();
	}, [profiles, source]);

	const allNodes: GraphNode[] = useMemo(() => {
		if (source === 'structure') {
			// Org -> Department -> Sub-team from tags (0084). Departments with no
			// org hang off a synthetic "Org not set" node so nothing disappears
			// before Alex assigns them on Admin -> Org, Departments & Sub-Teams.
			// Each department shows how many active profiles it has.
			const headcount = new Map<string, number>();
			for (const p of profiles) if (p.department) headcount.set(p.department, (headcount.get(p.department) ?? 0) + 1);
			const orgs = structure.filter((t) => t.category === 'org');
			const depts = structure.filter((t) => t.category === 'department');
			const subs = structure.filter((t) => t.category === 'sub_team');
			const nodes: GraphNode[] = [];
			const orgIds = new Set(orgs.map((o) => o.id));
			const unassigned = depts.some((d) => !d.parent_tag_id || !orgIds.has(d.parent_tag_id));
			for (const o of orgs) nodes.push({ id: o.id, parentId: null, label: o.label, subtitle: 'Org' });
			if (unassigned) nodes.push({ id: '__unassigned_org', parentId: null, label: orgs.length ? 'Org not set' : 'All departments', subtitle: orgs.length ? 'assign on Admin' : 'org level arrives with 0084' });
			for (const d of depts) {
				const n = headcount.get(d.label) ?? 0;
				nodes.push({
					id: d.id,
					parentId: d.parent_tag_id && orgIds.has(d.parent_tag_id) ? d.parent_tag_id : '__unassigned_org',
					label: d.label,
					subtitle: `Department · ${n} ${n === 1 ? 'person' : 'people'}`,
				});
			}
			for (const s of subs) nodes.push({ id: s.id, parentId: s.parent_tag_id, label: s.label, subtitle: 'Sub-team' });
			return nodes;
		}
		if (source === 'profiles') {
			return profiles.map<GraphNode>((p) => ({
				id: p.id,
				parentId: p.manager_id,
				label: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email,
				subtitle: p.title ?? p.department ?? null,
				avatarUrl: p.photo_url ?? p.avatar_url ?? null,
				href: `/team/${p.id}`,
			}));
		}
		// Master graph_documents source
		return masterNodes.map<GraphNode>((n) => {
			const role = parseRoleFromNotes(n.notes_md);
			return {
				id: n.id,
				parentId: n.parent_node_id,
				label: n.label ?? '(Unnamed)',
				subtitle: role,
				meta: { user_id: n.user_id ?? undefined },
			};
		});
	}, [source, profiles, masterNodes, structure]);

	const filteredNodes = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term && !deptFilter) return allNodes;

		const matched = new Set<string>();
		for (const n of allNodes) {
			const matchSearch = !term || n.label.toLowerCase().includes(term) || (n.subtitle ?? '').toLowerCase().includes(term);
			const matchDept = !deptFilter || (n.subtitle ?? '').includes(deptFilter);
			if (matchSearch && matchDept) matched.add(n.id);
		}
		// Include ancestors of matches
		const byId = new Map(allNodes.map((n) => [n.id, n]));
		for (const id of Array.from(matched)) {
			let cur = byId.get(id);
			while (cur && cur.parentId) {
				matched.add(cur.parentId);
				cur = byId.get(cur.parentId);
			}
		}
		return allNodes.filter((n) => matched.has(n.id));
	}, [allNodes, search, deptFilter]);

	function onSelectNode(id: string) {
		if (source === 'profiles') {
			router.push(`/team/${id}`);
		} else if (source === 'structure') {
			// A department opens the directory (grouped by department); orgs and
			// sub-teams are structure only.
			const tag = structure.find((t) => t.id === id);
			if (tag?.category === 'department') router.push('/team');
		} else {
			const match = masterNodes.find((n) => n.id === id);
			if (match?.user_id) router.push(`/team/${match.user_id}`);
		}
	}

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-md">
					<button
						onClick={() => setSource('structure')}
						className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							source === 'structure'
								? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
								: 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
						}`}
						disabled={structure.length === 0}
						title="Org → Department → Sub-team"
					>
						<Network className="w-3 h-3" /> Structure
					</button>
					<button
						onClick={() => setSource('profiles')}
						className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							source === 'profiles'
								? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
								: 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
						}`}
						disabled={profiles.length === 0}
					>
						<Users className="w-3 h-3" /> Profiles ({profiles.length})
					</button>
					<button
						onClick={() => setSource('master')}
						className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							source === 'master'
								? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
								: 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
						}`}
						disabled={masterNodes.length === 0}
					>
						<FileSpreadsheet className="w-3 h-3" /> Master CSV ({masterNodes.length})
					</button>
				</div>

				<div className="relative">
					<Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
					<input
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Find someone..."
						className="w-56 pl-7 pr-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
					/>
				</div>
				{source === 'profiles' && (
					<select
						value={deptFilter}
						onChange={(e) => setDeptFilter(e.target.value)}
						className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
					>
						<option value="">All departments</option>
						{departments.map((d) => <option key={d} value={d}>{d}</option>)}
					</select>
				)}
				<span className="text-xs text-slate-400 ml-auto">{filteredNodes.length} of {allNodes.length} shown</span>
			</div>

			{filteredNodes.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 text-center py-6">No matches.</p>
				</Card>
			) : (
				<GraphCanvas
					nodes={filteredNodes}
					layout="tree"
					height={760}
					onSelectNode={onSelectNode}
				/>
			)}
		</>
	);
}

// Pulls "Role: X" out of the notes_md blob the seed wrote, for the subtitle.
function parseRoleFromNotes(notes: string | null | undefined): string | null {
	if (!notes) return null;
	const match = notes.match(/Role:\s*([^·]+)/);
	if (!match) return null;
	return match[1].trim();
}
