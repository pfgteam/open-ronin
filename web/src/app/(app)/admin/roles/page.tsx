// /admin/roles — Roles & Permissions: the editor for the module × role matrix
// (public.role_permissions, migration 0024). Replaces the ComingSoon stub.
//
// Model B hybrid (Sam, 2026-08-18): the matrix lives in the DB and is
// editable here; roles stay the fixed four. Exec/admin columns are locked ✓ —
// has_module_access() gives them everything (anti-lockout floor), so a toggle
// there would only misrepresent what the DB enforces.
//
// Enforcement layers this page controls:
//   nav (hide) → ModuleGate layouts (block direct URLs) → RLS where a module
//   owns tables (data_* delegates to has_module_access('data')).

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Check, Lock, Minus, ShieldCheck, Users, UserSearch } from 'lucide-react';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { ROLES, type RoleKey } from '@/lib/permissions/constants';
import { FormError } from '../../team/_form';
import { setModulePermission } from './actions';

export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ error?: string }>;
}

interface ModuleRow {
	key: string;
	label: string;
	description: string | null;
	sort: number;
}

interface PermRow {
	role: string;
	module_key: string;
	allowed: boolean;
}

const ROLE_LABELS: Record<RoleKey, string> = {
	exec: 'Exec',
	admin: 'Admin',
	manager: 'Manager',
	contributor: 'Contributor',
};

export default async function RolesPage({ searchParams }: PageProps) {
	const { error } = await searchParams;
	const supabase = await createClient();
	const viewer = await getAuthProfile();

	const canEdit =
		!!viewer && viewer.is_active && (viewer.role === 'admin' || viewer.role === 'exec');

	const [{ data: moduleRows }, { data: permRows }] = await Promise.all([
		supabase.from('app_modules').select('key, label, description, sort').order('sort'),
		supabase.from('role_permissions').select('role, module_key, allowed'),
	]);

	const modules = (moduleRows ?? []) as ModuleRow[];
	const perms = (permRows ?? []) as PermRow[];
	const allowedMap = new Map(perms.map((p) => [`${p.role}:${p.module_key}`, p.allowed]));

	if (modules.length === 0) {
		return (
			<>
				<PageHeader title="Roles & Permissions" description="Module × role access matrix" />
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						The permission tables are missing — apply migration{' '}
						<code>0024_permissions.sql</code> in the Supabase SQL Editor. Until then the
						app falls back to the legacy role rules (dashboards = manager-and-up, data +
						admin = exec/admin).
					</p>
				</Card>
			</>
		);
	}

	return (
		<>
			<PageHeader
				title="Roles & Permissions"
				description="Which modules each role can open — enforced in the nav, at the route layer, and (for Data) by RLS"
			/>

			<div className="space-y-4">
				<FormError message={error} />

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
						<ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							Module access matrix
						</h2>
						{!canEdit && (
							<span className="ml-auto">
								<Badge color="default">Read-only</Badge>
							</span>
						)}
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Module</th>
								{ROLES.map((role) => (
									<th key={role} className="text-center text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">
										{ROLE_LABELS[role]}
										{(role === 'exec' || role === 'admin') && (
											<Lock
												className="w-3 h-3 inline-block ml-1 text-slate-400"
												aria-label="Always full access"
											/>
										)}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
							{modules.map((m) => (
								<tr key={m.key} className="hover:bg-hover transition-colors">
									<td className="px-3 py-2">
										<p className="font-medium text-slate-900 dark:text-slate-100">{m.label}</p>
										{m.description && (
											<p className="text-2xs text-slate-500 dark:text-slate-400">{m.description}</p>
										)}
									</td>
									{ROLES.map((role) => {
										const locked = role === 'exec' || role === 'admin';
										const allowed = locked
											? true
											: (allowedMap.get(`${role}:${m.key}`) ?? false);
										const cell = allowed ? (
											<Check className="w-4 h-4 mx-auto text-green-600 dark:text-green-400" />
										) : (
											<Minus className="w-4 h-4 mx-auto text-slate-300 dark:text-slate-600" />
										);
										if (locked || !canEdit) {
											return (
												<td
													key={role}
													className="px-3 py-2 text-center"
													title={locked ? 'Exec and admin always have full access' : undefined}
												>
													{cell}
												</td>
											);
										}
										return (
											<td key={role} className="px-3 py-2 text-center">
												<form action={setModulePermission} className="inline">
													<input type="hidden" name="role" value={role} />
													<input type="hidden" name="module" value={m.key} />
													<input type="hidden" name="allowed" value={allowed ? 'false' : 'true'} />
													<button
														type="submit"
														className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
														title={`${allowed ? 'Revoke' : 'Grant'} ${m.label} for ${ROLE_LABELS[role]}`}
													>
														{cell}
													</button>
												</form>
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
					</div>
					<p className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700">
						Exec and admin are locked to full access so the matrix can never lock
						administrators out. Home is always visible to everyone. Changes apply on the
						next page load; Data access is also enforced by the database (RLS).
					</p>
				</Card>

				{/* Per-person capabilities (0055) moved to /admin/capabilities. */}
				<Card>
					<div className="flex items-center gap-1.5 mb-2">
						<UserSearch className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							Capabilities
						</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">granted person by person</span>
					</div>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						Some permissions go to named people rather than to a role: running the Lead
						Scraper, running Data Imports, acquisition sourcing. They are managed at{' '}
						<Link
							href="/admin/capabilities"
							className="text-primary-600 dark:text-primary-400 hover:underline"
						>
							Admin → Capabilities
						</Link>
						, with who granted each one and when.
					</p>
				</Card>

				<Card>
					<div className="flex items-center gap-1.5 mb-2">
						<Users className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							Per-person grants (ACLs)
						</h2>
					</div>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						Sensitive people data (compensation, PAP, HR notes, 4R docs) is not part of
						the module matrix — it uses an explicit per-person grant list managed at{' '}
						<Link
							href="/admin/people-managers"
							className="text-primary-600 dark:text-primary-400 hover:underline"
						>
							Admin → People Managers
						</Link>
						. Role and active status are changed only in{' '}
						<Link
							href="/admin/users"
							className="text-primary-600 dark:text-primary-400 hover:underline"
						>
							Admin → Users
						</Link>
						, protected by a database trigger against self-escalation.
					</p>
				</Card>
			</div>
		</>
	);
}
