// /soon/<slug> — "Coming soon" placeholder for menu items the restructure
// sheet marks Status "New" (menu restructure, 2026-10-23). The registry is
// COMING_SOON in components/nav/navConfig.ts: one row per slug with the
// label, its home in the menu and the sheet's note. Unknown slugs 404.
//
// Honest-nav: these entries ride the `wip` flag, so only admins/execs and
// the Dev department see them in the menus; anyone who lands here by URL
// gets the same page. When the real page ships, point the nav item at it
// and delete the registry row.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Hourglass } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { COMING_SOON, MENU_SHEET_URL } from '@/components/nav/navConfig';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
	const { slug } = await params;
	const entry = COMING_SOON[slug];
	return { title: entry ? `${entry.label} (coming soon)` : 'Coming soon' };
}

export default async function ComingSoonPage({ params }: PageProps) {
	const { slug } = await params;
	const entry = COMING_SOON[slug];
	if (!entry) notFound();

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Hourglass className="w-5 h-5 text-slate-400" aria-hidden="true" />
						{entry.label}
						<Badge color="warning">Soon</Badge>
					</span>
				}
				description={entry.menu}
			/>
			<Card className="border-dashed max-w-2xl">
				<p className="text-sm text-slate-700 dark:text-slate-300">
					This page is on the menu but not built yet. It has a home in the new
					structure so the team can see where it will live; the spec is in
					Alex&apos;s menu sheet.
				</p>
				{entry.note && (
					<p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
						<span className="font-medium text-slate-700 dark:text-slate-300">From the sheet: </span>
						{entry.note}
					</p>
				)}
				<div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
					<a
						href={MENU_SHEET_URL}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1.5 text-primary-700 dark:text-primary-300 hover:underline"
					>
						<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
						Open Ronin Menu Restructure (Google Sheet)
					</a>
					<Link href="/team/whats-coming" className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:underline">
						What&apos;s Coming
					</Link>
					<Link href="/" className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:underline">
						<ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
						Back to Overview
					</Link>
				</div>
			</Card>
		</>
	);
}
