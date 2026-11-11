'use client';

// Tabs ON a page (the sheet's "Items On Screen"), never menu rows. Today:
// Management › Dashboards ("tabs at top to switch between areas, general is
// first"). Internal Work's tabs are drawn by the hub itself (ownTabs).
// Driven by the same model as SideNav (navModel.ts), so the tab that is lit
// and the row that is lit in the sidebar always agree. Renders nothing on a
// page that is not a tab.

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/stores/auth';
import { controlFocus } from '@/components/ui/focus';
import { isSoonHref, sectionByKey } from './navConfig';
import { activeTabs, resolveActive, visibleNav } from './navModel';
import { useCurrentSection } from './menuPreference';

export default function PageTabs() {
	const pathname = usePathname();
	const search = useSearchParams().toString();
	const { profile, modules } = useAuthStore();
	const sectionKey = useCurrentSection(pathname);
	const section = sectionKey ? sectionByKey(sectionKey) : undefined;
	const strip = useMemo(() => {
		if (!section) return null;
		const nav = visibleNav(section.groups, { profile, modules });
		return activeTabs(nav, resolveActive(nav, pathname, search));
	}, [section, profile, modules, pathname, search]);

	if (!strip || strip.tabs.length < 2) return null;
	return (
		<nav aria-label={strip.label} className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
			{strip.tabs.map((t) => {
				const on = t.href === strip.active;
				return (
					<Link
						key={t.href}
						href={t.href}
						aria-current={on ? 'page' : undefined}
						className={clsx(
							'-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-13 font-medium transition-colors duration-150 motion-reduce:transition-none',
							on
								? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300'
								: 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
							controlFocus,
						)}
					>
						{t.label}
						{isSoonHref(t.href) && <span className="text-2xs font-medium text-amber-800 dark:text-amber-300">Soon</span>}
					</Link>
				);
			})}
		</nav>
	);
}
