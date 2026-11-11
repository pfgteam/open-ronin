// /social — the Tools tab's landing page (route/module key kept as "social"
// so no data migration or redirect table is needed; only the label, this
// page's content, and the nav entries changed — 2026-09-09).
//
// Tools has no single home page of its own: it's a shelf for utilities that
// don't fit under another module. This hub just points at what's on it today
// (Sessions, Lead Scraper), the same tile-grid pattern /admin uses for its
// own index. Add a tile here whenever something new lands in Tools.

import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { Video, UserSearch, Newspaper, Clock, Workflow, Sparkles, type LucideIcon } from 'lucide-react';

const TILES: { href: string; icon: LucideIcon; title: string; description: string }[] = [
	{
		href: '/social/studio',
		icon: Sparkles,
		title: 'Content Studio',
		description: 'Scripts, hooks, images, video, clips and thumbnails through the provider registry',
	},
	{
		href: '/team/sessions',
		icon: Video,
		title: 'Sessions',
		description: 'Recorded calls, AI-scored — summaries, attention points, suggested tasks',
	},
	{
		href: '/media/lead-scraper',
		icon: UserSearch,
		title: 'Lead Scraper',
		description: 'Apify B2B database → staged for review → CSV',
	},
	{
		// Media Scraper (0102): journalists by beat, email waterfall, outlet crawl.
		href: '/media/media-scraper',
		icon: Newspaper,
		title: 'Media Scraper',
		description: 'Journalists by beat, outlet newsrooms → review → Contacts and Media Outlets',
	},
	{
		href: '/social/time-study',
		icon: Clock,
		title: 'Time Study',
		description: 'Two-week, 10-minute time study — entry grid, leader review, team breakdown',
	},
	{
		href: '/social/automations',
		icon: Workflow,
		title: 'Automations',
		description: 'Every scheduled and event-driven job — Vercel cron, n8n — with last run and status',
	},
];

export default function ToolsOverviewPage() {
	return (
		<>
			<PageHeader title="Tools" description="Utilities that don't live under another module" />

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{TILES.map(({ href, icon: Icon, title, description }) => (
					<Link
						key={href}
						href={href}
						className="block p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
					>
						<div className="flex items-start gap-3">
							<div className="w-8 h-8 rounded-md bg-primary-50 dark:bg-primary-950 flex items-center justify-center shrink-0">
								<Icon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
							</div>
							<div className="min-w-0">
								<p className="font-medium text-sm text-slate-900 dark:text-slate-100">{title}</p>
								<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
							</div>
						</div>
					</Link>
				))}
			</div>
		</>
	);
}
