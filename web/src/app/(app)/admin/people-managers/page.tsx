// /admin/people-managers — manage public.people_managers, the grant list for
// compensation / PAP / HR-note access. Exec + admin only.

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { departmentOf, departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { Field, FormError, inputClass, selectClass } from '../../team/_form';
import { addPeopleManager, removePeopleManager } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ error?: string }>;
}

interface ManagerRow {
	user_id: string;
	scope: string;
	note: string | null;
	added_at: string;
}

interface ProfileLite {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	department_tag_id: string | null;
	role: string;
	is_active: boolean;
}

const SCOPE_HELP: Record<string, string> = {
	all: 'Sees sensitive info for the whole company',
	team: 'Scoped to their department (not yet enforced in queries)',
	direct_reports_only: 'Scoped to their direct reports (not yet enforced in queries)',
};

export default async function PeopleManagersPage({ searchParams }: PageProps) {
	const { error } = await searchParams;
	const supabase = await createClient();

	const user = await getAuthUser();

	const { data: me } = user
		? await supabase.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle()
		: { data: null };

	const canEdit = !!me && me.is_active && (me.role === 'admin' || me.role === 'exec');

	if (!canEdit) {
		return (
			<>
				<Card>
					<div className="text-center py-12 text-slate-500">
						<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
						<p className="text-sm">
							The people-manager list is managed by exec and admin accounts only.
						</p>
					</div>
				</Card>
			</>
		);
	}

	const [{ data: managerRows }, { data: profileRows }, departmentTags] = await Promise.all([
		supabase.from('people_managers').select('*').order('added_at', { ascending: true }),
		supabase
			.from('profiles')
			.select('id, email, first_name, last_name, title, department_tag_id, role, is_active')
			.eq('is_active', true)
			.order('first_name', { ascending: true }),
		loadDepartments(supabase),
	]);

	// Department label comes from the tags table — profiles.department (free
	// text) was retired in 0089.
	const deptLabels = departmentLabelById(departmentTags);
	const deptLabel = (p: ProfileLite) => departmentOf(p, deptLabels);

	const managers = (managerRows ?? []) as ManagerRow[];
	const profiles = (profileRows ?? []) as ProfileLite[];
	const profileById = new Map(profiles.map((p) => [p.id, p]));
	const grantedIds = new Set(managers.map((m) => m.user_id));
	const candidates = profiles.filter((p) => !grantedIds.has(p.id));
	const elevated = profiles.filter((p) => p.role === 'exec' || p.role === 'admin');

	const nameOf = (p: ProfileLite | undefined, fallback: string) =>
		p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email : fallback;

	return (
		<>
			<PageHeader
				title="People Managers"
				description={`${managers.length} explicit grants · access to compensation, PAP and HR notes`}
			/>

			<div className="space-y-4">
				<FormError message={error} />

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
						<ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							Explicit grants
						</h2>
					</div>
					{managers.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-6">
							No explicit grants yet — only exec and admin accounts can see sensitive info.
						</p>
					) : (
						<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
								<tr>
									<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Team member</th>
									<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Scope</th>
									<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Note</th>
									<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Granted</th>
									<th className="px-3 py-2" />
								</tr>
							</thead>
							<tbody>
								{managers.map((m) => {
									const p = profileById.get(m.user_id);
									return (
										<tr
											key={m.user_id}
											className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
										>
											<td className="px-3 py-2">
												<Link
													href={`/team/${m.user_id}`}
													className="text-slate-900 dark:text-slate-100 hover:text-primary-600 transition-colors"
												>
													{nameOf(p, m.user_id.slice(0, 8))}
												</Link>
												{p?.title && <span className="text-2xs text-slate-600 dark:text-slate-400"> · {p.title}</span>}
												{!p && (
													<Badge color="warning" className="ml-1.5 text-2xs">
														inactive or deleted
													</Badge>
												)}
											</td>
											<td className="px-3 py-2">
												<Badge color={m.scope === 'all' ? 'primary' : 'default'}>{m.scope}</Badge>
											</td>
											<td className="px-3 py-2 text-slate-500">{m.note ?? '—'}</td>
											<td className="px-3 py-2 text-slate-500">{formatDate(m.added_at)}</td>
											<td className="px-3 py-2 text-right">
												<form action={removePeopleManager}>
													<input type="hidden" name="user_id" value={m.user_id} />
													<Button variant="ghost" size="sm" type="submit">
														<Trash2 className="w-3.5 h-3.5" /> Revoke
													</Button>
												</form>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						</div>
					)}
				</Card>

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Grant access
					</h2>
					<form action={addPeopleManager} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
						<Field label="Team member">
							<select name="user_id" defaultValue="" className={selectClass} required>
								<option value="">— Select —</option>
								{candidates.map((c) => (
									<option key={c.id} value={c.id}>
										{nameOf(c, c.email)}
										{deptLabel(c) ? ` · ${deptLabel(c)}` : ''}
									</option>
								))}
							</select>
						</Field>
						{/* Scope select removed 18/08/2026: is_people_manager() ignores
						    scope, so offering team/direct_reports_only promised a
						    restriction that did not exist. Everyone is 'all' until
						    scoped RLS is actually implemented. */}
						<input type="hidden" name="scope" value="all" />
						<Field label="Note">
							<input name="note" placeholder="Why they need it" className={inputClass} />
						</Field>
						<Button type="submit">Grant</Button>
					</form>
					<p className="text-2xs text-slate-600 dark:text-slate-400 mt-2">
						Scope is stored but not yet enforced in queries — every grant currently behaves like{' '}
						<code>all</code>. {SCOPE_HELP.team}
					</p>
				</Card>

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						Implicit access via role
					</h2>
					<p className="text-xs text-slate-500 mb-2">
						These accounts see sensitive info because of their role, with or without an explicit
						grant. Change a role in <Link href="/admin/users" className="text-primary-600 hover:underline">Admin → Users</Link>.
					</p>
					<div className="flex flex-wrap gap-1.5">
						{elevated.map((p) => (
							<Badge key={p.id} color={p.role === 'exec' ? 'danger' : 'warning'}>
								{nameOf(p, p.email)} · {p.role}
							</Badge>
						))}
						{elevated.length === 0 && <span className="text-sm text-slate-400">None.</span>}
					</div>
				</Card>
			</div>
		</>
	);
}
