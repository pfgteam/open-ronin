// /admin/users — Manage Supabase profiles (app users).
// Admin/exec viewers can edit role / department / active inline (UsersTable);
// everyone else sees the read-only listing. Writes go through actions.ts
// (zod validation + admin check + anti-lockout + audit log), enforced at the
// DB layer by RLS and the 0021 role-guard trigger.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import UsersTable, { type ProfileRow } from './UsersTable';
import { loadDepartments } from '@/lib/people/departments';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
	const supabase = await createClient();
	const user = await getAuthUser();

	const [{ data: profiles, error }, { data: viewer }, departments] = await Promise.all([
		supabase.from('profiles').select('*').order('created_at', { ascending: false }),
		user
			? supabase.from('profiles').select('id, role, is_active').eq('id', user.id).maybeSingle()
			: Promise.resolve({ data: null }),
		// Department options come from the tags table (canon since 0033) —
		// the hardcoded list this screen used was retired with the free-text
		// column in 0089.
		loadDepartments(supabase),
	]);

	const rows = (profiles ?? []) as ProfileRow[];
	const viewerCanEdit =
		!!viewer && viewer.is_active && (viewer.role === 'admin' || viewer.role === 'exec');

	return (
		<>
			<PageHeader
				title="Users"
				description={`${rows.length} accounts · Supabase auth + profiles`}
				actions={
					<p className="text-xs text-slate-400">
						{viewerCanEdit
							? 'Role, department and status are editable inline · changes are audit-logged'
							: 'Read-only · ask an admin to change roles or departments'}
					</p>
				}
			/>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error.message}
					</p>
				</Card>
			)}

			<UsersTable
				initialRows={rows}
				viewerId={user?.id ?? ''}
				viewerCanEdit={viewerCanEdit}
				departments={departments}
			/>
		</>
	);
}
