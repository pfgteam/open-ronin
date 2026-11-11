// The Open Ronin side of /clients/deliverables: one row per in-scope, non-Beacon
// contract, this month's secured opps against the goal of record. Every
// number is a mirror column (0046 / 0071 / health_scores); the only
// arithmetic is pace (lib/delivery/pace) and a percentage. Zero Airtable.

import Link from 'next/link';
import { Check, ChevronRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { monthLabel } from '@/lib/clients/analytics';
import { filterBoardRows, type BoardRow, type PaceFilter } from '@/lib/delivery/board';
import { asOfForMonth, monthProgress } from '@/lib/delivery/pace';
import type { DeliveryBoard as Board } from '@/lib/delivery/server';
import { formatDate } from '@/lib/format';
import { healthTone } from '@/lib/health/shared';
import { Kpi } from '../analytics/_ui';
import PaceChips from './PaceChips';

const BASE = '/clients/deliverables';

function PaceBadge({ pace }: { pace: BoardRow['pace'] }) {
	switch (pace) {
		case 'met':
			return (
				<Badge color="success">
					<Check className="w-3 h-3" aria-hidden />
					Goal met
				</Badge>
			);
		case 'onpace':
			return (
				<Badge color="success">
					<TrendingUp className="w-3 h-3" aria-hidden />
					On pace
				</Badge>
			);
		case 'behind':
			return (
				<Badge color="danger">
					<TrendingDown className="w-3 h-3" aria-hidden />
					Behind
				</Badge>
			);
		default:
			return (
				<Badge color="default">
					<Minus className="w-3 h-3" aria-hidden />
					No goal
				</Badge>
			);
	}
}

/** Secured against goal as a bar, with the linear-pace marker; dimmed when there is no goal. */
function GoalBar({ row, progress }: { row: BoardRow; progress: number }) {
	const hasGoal = row.goal != null && row.goal > 0;
	const pct = hasGoal ? Math.min(100, (row.secured / (row.goal as number)) * 100) : Math.min(100, row.secured * 4);
	const fill = !hasGoal ? 'bg-primary-200 dark:bg-primary-800' : row.pace === 'met' ? 'bg-green-500' : 'bg-primary-500';
	return (
		<div className="grid grid-cols-[auto_1fr] items-center gap-2.5 min-w-[180px]">
			<span className="text-sm font-medium tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
				{row.secured} <span className="text-slate-500 dark:text-slate-400 font-normal">/ {hasGoal ? row.goal : '—'}</span>
			</span>
			<div
				className="relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-700"
				role="img"
				aria-label={
					hasGoal
						? `${row.secured} of ${row.goal} secured, pace marker at ${Math.round(progress * 100)}%`
						: `${row.secured} secured, no goal`
				}
			>
				<div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${pct}%` }} />
				{hasGoal && (
					<div
						className="absolute -inset-y-[3px] w-0.5 rounded-sm bg-slate-700 dark:bg-slate-200"
						style={{ left: `${Math.round(progress * 100)}%` }}
						aria-hidden
					/>
				)}
			</div>
		</div>
	);
}

function Spark({ values, months }: { values: number[]; months: string[] }) {
	const max = Math.max(1, ...values);
	const title = values.map((v, i) => `${monthLabel(months[i])} ${v}`).join(' · ');
	return (
		<span className="inline-flex items-end gap-[3px] h-[22px] w-11" title={title} aria-label={title}>
			{values.map((v, i) => (
				<i
					key={months[i]}
					className={`block flex-1 rounded-t-sm ${i === values.length - 1 ? 'bg-primary-500' : 'bg-primary-200 dark:bg-primary-800'}`}
					style={{ height: `${Math.max(2, Math.round((v / max) * 22))}px` }}
				/>
			))}
		</span>
	);
}

function Health({ score }: { score: number | null }) {
	if (score == null) return <span className="text-slate-400">—</span>;
	const tone = healthTone(score);
	const dot = tone === 'success' ? 'bg-green-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-red-500';
	return (
		<span className="inline-flex items-center gap-1.5 tabular-nums">
			<span className={`inline-block w-2 h-2 rounded-full ${dot}`} aria-hidden />
			{score}
		</span>
	);
}

const th = 'px-3 py-2.5 text-left text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 whitespace-nowrap';
const td = 'px-3 py-2.5 align-middle';

export default function DeliveryBoard({ board, pace }: { board: Board; pace: PaceFilter }) {
	const rows = filterBoardRows(board.rows, pace);
	const progress = monthProgress(asOfForMonth(board.month, new Date()));
	const withGoal = board.rows.filter((r) => r.goal != null && r.goal > 0);
	const secured = board.rows.reduce((s, r) => s + r.secured, 0);
	const live = board.rows.reduce((s, r) => s + r.live, 0);
	const goalTotal = withGoal.reduce((s, r) => s + (r.goal ?? 0), 0);
	const unsynced = board.rows.filter((r) => !r.synced).length;
	const monthIso = `${board.month}-01`;

	return (
		<>
			{board.error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {board.error}
					</p>
				</Card>
			)}

			<div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
				<Kpi
					label={`Secured · ${monthLabel(monthIso)}`}
					value={secured}
					hint={`vs ${goalTotal} goal of record · ${withGoal.length} contracts with a goal`}
				/>
				<Kpi label="Live" value={live} hint="Live Link present, any status" />
				<Kpi label="Goal met" value={board.counts.met} hint={`of ${withGoal.length} · ${board.counts.onpace} more on pace`} />
				<Kpi
					label="Behind pace"
					value={<span className="text-red-700 dark:text-red-400">{board.counts.behind}</span>}
					hint={`${board.counts.zero} with no opps at all`}
				/>
				<Kpi
					label="No goal set"
					value={<span className="text-amber-700 dark:text-amber-400">{board.counts.nogoal}</span>}
					hint="packages outside the R1 ladder"
				/>
			</div>

			<div className="flex flex-wrap items-center gap-3 mb-3">
				<PaceChips counts={board.counts} active={pace} basePath={BASE} />
				<span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
					Pace marker = where secured should be {Math.round(progress * 100)}% into the month
				</span>
			</div>

			{unsynced > 0 && (
				<p className="text-2xs text-amber-700 dark:text-amber-400 mb-3">
					{unsynced} contract{unsynced === 1 ? '' : 's'} with no mirror row for this month — shown as 0, not a confirmed
					zero. Run <code className="text-2xs">scripts/import-opp-months.ts</code>.
				</p>
			)}

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm min-w-[860px]">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className={th}>Client</th>
								<th className={th}>Secured vs goal of record</th>
								<th className={`${th} text-right`}>Live</th>
								<th className={th}>Pace</th>
								<th className={th}>
									{monthLabel(board.months[0])} → {monthLabel(board.months[board.months.length - 1])}
								</th>
								<th className={th}>Health</th>
								<th className={th}>
									<span className="sr-only">Open</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.length === 0 ? (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
										No contracts match this filter.
									</td>
								</tr>
							) : (
								rows.map((r) => (
									<tr
										key={r.contractId}
										className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
									>
										<td className={td}>
											<Link
												href={`/clients/${r.clientId}/delivery?month=${board.month}`}
												className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
											>
												{r.name}
											</Link>
											<span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
												{r.package ?? '—'}
												{r.status !== 'active' ? ` · ${r.status}` : ''}
											</span>
										</td>
										<td className={td}>
											<GoalBar row={r} progress={progress} />
										</td>
										<td className={`${td} text-right tabular-nums`}>{r.live}</td>
										<td className={td}>
											<PaceBadge pace={r.pace} />
										</td>
										<td className={td}>
											<Spark values={r.trend} months={board.months} />
										</td>
										<td className={td}>
											<Health score={r.health} />
										</td>
										<td className={`${td} text-right`}>
											<Link
												href={`/clients/${r.clientId}/delivery?month=${board.month}`}
												aria-label={`Open ${r.name}`}
												className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
											>
												<ChevronRight className="w-4 h-4 inline" />
											</Link>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
				<p className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
					Sorted so attention lands first: behind pace → no opps → no goal → on pace → goal met.
					{board.syncedAt && <> Mirror synced {formatDate(board.syncedAt, 'MMM d, HH:mm')}.</>}
				</p>
			</Card>
		</>
	);
}
