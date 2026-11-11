// /the-work/overview — module overview (spec §4.2 screen 1): company KPIs, goals with
// rollup progress, what's overdue, and the boards. Personal work lives in
// Self; this page is the company view. Until migration 0141 is applied (no
// boards yet) it keeps the old behaviour and lands on Priorities.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, CircleUser, LayoutList, Star, Target } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadFormSupportingData } from '../_lib';
import { loadBoardNav } from '@/lib/work/boards/load';
import { BOARD_SECTIONS } from '@/lib/work/boards/types';
import { formatShortDate } from '@/components/board/format';
import { GROUP_COLORS } from '@/lib/work/boards/groups';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Work' };

const GOAL_COLORS = GROUP_COLORS;

export default async function TheWorkOverviewPage() {
	const nav = await loadBoardNav();
	if (!nav.ready) redirect('/the-work/priorities');

	const supabase = await createClient();
	const { statusesByKind, profiles } = await loadFormSupportingData();
	const terminal = (kind: string) => (statusesByKind[kind] ?? []).filter((s) => s.is_terminal).map((s) => s.slug);
	const doneSlug = (kind: string, slug: string) =>
		(statusesByKind[kind] ?? []).some((s) => s.slug === slug && s.is_terminal) && !/discard|archived|abandoned/.test(slug);
	const today = new Date().toISOString().slice(0, 10);
	const notIn = (k: string) => `(${terminal(k).join(',') || 'none'})`;

	const [goals, priorities, projects, overdue, blocked, pendingRequests] = await Promise.all([
		supabase.from('projects').select('id, name').eq('kind', 'goal').eq('archived', false).not('status', 'in', notIn('goal')).order('name').range(0, 49),
		supabase.from('projects').select('id, name, parent_id, status').eq('kind', 'priority').eq('archived', false).range(0, 499),
		supabase.from('projects').select('id, parent_id, status').eq('kind', 'project').eq('archived', false).range(0, 1999),
		supabase.from('projects').select('id, name, kind, owner_id, ends_at').in('kind', ['project', 'task']).eq('archived', false)
			.lt('ends_at', today).not('status', 'in', notIn('task')).order('ends_at', { ascending: true }).order('id').range(0, 7),
		supabase.from('projects').select('id', { count: 'exact', head: true }).in('kind', ['project', 'task']).eq('archived', false).eq('status', 'blocked'),
		supabase.from('staff_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
	]);
	const overdueCount = await supabase.from('projects').select('id', { count: 'exact', head: true }).in('kind', ['project', 'task'])
		.eq('archived', false).lt('ends_at', today).not('status', 'in', notIn('task'));

	// Rollup: project done ratio → priority progress → goal = mean of its priorities.
	const projByPriority = new Map<string, { done: number; total: number }>();
	for (const p of projects.data ?? []) {
		if (!p.parent_id || /discard/.test(p.status as string)) continue;
		const cur = projByPriority.get(p.parent_id as string) ?? { done: 0, total: 0 };
		cur.total++;
		if (doneSlug('project', p.status as string)) cur.done++;
		projByPriority.set(p.parent_id as string, cur);
	}
	const prioProgress = (pr: { id: string; status: string }) => {
		const r = projByPriority.get(pr.id);
		if (r && r.total) return (r.done / r.total) * 100;
		return doneSlug('priority', pr.status) ? 100 : 0;
	};
	const goalRows = (goals.data ?? []).map((g, i) => {
		const prs = (priorities.data ?? []).filter((p) => p.parent_id === g.id) as { id: string; status: string }[];
		const pct = prs.length ? Math.round(prs.reduce((a, p) => a + prioProgress(p), 0) / prs.length) : 0;
		return { id: g.id as string, name: g.name as string, count: prs.length, pct, color: GOAL_COLORS[i % GOAL_COLORS.length] };
	}).sort((a, b) => b.count - a.count).slice(0, 8);

	const activeProjects = (projects.data ?? []).filter((p) => !terminal('project').includes(p.status as string)).length;
	const nameOf = new Map((profiles as { id: string; first_name: string | null; last_name: string | null; email: string }[])
		.map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email]));
	const kpis = [
		{ label: 'Active projects', value: activeProjects, tone: '' },
		{ label: 'Overdue', value: overdueCount.count ?? 0, tone: 'text-red-600 dark:text-red-400' },
		{ label: 'Blocked', value: blocked.count ?? 0, tone: 'text-red-600 dark:text-red-400' },
		{ label: 'Pending requests', value: pendingRequests.count ?? 0, tone: '' },
	];

	const favorites = nav.boards.filter((b) => b.favorite);

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">The Work</h1>
				<p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">The company view. Your own work is in <Link href="/?tab=work" className="text-primary-700 hover:underline dark:text-primary-400">Self → My work</Link>.</p>
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{kpis.map((k) => (
					<div key={k.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
						<div className="text-xs text-slate-600 dark:text-slate-400">{k.label}</div>
						<div className={`text-2xl font-bold tabular-nums tracking-tight ${k.tone}`}>{k.value}</div>
					</div>
				))}
			</div>

			<div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
				<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 lg:col-span-2" aria-labelledby="goals-h">
					<header className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
						<Target className="w-4 h-4" aria-hidden="true" />
						<h2 id="goals-h" className="text-sm font-semibold">Goals</h2>
						<span className="text-xs text-slate-500">progress = average of their priorities</span>
						<Link href="/the-work/b/goals-priorities" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline dark:text-primary-400">Goals & Priorities<ArrowRight className="w-3 h-3" aria-hidden="true" /></Link>
					</header>
					<ul className="px-4 py-2">
						{goalRows.map((g) => (
							<li key={g.id} className="py-2">
								<div className="flex items-baseline justify-between gap-2 text-sm">
									<Link href={`/the-work/${g.id}`} className="truncate hover:underline">{g.name}</Link>
									<span className="shrink-0 tabular-nums font-semibold">{g.pct}%<span className="ml-2 text-xs font-normal text-slate-500">{g.count} {g.count === 1 ? 'priority' : 'priorities'}</span></span>
								</div>
								<div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
									<div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: g.color }} />
								</div>
							</li>
						))}
						{!goalRows.length && <li className="py-6 text-sm text-slate-500">No open goals.</li>}
					</ul>
				</section>

				<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 lg:col-span-2" aria-labelledby="late-h">
					<header className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
						<AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" />
						<h2 id="late-h" className="text-sm font-semibold">Overdue</h2>
						<span className="text-xs text-slate-500 tabular-nums">{overdueCount.count ?? 0} projects and tasks</span>
					</header>
					<ul className="px-2 py-1">
						{(overdue.data ?? []).map((r) => (
							<li key={r.id as string}>
								<Link href={`/the-work/${r.id}`} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-hover">
									<span className="truncate">{r.name as string}</span>
									<span className="ml-auto shrink-0 text-xs text-slate-500">{r.owner_id ? nameOf.get(r.owner_id as string) : 'No owner'}</span>
									<span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">{formatShortDate(r.ends_at as string)}</span>
								</Link>
							</li>
						))}
						{!(overdue.data ?? []).length && <li className="px-2 py-6 text-sm text-slate-500">Nothing overdue.</li>}
					</ul>
				</section>
			</div>

			<section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" aria-labelledby="boards-h">
				<header className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
					<LayoutList className="w-4 h-4" aria-hidden="true" />
					<h2 id="boards-h" className="text-sm font-semibold">Boards</h2>
					<Link href="/the-work/boards/new" className="ml-auto text-xs font-medium text-primary-700 hover:underline dark:text-primary-400">+ New board</Link>
				</header>
				<div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
					{favorites.length > 0 && (
						<div>
							<h3 className="mb-1 flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-slate-500"><Star className="w-3 h-3" aria-hidden="true" />Favorites</h3>
							<ul>{favorites.map((b) => <li key={b.id}><Link href={`/the-work/b/${b.slug}`} className="block rounded-md px-2 py-1 text-sm hover:bg-hover">{b.name}</Link></li>)}</ul>
						</div>
					)}
					{BOARD_SECTIONS.map((s) => {
						const list = nav.boards.filter((b) => b.section === s.key);
						if (!list.length) return null;
						return (
							<div key={s.key}>
								<h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-slate-500">{s.label}</h3>
								<ul>{list.map((b) => <li key={b.id}><Link href={`/the-work/b/${b.slug}`} className="block rounded-md px-2 py-1 text-sm hover:bg-hover">{b.name}</Link></li>)}</ul>
							</div>
						);
					})}
				</div>
			</section>

			<Link href="/" className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm hover:bg-hover">
				<CircleUser className="w-4 h-4" aria-hidden="true" />
				<span><span className="font-semibold">Your own work is in Self.</span> <span className="text-slate-600 dark:text-slate-400">Everything you own across boards, by date.</span></span>
				<ArrowRight className="ml-auto w-4 h-4 text-slate-400" aria-hidden="true" />
			</Link>
		</div>
	);
}
