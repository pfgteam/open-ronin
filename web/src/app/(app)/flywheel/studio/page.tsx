// /flywheel/studio — the Flywheel Studio (Alex 10/02): one place to
// create, schedule and publish every Flywheel asset (pages, Medium /
// LinkedIn / Quora / Reddit pieces, Shorts, seed videos). Mirrors the
// Content Studio for social: a week calendar + a status board over
// fw_studio_items(); the per-asset keyword is editable here.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadPrograms, loadStudioItems, loadTeamPickList } from '@/lib/flywheel/server';
import NotAppliedCard from '../NotAppliedCard';
import StudioBoard from './StudioBoard';

export const metadata = { title: 'Studio · Flywheel' };
export const dynamic = 'force-dynamic';

function monday(d: Date): Date {
	const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dow = (x.getUTCDay() + 6) % 7;
	x.setUTCDate(x.getUTCDate() - dow);
	return x;
}

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ program?: string; week?: string; view?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const programs = await loadPrograms(supabase, { status: 'open' });
	const programId = sp.program && programs.some((p) => p.id === sp.program) ? sp.program : null;
	const start = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? monday(new Date(sp.week + 'T00:00:00Z')) : monday(new Date());
	const end = new Date(start.getTime() + 6 * 86_400_000);
	const view = sp.view === 'board' ? 'board' : 'week';
	const [items, people] = await Promise.all([loadStudioItems(supabase, { programId, from: view === 'week' ? start.toISOString().slice(0, 10) : undefined, to: view === 'week' ? end.toISOString().slice(0, 10) : undefined }), loadTeamPickList(supabase)]);
	const prev = new Date(start.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
	const next = new Date(start.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
	const q = (over: Record<string, string | undefined>) => {
		const u = new URLSearchParams();
		const merged = { program: programId ?? undefined, week: start.toISOString().slice(0, 10), view, ...over };
		for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
		return `/flywheel/studio?${u.toString()}`;
	};
	return (
		<>
			<PageHeader
				title="Flywheel Studio"
				description="Create, schedule and publish every Flywheel asset in one place: pages, Medium / LinkedIn / Quora / Reddit pieces, Shorts, seed videos. Keyword is per asset (defaults to the page / cluster keyword)."
				actions={
					<div className="flex items-center gap-2 text-xs">
						<Link href={q({ view: 'week' })} className={view === 'week' ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-primary-600 hover:underline'}>
							Week
						</Link>
						<Link href={q({ view: 'board' })} className={view === 'board' ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-primary-600 hover:underline'}>
							Board
						</Link>
						<Link href="/flywheel/queue" className="text-primary-600 hover:underline">
							Posting queue
						</Link>
						<Link href="/flywheel/inbox" className="text-primary-600 hover:underline">
							Review inbox
						</Link>
					</div>
				}
			/>
			<Card className="mb-4">
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<span className="text-slate-500">Program:</span>
					<Link href={q({ program: undefined })} className={!programId ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-primary-600 hover:underline'}>
						All
					</Link>
					{programs.map((p) => (
						<Link key={p.id} href={q({ program: p.id })} className={programId === p.id ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-primary-600 hover:underline'}>
							{p.client_name}
						</Link>
					))}
					{view === 'week' && (
						<span className="ml-auto flex items-center gap-2">
							<Link href={q({ week: prev })} className="text-primary-600 hover:underline">
								← prev
							</Link>
							<Badge>
								{start.toISOString().slice(0, 10)} → {end.toISOString().slice(0, 10)}
							</Badge>
							<Link href={q({ week: next })} className="text-primary-600 hover:underline">
								next →
							</Link>
						</span>
					)}
				</div>
			</Card>
			<StudioBoard items={items} people={people} view={view} weekStart={start.toISOString().slice(0, 10)} channels={config.channels} />
		</>
	);
}
