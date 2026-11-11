// Section gate for the Hiring module (0128). The matrix allows exec /
// admin / manager; people managers who are contributors (JC, Toni,
// Casey) must get in too, so the gate is "module OR people_managers row",
// the same circle can_view_hiring() admits in SQL (RLS is the real guard).

import Card from '@/components/ui/Card';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { loadSensitiveAccessContext } from '@/lib/people/permissions';

export default async function Layout({ children }: { children: React.ReactNode }) {
	const [allowed, ctx] = await Promise.all([hasModuleAccess('hiring'), loadSensitiveAccessContext()]);
	if (!allowed && !ctx.viewerIsPeopleManager) {
		return (
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Restricted area</h2>
				<p className="text-sm text-slate-600 dark:text-slate-400">Hiring is for people managers and executives. If you manage people and need it, ask an admin to add you to the people-managers group (Admin → People Managers).</p>
			</Card>
		);
	}
	return <>{children}</>;
}
