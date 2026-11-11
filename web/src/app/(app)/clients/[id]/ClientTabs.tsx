'use client';

// Tab navigation for /clients/[id]/* — highlights the active tab based on the
// current pathname. Each tab is its own route under /clients/[id]/...

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
	LayoutDashboard,
	Newspaper,
	Activity,
	BarChart3,
	Compass,
	Bot,
	Package,
	KeyRound,
} from 'lucide-react';

interface Props {
	id: string;
}

export default function ClientTabs({ id }: Props) {
	const pathname = usePathname();

	const tabs = [
		{ label: 'Overview', href: `/clients/${id}`, icon: LayoutDashboard, exact: true },
		{ label: 'Delivery', href: `/clients/${id}/delivery`, icon: Newspaper },
		{ label: 'Packages', href: `/clients/${id}/packages`, icon: Package },
		{ label: 'Portal', href: `/clients/${id}/portal`, icon: KeyRound },
		{ label: 'Strategy', href: `/clients/${id}/strategy`, icon: Compass },
		{ label: 'Tracking', href: `/clients/${id}/tracking`, icon: BarChart3 },
		{ label: 'Health', href: `/clients/${id}/health`, icon: Activity },
		{ label: 'GHL', href: `/clients/${id}/ghl`, icon: Bot },
	];

	function isActive(href: string, exact?: boolean) {
		if (exact) return pathname === href;
		return pathname.startsWith(href);
	}

	return (
		<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 -mx-1 px-1 overflow-x-auto">
			{tabs.map(({ label, href, icon: Icon, exact }) => {
				const active = isActive(href, exact);
				return (
					<Link
						key={href}
						href={href}
						className={clsx(
							'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
							active
								? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
								: 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
						)}
					>
						<Icon className="w-4 h-4" />
						{label}
					</Link>
				);
			})}
		</div>
	);
}
