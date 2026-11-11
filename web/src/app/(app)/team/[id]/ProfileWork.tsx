// Profile → Work (Work Revamp spec §4.4): what this person has open across
// every board, read with the viewer's session (RLS decides). Two shapes:
// the Overview card ("Work now": counters + what they lead) and the full
// Work tab (Tasks, then Projects & priorities). Server component.

import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import Card from '@/components/ui/Card';
import { createClient } from '@/lib/supabase/server';
import { loadFormSupportingData } from '@/app/(app)/the-work/_lib';
import { formatShortDate } from '@/components/board/format';
import { FALLBACK_COLOR } from '@/lib/colors';

interface Row { id: string; name: string; kind: string; status: string; ends_at: string | null; parent_id: string | null }

const KIND_LABEL: Record<string, string> = { goal: 'Goal', priority: 'Priority', project: 'Project', task: 'Task', assignment: 'Assignment', campaign: 'Campaign', recurring: 'Recurring', process: 'Process' };

export async function loadProfileWork(personId: string) {
	const supabase = await createClient();
	const { statusesByKind } = await loadFormSupportingData();
	const terminal = [...new Set(Object.values(statusesByKind).flat().filter((s) => s.is_terminal).map((s) => s.slug))];
	const { data } = await supabase
		.from('projects')
		.select('id, name, kind, status, ends_at, parent_id')
		.eq('owner_id', personId)
		.eq('archived', false)
		.not('status', 'in', `(${terminal.join(',') || 'none'})`)
		.order('ends_at', { ascending: true, nullsFirst: false })
		.order('id')
		.range(0, 499);
	const rows = (data ?? []) as Row[];
	const parentIds = [...new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x))].slice(0, 300);
	const containerIds = rows.filter((r) => ['goal', 'priority', 'project', 'campaign'].includes(r.kind)).map((r) => r.id).slice(0, 300);
	const [{ data: parents }, { data: kids }] = await Promise.all([
		parentIds.length ? supabase.from('projects').select('id, name').in('id', parentIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
		containerIds.length ? supabase.from('projects').select('parent_id, kind, status').in('parent_id', containerIds).eq('archived', false).range(0, 4999) : Promise.resolve({ data: [] as { parent_id: string; kind: string; status: string }[] }),
	]);
	const progress = new Map<string, { done: number; total: number }>();
	for (const k of (kids ?? []) as { parent_id: string; kind: string; status: string }[]) {
		if (/discard|archived/.test(k.status)) continue;
		const p = progress.get(k.parent_id) ?? { done: 0, total: 0 };
		p.total++;
		if ((statusesByKind[k.kind] ?? []).some((s) => s.slug === k.status && s.is_terminal)) p.done++;
		progress.set(k.parent_id, p);
	}
	return {
		rows,
		parentName: new Map(((parents ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])),
		statusesByKind,
		progress,
	};
}

type Loaded = Awaited<ReturnType<typeof loadProfileWork>>;

function StatusChip({ data, row }: { data: Loaded; row: Row }) {
	const s = (data.statusesByKind[row.kind] ?? []).find((x) => x.slug === row.status);
	return (
		<span className="inline-block w-24 truncate rounded-md px-2 py-0.5 text-center text-xs font-medium text-white" style={{ background: s?.color ?? FALLBACK_COLOR }}>
			{s?.label ?? row.status}
		</span>
	);
}

