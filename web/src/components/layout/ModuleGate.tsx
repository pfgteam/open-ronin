// Server-side section gate — the enforcement layer between "hidden from nav"
// and RLS. Every module route tree gets a thin layout that wraps children in
// <ModuleGate>, so direct URLs stop working when the matrix says no.
// (Before 0024 the nav only HID entries; any signed-in user could still open
// /admin/tags or /admin/billing by URL.)

import Card from '@/components/ui/Card';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { MODULE_LABELS, type ModuleKey } from '@/lib/permissions/constants';

interface ModuleGateProps {
	module: ModuleKey;
	children: React.ReactNode;
}

export default async function ModuleGate({ module, children }: ModuleGateProps) {
	const allowed = await hasModuleAccess(module);

	if (!allowed) {
		return (
			<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						Restricted area
					</h2>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						Your role doesn&apos;t have access to the{' '}
						<span className="font-medium">{MODULE_LABELS[module]}</span> module.
					</p>
					<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
						If you need it for your work, ask an admin — access is managed in
						Admin → Roles &amp; Permissions.
					</p>
			</Card>
		);
	}

	return <>{children}</>;
}
