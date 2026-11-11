'use client';

// The in-page menu of Admin → Prospects (spec 2026-10-19 §3): five sections
// plus Duplicates, each with a one-line description. A horizontal strip on
// small screens, a side column from lg up.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { controlFocus } from '@/components/ui/focus';
import { ADMIN_SECTIONS } from '@/lib/revenue/adminOptions';

export default function SectionMenu({ duplicates }: { duplicates: number }) {
	const pathname = usePathname();
	return (
		<nav aria-label="Prospects settings" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 lg:mx-0 lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0">
			{ADMIN_SECTIONS.map((s) => {
				const href = `/admin/prospects/${s.key}`;
				const active = pathname === href || pathname.startsWith(`${href}/`);
				return (
					<Link
						key={s.key}
						href={href}
						aria-current={active ? 'page' : undefined}
						className={clsx(
							'shrink-0 rounded-md px-3 py-2 text-sm lg:shrink',
							controlFocus,
							s.key === 'duplicates' && 'lg:mt-2 lg:border-t lg:border-slate-200 lg:pt-3 lg:dark:border-slate-700',
							active ? 'bg-primary-50 font-semibold text-primary-900 dark:bg-primary-950 dark:text-primary-300' : 'text-slate-600 hover:bg-hover dark:text-slate-400',
						)}
					>
						<span className="flex items-center gap-2 whitespace-nowrap">
							{s.label}
							{s.key === 'duplicates' && duplicates > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-2xs tabular-nums dark:bg-slate-700">{duplicates}</span>}
						</span>
						<span className="hidden text-2xs font-normal text-slate-500 lg:block">{s.description}</span>
					</Link>
				);
			})}
		</nav>
	);
}
