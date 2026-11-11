// /team — Team Directory. Reads Supabase profiles (the app's actual users),
// grouped by department, with reporting lines derived from profiles.manager_id.
// People-managers also get an honest completeness banner: an org chart is only
// as good as the fields behind it, so missing data is shown, not hidden.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { formatPosition } from '@/lib/people/position';
import { Pencil, AlertTriangle } from 'lucide-react';
import TeamGrid, { type TeamMember } from './TeamGrid';

export const metadata = { title: 'Team' };


export const dynamic = 'force-dynamic';

interface ProfileRow {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	department: string | null;
	department_tag_id: string | null;
	position_track: string | null;
	position_level: number | null;
	job_role: string | null;
	manager_id: string | null;
	avatar_url: string | null;
	photo_url: string | null;
	in_office: boolean;
	role: 'exec' | 'admin' | 'manager' | 'contributor';
	is_active: boolean;
	created_at: string;
}

function displayName(p: Pick<ProfileRow, 'first_name' | 'last_name' | 'email'>): string {
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

export default async function TeamDirectoryPage() {
	const supabase = await createClient();
	const [{ data: profiles, error }, ctx, { data: deptRows }, { data: trackRows }] =
		await Promise.all([
			supabase
				.from('profiles')
				.select('*')
				.eq('is_active', true)
				.order('first_name', { ascending: true }),
			loadSensitiveAccessContext(),
			// Canon department order = tags position (/admin/tags); tracks = 0033.
			supabase.from('tags').select('id, label').eq('category', 'department').order('position'),
			supabase.from('position_tracks').select('slug, label'),
		]);

	const rows = (profiles ?? []) as ProfileRow[];
	const deptTags = (deptRows ?? []) as { id: string; label: string }[];
	const deptById = new Map(deptTags.map((d) => [d.id, d.label]));
	const trackBySlug = new Map(
		((trackRows ?? []) as { slug: string; label: string }[]).map((t) => [t.slug, t.label]),
	);
	// Canon order from /admin/tags; legacy free-text departments sort after.
	const DEPT_ORDER = deptTags.map((d) => d.label);

	const deptOf = (p: ProfileRow): string | null =>
		(p.department_tag_id ? deptById.get(p.department_tag_id) : null) ?? p.department;
	const positionOf = (p: ProfileRow): string | null =>
		formatPosition(
			p.department_tag_id ? deptById.get(p.department_tag_id) : null,
			p.position_track ? (trackBySlug.get(p.position_track) ?? p.position_track) : null,
			p.position_level,
		) ?? p.title;
	const byId = new Map(rows.map((p) => [p.id, p]));
	const canManage = canManagePeople(ctx);

	const reportCounts = rows.reduce<Record<string, number>>((acc, p) => {
		if (p.manager_id) acc[p.manager_id] = (acc[p.manager_id] ?? 0) + 1;
		return acc;
	}, {});

	// Honest completeness: which profiles can't carry their weight in the org
	// chart / PAP / leaderboards yet. Department counts as set when either the
	// canon FK (0033) or the legacy text is present; position = composed or title.
	const incomplete = rows.filter((p) => !deptOf(p) || !positionOf(p) || !p.manager_id);
	const missingManager = rows.filter((p) => !p.manager_id).length;
	const missingDept = rows.filter((p) => !deptOf(p)).length;
	const missingTitle = rows.filter((p) => !positionOf(p)).length;

	const grouped = rows.reduce<Record<string, ProfileRow[]>>((acc, p) => {
		const dept = deptOf(p) ?? 'Unassigned';
		(acc[dept] ??= []).push(p);
		return acc;
	}, {});

	const sortedDepts = Object.keys(grouped).sort((a, b) => {
		if (a === 'Unassigned') return 1;
		if (b === 'Unassigned') return -1;
		const ia = DEPT_ORDER.indexOf(a);
		const ib = DEPT_ORDER.indexOf(b);
		if (ia === -1 && ib === -1) return a.localeCompare(b);
		if (ia === -1) return 1;
		if (ib === -1) return -1;
		return ia - ib;
	});

	// Card-ready rows for TeamGrid: department, position and manager are
	// resolved here so the client component stays a pure filter + render.
	const members: TeamMember[] = sortedDepts.flatMap((dept) =>
		grouped[dept].map((p) => {
			const manager = p.manager_id ? byId.get(p.manager_id) : undefined;
			return {
				id: p.id,
				email: p.email,
				fullName: displayName(p),
				initials:
					`${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase() ||
					(p.email[0]?.toUpperCase() ?? '?'),
				position: positionOf(p) ?? p.role,
				jobRole: p.job_role,
				department: dept,
				photo: p.photo_url ?? p.avatar_url,
				managerId: p.manager_id,
				managerName: manager ? displayName(manager) : null,
				reports: reportCounts[p.id] ?? 0,
				nashvilleInOffice: p.in_office,
				canEdit: canManage || ctx.viewerId === p.id,
			};
		}),
	);

	const me = ctx.viewerId ? byId.get(ctx.viewerId) : undefined;
	const myProfileIncomplete = me ? !deptOf(me) || !positionOf(me) || !me.manager_id : false;

	return (
		<>
			<PageHeader
				title="Team Directory"
				description={`${rows.length} active members · Supabase profiles`}
				actions={
					me ? (
						<Link
							href={`/team/${me.id}/edit`}
							className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors"
						>
							<Pencil className="w-3 h-3" /> Edit my profile
						</Link>
					) : null
				}
			/>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error.message}
					</p>
				</Card>
			)}

			{myProfileIncomplete && me && (
				<Card className="mb-4 border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/20">
					<p className="text-sm text-slate-700 dark:text-slate-300">
						Your profile is missing{' '}
						{[!positionOf(me) && 'a position', !deptOf(me) && 'a department', !me.manager_id && 'a manager']
							.filter(Boolean)
							.join(', ')}
						.{' '}
						{/* Structure fields are people-manager territory (canon rule): a
						    contributor's edit screen shows them disabled, so don't send
						    them there — the same split HomeSetupNotice makes. */}
						{canManage ? (
							<>
								<Link href={`/team/${me.id}/edit`} className="text-primary-600 hover:underline">
									Complete it
								</Link>{' '}
								so the directory and org chart are right.
							</>
						) : (
							<>A people-manager sets these — ask yours to fill them in.</>
						)}
					</p>
				</Card>
			)}

			{canManage && incomplete.length > 0 && (
				<Card className="mb-4">
					<div className="flex items-start gap-2">
						<AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
						<div className="min-w-0">
							<p className="text-sm text-slate-700 dark:text-slate-300">
								<strong>{incomplete.length}</strong> of {rows.length} profiles are incomplete —{' '}
								{missingManager} without a manager, {missingDept} without a department,{' '}
								{missingTitle} without a position. The org chart, PAP tracking and metrics all
								read these fields.
							</p>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{incomplete.slice(0, 12).map((p) => (
									<Link
										key={p.id}
										href={`/team/${p.id}/edit`}
										className="inline-flex items-center gap-1 text-2xs text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:border-primary-300 hover:text-primary-600 transition-colors"
									>
										<Pencil className="w-2.5 h-2.5" /> {displayName(p)}
									</Link>
								))}
								{incomplete.length > 12 && (
									<span className="text-2xs text-slate-600 dark:text-slate-400 self-center">
										+{incomplete.length - 12} more
									</span>
								)}
							</div>
						</div>
					</div>
				</Card>
			)}

			{rows.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 text-center py-8">
						No team members yet.{' '}
						{canManage ? (
							<>
								Invite people from{' '}
								<Link href="/admin/users" className="text-primary-600 hover:underline">
									Admin → Users
								</Link>
								.
							</>
						) : (
							'Ask an admin to invite the team.'
						)}
					</p>
				</Card>
			) : (
				<TeamGrid members={members} departments={sortedDepts} />
			)}
		</>
	);
}