export function WorkNowCard({ data, today, personId, isSelf }: { data: Loaded; today: string; personId: string; isSelf: boolean }) {
	const late = data.rows.filter((r) => r.ends_at && r.ends_at < today).length;
	const week = new Date(today); week.setDate(week.getDate() + 7);
	const soon = data.rows.filter((r) => r.ends_at && r.ends_at >= today && r.ends_at <= week.toISOString().slice(0, 10)).length;
	const leads = data.rows.filter((r) => ['goal', 'priority', 'project', 'campaign'].includes(r.kind)).slice(0, 6);
	return (
		<Card>
			<div className="mb-3 flex items-center gap-2">
				<FolderKanban className="w-4 h-4" aria-hidden="true" />
				<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">Work now</h2>
				<Link href={isSelf ? '/?tab=work' : `/team/${personId}?tab=work`} className="ml-auto text-xs font-medium text-primary-700 hover:underline dark:text-primary-400">See all</Link>
			</div>
			<div className="grid grid-cols-3 gap-2">
				{[['Open', data.rows.length, ''], ['Overdue', late, late ? 'text-red-600 dark:text-red-400' : ''], ['Next 7 days', soon, '']].map(([l, v, tone]) => (
					<div key={l as string} className="rounded-md bg-slate-50 dark:bg-slate-900 px-3 py-2">
						<div className="text-2xs text-slate-500">{l}</div>
						<div className={`text-lg font-bold tabular-nums ${tone}`}>{v}</div>
					</div>
				))}
			</div>
			{leads.length > 0 && (
				<>
					<div className="mt-3 mb-1 text-2xs font-medium uppercase tracking-wide text-slate-500">Leads</div>
					<ul>
						{leads.map((r) => {
							const p = data.progress.get(r.id);
							const pct = p && p.total ? Math.round((p.done / p.total) * 100) : null;
							return (
								<li key={r.id}>
									<Link href={`/the-work/${r.id}`} className="flex h-9 items-center gap-2 rounded-md px-1 text-sm hover:bg-hover">
										<StatusChip data={data} row={r} />
										<span className="min-w-0 truncate">{r.name}</span>
										<span className="ml-auto shrink-0 text-xs text-slate-500">{KIND_LABEL[r.kind] ?? r.kind}{pct !== null ? ` · ${pct}%` : ''}</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</>
			)}
		</Card>
	);
}

export function WorkTab({ data, today, firstName, isSelf }: { data: Loaded; today: string; firstName: string; isSelf: boolean }) {
	const sections: [string, Row[]][] = [
		['Tasks', data.rows.filter((r) => r.kind === 'task' || r.kind === 'assignment')],
		['Projects and priorities', data.rows.filter((r) => r.kind !== 'task' && r.kind !== 'assignment')],
	];
	return (
		<div className="space-y-4">
			<p className="text-sm text-slate-600 dark:text-slate-400">
				{isSelf ? <>The same items as <Link href="/?tab=work" className="text-primary-700 hover:underline dark:text-primary-400">Self → My work</Link>, seen from your profile.</> : <>What {firstName} has open across every board.</>}
			</p>
			{sections.map(([title, rows]) => (
				<Card key={title} padding="none">
					<h2 className="border-b border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold">{title} <span className="font-normal text-slate-500 tabular-nums">{rows.length}</span></h2>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[640px] table-fixed text-sm">
							<colgroup><col /><col style={{ width: 120 }} /><col style={{ width: 220 }} /><col style={{ width: 120 }} /><col style={{ width: 90 }} /></colgroup>
							<thead>
								<tr className="text-xs text-slate-600 dark:text-slate-400">
									<th className="px-4 py-2 text-left font-medium">Item</th><th className="font-medium">Type</th><th className="text-left font-medium">Parent</th><th className="font-medium">Status</th><th className="font-medium">Due</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover">
										<td className="px-4 py-2"><Link href={`/the-work/${r.id}`} className="block truncate hover:underline">{r.name}</Link></td>
										<td className="text-center text-xs text-slate-600 dark:text-slate-400">{KIND_LABEL[r.kind] ?? r.kind}</td>
										<td className="truncate text-slate-600 dark:text-slate-400">{r.parent_id ? data.parentName.get(r.parent_id) ?? '—' : '—'}</td>
										<td className="text-center"><StatusChip data={data} row={r} /></td>
										<td className={`text-center text-xs tabular-nums ${r.ends_at && r.ends_at < today ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-400'}`}>{r.ends_at ? formatShortDate(r.ends_at) : '—'}</td>
									</tr>
								))}
								{!rows.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">Nothing open.</td></tr>}
							</tbody>
						</table>
					</div>
				</Card>
			))}
		</div>
	);
}
