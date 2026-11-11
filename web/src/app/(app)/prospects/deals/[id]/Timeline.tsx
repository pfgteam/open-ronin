// The deal's timeline: logged activities, newest first, one page at a time
// (TIMELINE_PAGE_SIZE, `?tl=` in the URL; the page reads it and loads only
// that slice). Moved out of page.tsx for spec 2026-10-20 §4.3.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Pagination from '@/components/ui/Pagination';
import { formatDate, formatRelative } from '@/lib/format';
import { TIMELINE_PAGE_SIZE } from '@/lib/pagination';
import { ACTIVITY_KIND_LABELS, type ActivityRow, type DispositionRow } from '@/lib/revenue/shared';

export default function Timeline({ activities, total, page, hrefFor, dispositions, touches30d, who }: {
	activities: ActivityRow[];
	/** Every activity on the deal, not just this page. */
	total: number;
	page: number;
	hrefFor: (page: number) => string;
	dispositions: DispositionRow[];
	touches30d: number;
	who: (id: string | null) => string;
}) {
	return (
		<Card padding="none" id="timeline" className="scroll-mt-4">
			<div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Timeline</h2>
				<span className="text-2xs text-slate-500">
					{total.toLocaleString()} activit{total === 1 ? 'y' : 'ies'} · {touches30d} touch{touches30d === 1 ? '' : 'es'} in 30 days
				</span>
			</div>
			{activities.length === 0 ? (
				<p className="px-4 py-6 text-sm text-slate-500">Nothing logged yet.</p>
			) : (
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{activities.map((a) => {
						const disp = a.disposition_id ? dispositions.find((d) => d.id === a.disposition_id) : null;
						return (
							<li key={a.id} className="flex gap-3 px-4 py-3">
								<div className="w-20 shrink-0 pt-0.5 text-2xs text-slate-500">
									<div>{formatRelative(a.occurred_at)}</div>
									<div className="text-slate-400">{formatDate(a.occurred_at, 'MMM d, HH:mm')}</div>
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 text-xs">
										<Badge color={a.is_positive ? 'success' : a.kind === 'stage_change' ? 'primary' : 'default'}>{ACTIVITY_KIND_LABELS[a.kind]}</Badge>
										{a.channel && <span className="text-slate-500">{a.channel}</span>}
										{a.direction && a.direction !== 'internal' && <span className="text-slate-400">{a.direction}</span>}
										{disp && <span className="font-medium text-slate-700 dark:text-slate-300">{disp.name}</span>}
										<span className="ml-auto text-slate-500">{a.actor_kind === 'human' ? who(a.actor_id) : a.actor_kind}</span>
									</div>
									{a.subject && <div className="mt-1 text-sm text-slate-900 dark:text-slate-100">{a.subject}</div>}
									{a.body_md && <div className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{a.body_md}</div>}
									{a.recording_url && (
										<a href={a.recording_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary-700 underline dark:text-primary-300">
											Recording
										</a>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{total > TIMELINE_PAGE_SIZE && <Pagination page={page} size={TIMELINE_PAGE_SIZE} total={total} hrefFor={hrefFor} />}
		</Card>
	);
}
