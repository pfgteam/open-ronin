// /admin/settings — module settings index: one entry for every tool's
// settings page, reached from Management › Admin › Platform › Admin Overview
// (the panel for settings/tools not on the menus). Each tool also carries a
// gear to its own page (ToolSettingsGear).

import Link from 'next/link';
import { ArrowRight, Settings } from 'lucide-react';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { MODULE_SETTINGS } from '@/components/nav/navConfig';

export const metadata = { title: 'Module settings' };

export default function ModuleSettingsPage() {
	return (
		<>
			<PageHeader
				title="Module settings"
				description="Settings for each tool. The same pages open from the gear inside each tool."
			/>
			<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
				{MODULE_SETTINGS.map((m) => (
					<Card key={m.href}>
						<div className="flex items-start gap-3">
							<Settings className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
							<div className="min-w-0 flex-1 space-y-1">
								<Link href={m.href} className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:underline">
									{m.label}
								</Link>
								<p className="text-xs text-slate-600 dark:text-slate-400">{m.description}</p>
								<Link href={m.tool} className="inline-flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline">
									Open the tool ({m.toolLabel}) <ArrowRight className="w-3 h-3" aria-hidden="true" />
								</Link>
							</div>
						</div>
					</Card>
				))}
			</div>
		</>
	);
}
