// Period switch for the department dashboards: KPI cards follow it, and the
// metric table highlights the matching columns.
//
// It is a pair of links writing ?period=… rather than client state, so the page
// stays a server component (no hydration, shareable URL, and the switch keeps
// working with JS off). Selection carries two indicators — surface + weight —
// per the tabs guidance.

import Link from 'next/link';
import { clsx } from 'clsx';

import type { DashboardPeriod } from '@/lib/dashboard/layout';

interface Props {
	basePath: string;
	period: DashboardPeriod;
	dayLabel: string;
	weekLabel: string | null;
}

export default function PeriodTabs({ basePath, period, dayLabel, weekLabel }: Props) {
	const tabs: { key: DashboardPeriod; label: string; sub: string }[] = [
		{ key: 'daily', label: 'Daily', sub: dayLabel },
		{ key: 'weekly', label: 'Weekly', sub: weekLabel ?? '—' },
	];

	return (
		<div className="inline-flex gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-700/60">
			{tabs.map((t) => {
				const active = t.key === period;
				return (
					<Link
						key={t.key}
						href={`${basePath}?period=${t.key}`}
						scroll={false}
						aria-current={active ? 'page' : undefined}
						className={clsx(
							'px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors',
							active
								? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold'
								: 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
						)}
					>
						{t.label}
						<span className="ml-1.5 font-normal text-slate-400 dark:text-slate-500 tabular-nums">
							{t.sub}
						</span>
					</Link>
				);
			})}
		</div>
	);
}
