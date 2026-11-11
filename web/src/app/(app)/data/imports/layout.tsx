// Capability gate for /data/imports. The Data module gate above (layout of
// /data) decides who sees the section; this layout decides who may import,
// the same shape as /media/lead-scraper. can_import_data() (0068) enforces
// the same rule in RLS, so this is the honest refusal, not the boundary.

import Card from '@/components/ui/Card';
import { hasCapability } from '@/lib/permissions/capabilities';

export default async function Layout({ children }: { children: React.ReactNode }) {
	const allowed = await hasCapability('import_data');

	if (!allowed) {
		return (
			<Card className="max-w-lg">
				<h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Imports</h1>
				<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
					You do not have access to Data Imports. It writes hundreds of rows into business tables at
					a time, so access is granted person by person rather than by role.
				</p>
				<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
					If you need it for your work, ask an admin. Access is managed in Admin, Roles and
					Permissions, under Capabilities.
				</p>
			</Card>
		);
	}

	return <>{children}</>;
}
