// /social/studio: Content Studio hub. Tiles for the six tools, recent jobs
// and the viewer's latest assets (WIP_BUILD_PLAN.md module 2).

import Link from 'next/link';
import { BookOpen, Film, Image as ImageIcon, Inbox, LayoutList, Scissors, Sparkles, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import JobCard from '@/components/content-studio/JobCard';
import AssetGrid from '@/components/content-studio/AssetGrid';
import { assetsForJobs, listJobs, listWorkItemOptions } from '@/lib/content-studio/server';
import { STUDIO_TOOLS } from '@/lib/content-studio/shared';

export const dynamic = 'force-dynamic';

const ICONS: Record<string, LucideIcon> = {
	'/social/studio/scripts': BookOpen,
	'/social/studio/headlines': Sparkles,
	'/social/studio/images': ImageIcon,
	'/social/studio/video': Film,
	'/social/studio/clips': Scissors,
	'/social/studio/thumbnails': Type,
};

export default async function StudioHubPage() {
	const [jobs, workItems] = await Promise.all([listJobs({ limit: 6 }), listWorkItemOptions()]);
	const doneIds = jobs.filter((j) => j.status === 'done').map((j) => j.id);
	const assets = (await assetsForJobs(doneIds)).slice(0, 6);

	return (
		<>
			<PageHeader
				title="Content Studio"
				description="Scripts, hooks, images, video, clips and thumbnails through the provider registry. Every job lands on the Jobs page with its cost."
				actions={
					<div className="flex items-center gap-2">
						<Link href="/social/studio/requests">
							<Button variant="outline" size="sm">
								<Inbox className="w-4 h-4" /> Requests
							</Button>
						</Link>
						<Link href="/social/studio/jobs">
							<Button variant="outline" size="sm">
								<LayoutList className="w-4 h-4" /> Jobs
							</Button>
						</Link>
					</div>
				}
			/>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{STUDIO_TOOLS.map((t) => {
					const Icon = ICONS[t.href] ?? Sparkles;
					return (
						<Link
							key={t.href}
							href={t.href}
							className="block p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
						>
							<div className="flex items-start gap-3">
								<div className="w-8 h-8 rounded-md bg-primary-50 dark:bg-primary-950 flex items-center justify-center shrink-0">
									<Icon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
								</div>
								<div className="min-w-0">
									<p className="font-medium text-sm text-slate-900 dark:text-slate-100">{t.title}</p>
									<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.description}</p>
								</div>
							</div>
						</Link>
					);
				})}
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
				<section className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent jobs</h2>
					{jobs.length === 0 ? (
						<Card>
							<p className="text-sm text-slate-500 dark:text-slate-400">Nothing yet. Pick a tool above to start your first job.</p>
						</Card>
					) : (
						jobs.map((j) => <JobCard key={j.id} job={j} compact />)
					)}
				</section>
				<section className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">My assets</h2>
					{assets.length === 0 ? (
						<Card>
							<p className="text-sm text-slate-500 dark:text-slate-400">Generated images, audio and video show up here once a job finishes.</p>
						</Card>
					) : (
						<AssetGrid assets={assets} workItems={workItems} columns={2} />
					)}
				</section>
			</div>
		</>
	);
}
