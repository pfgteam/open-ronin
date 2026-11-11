'use client';

// The gear inside a tool that opens its settings page (sheet: Company ›
// Admin › Module Settings — "each setting also reachable from a gear icon
// inside its tool"). Admin module only; renders nothing for everyone else
// or for a path with no settings entry (MODULE_SETTINGS in navConfig).

import Link from 'next/link';
import { clsx } from 'clsx';
import { Settings } from 'lucide-react';
import { controlFocus } from '@/components/ui/focus';
import { useAuthStore } from '@/stores/auth';
import { canAccessModule, settingsForTool } from './navConfig';

export default function ToolSettingsGear({ tool }: { tool: string }) {
	const { profile, modules } = useAuthStore();
	const setting = settingsForTool(tool);
	if (!setting || !canAccessModule(profile, modules, 'admin')) return null;
	return (
		<Link
			href={setting.href}
			title={`${setting.label} settings`}
			aria-label={`${setting.label} settings`}
			className={clsx(
				'inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-hover hover:text-slate-900 dark:hover:text-slate-100',
				controlFocus,
			)}
		>
			<Settings className="w-4 h-4" aria-hidden="true" />
		</Link>
	);
}
