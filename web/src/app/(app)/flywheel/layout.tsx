// Section gate for the Flywheel module (0136). The matrix seeds every role
// allowed (the delivery team are contributors); RLS (can_view_flywheel) is
// the real guard.

import Card from '@/components/ui/Card';
import { hasModuleAccess } from '@/lib/permissions/modules';

export default async function Layout({ children }: { children: React.ReactNode }) {
	const allowed = await hasModuleAccess('flywheel');
	if (!allowed) {
		return (
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Restricted area</h2>
				<p className="text-sm text-slate-600 dark:text-slate-400">Flywheel is for the delivery team. Ask an admin to allow your role in Admin → Roles.</p>
			</Card>
		);
	}
	return <>{children}</>;
}
