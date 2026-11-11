// Tab strip for /team/[id]. The tab is URL state (?tab=), so an unvisited tab
// costs no queries, every tab is linkable/bookmarkable, and a reload lands
// where you were.
//
// Treatment: the /clients/[id] tab nav (ClientTabs) — the app's other
// detail-page tab row: underlined active tab, icon + label, scrolls sideways on
// narrow screens. PeriodTabs (the pill group) is the OTHER precedent, but it is
// a two-value filter over one page of content; this is five sections of a
// record, which is exactly what ClientTabs is for. ClientTabs is a client
// component only because its tabs are separate ROUTES and it needs
// usePathname — ours are a query param the server already parsed, so this one
// stays a server component.

import Link from 'next/link';
import { clsx } from 'clsx';
import { LayoutDashboard, BarChart3, HeartPulse, FileText, CalendarDays, ShieldCheck, ClipboardList, FolderKanban } from 'lucide-react';

export const PROFILE_TABS = ['overview', 'work', 'metrics', 'checkins', 'fourr', 'pap', 'docs', 'timeoff'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

const TAB_META: Record<ProfileTab, { label: string; icon: typeof LayoutDashboard }> = {
	overview: { label: 'Overview', icon: LayoutDashboard },
	// Work Revamp §4.4: this person's open items across every board.
	work: { label: 'Work', icon: FolderKanban },
	metrics: { label: 'Metrics', icon: BarChart3 },
	checkins: { label: 'Check-ins', icon: HeartPulse },
	// The 4R sits between Check-ins and PAP (Alex, 2026-09-18) and is the
	// one people tab everyone can open.
	fourr: { label: '4R', icon: ClipboardList },
	pap: { label: 'PAP', icon: ShieldCheck },
	docs: { label: 'Docs', icon: FileText },
	timeoff: { label: 'Time off', icon: CalendarDays },
};

/** An unknown, malformed or not-permitted ?tab= falls back to Overview rather
 *  than rendering an empty page. */
export function parseProfileTab(raw: string | undefined, available: readonly ProfileTab[]): ProfileTab {
	const match = PROFILE_TABS.find((t) => t === raw);
	return match && available.includes(match) ? match : 'overview';
}

interface Props {
	basePath: string;
	active: ProfileTab;
	available: readonly ProfileTab[];
	/** Search params carried across a tab switch — `month` and `week` only, so
	 *  the month you arrived with survives, while one-shot flash params
	 *  (metricsSaved, checkinError, …) do not follow you to another tab. */
	keep: [string, string][];
}

export default function ProfileTabs({ basePath, active, available, keep }: Props) {
	return (
		<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 -mx-1 px-1 mb-4 overflow-x-auto">
			{available.map((key) => {
				const { label, icon: Icon } = TAB_META[key];
				const params = new URLSearchParams(keep);
				params.set('tab', key);
				const isActive = key === active;
				return (
					<Link
						key={key}
						href={`${basePath}?${params.toString()}`}
						aria-current={isActive ? 'page' : undefined}
						className={clsx(
							'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
							isActive
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
