// /the-work/planning — Planning (rework D10, 5.4).
//
// Top: the Pending tile, collapsed by default, with the count of every item
// in backlog status across all kinds; expanding it (?pending=1) shows the
// list on the hub's own screen and toolbar, so an item gets an owner, a
// quarter, a parent or a status in one click. Below: the creation tool with
// every field per kind (Create, or Create and open). Quick create stays
// everywhere else (Ctrl K, + New, inline add rows).

import Link from 'next/link';
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import RequestButton from '@/components/nav/RequestButton';
import { createClient } from '@/lib/supabase/server';
import { PENDING_DEF } from '@/lib/work/hub/tabs';
import { KIND_LABELS } from '@/lib/work/boards/groups';
import { loadFormSupportingData } from '../_lib';
import WorkItemForm from '../WorkItemForm';
import HubPage, { type HubSearchParams } from '../_hub/HubPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Planning' };

const CREATE_KINDS = ['priority', 'project', 'task', 'goal', 'process', 'recurring', 'bug', 'target'];
const KIND_HINT: Record<string, string> = {
	priority: 'Quarterly focus', project: 'Deliverable work', task: 'One piece of work', goal: 'Annual aspiration',
	process: 'SOP / playbook', recurring: 'Cadence-driven', bug: 'Something broken', target: 'Metric to hit',
};

export default async function PlanningPage({ searchParams }: { searchParams: HubSearchParams }) {
	const sp = await searchParams;
	const kindParam = typeof sp.kind === 'string' ? sp.kind : undefined;
	const defaultKind = kindParam && /^[a-z_]+$/.test(kindParam) ? kindParam : 'priority';
	const expanded = sp.pending === '1';

	const supabase = await createClient();
	const [support, pending] = await Promise.all([
		loadFormSupportingData(),
		supabase.from('projects').select('id', { count: 'exact', head: true }).in('kind', PENDING_DEF.kinds).eq('archived', false).eq('status', 'backlog'),
	]);
	const pendingCount = pending.count ?? 0;
	const keep = new URLSearchParams();
	if (kindParam) keep.set('kind', kindParam);

	return (
		<div className="space-y-4">
			<PageHeader
				className="mb-0"
				title="Planning"
				description="What is waiting to be planned, and the full form for new work."
				actions={<RequestButton label="Request a project" option="Project / task for another team" variant="outline" />}
			/>

			<section aria-label="Pending" className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
				<Link
					href={`/the-work/planning${expanded ? (keep.toString() ? `?${keep}` : '') : `?${new URLSearchParams({ ...Object.fromEntries(keep), pending: '1' })}`}`}
					scroll={false}
					aria-expanded={expanded}
					className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors duration-150 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
				>
					{expanded ? <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />}
					<Inbox className="h-4 w-4 text-primary-600" aria-hidden="true" />
					<span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pending</span>
					<span className="rounded-full bg-primary-50 px-2 text-xs font-semibold tabular-nums text-primary-900 dark:bg-primary-950 dark:text-primary-300">{pendingCount.toLocaleString()}</span>
					<span className="text-xs text-slate-600 dark:text-slate-400">items in backlog across every type, waiting for an owner, a quarter, a parent or a status</span>
				</Link>
				{expanded && (
					<div className="border-t border-slate-200 p-3 dark:border-slate-700">
						<HubPage mode="pending" hubKey="pending" searchParams={searchParams} embedded />
					</div>
				)}
			</section>

			<div className="flex flex-wrap gap-1.5" role="group" aria-label="What to create">
				{CREATE_KINDS.map((k) => {
					const active = k === defaultKind;
					return (
						<Link key={k} href={`/the-work/planning?kind=${k}${expanded ? '&pending=1' : ''}`} scroll={false}
							className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors duration-150 ${active
								? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-300'
								: 'border-slate-300 text-slate-700 hover:bg-hover dark:border-slate-600 dark:text-slate-300'}`}>
							New {(KIND_LABELS[k] ?? k).toLowerCase()} <span className="opacity-70">· {KIND_HINT[k]}</span>
						</Link>
					);
				})}
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2">
					<Card>
						<WorkItemForm
							key={defaultKind}
							mode="create"
							defaultKind={defaultKind}
							profiles={support.profiles}
							tags={support.tags}
							quarters={support.quarters}
							statusesByKind={support.statusesByKind}
							parentOptions={support.parentCandidates}
						/>
					</Card>
				</div>
				<Card>
					<h3 className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">Tips</h3>
					<ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
						<li><span className="font-medium text-slate-800 dark:text-slate-200">Priority</span> is the quarterly focus tier (3 to 7 per quarter).</li>
						<li>Lead measure = what you&apos;ll do weekly. Lag measure = the outcome metric.</li>
						<li>The chain is strict: Goal → Priority → Project → Task. Tasks have no children.</li>
						<li>Anything you are not ready to schedule can sit in Backlog; it shows in Pending above.</li>
					</ul>
				</Card>
			</div>
		</div>
	);
}
