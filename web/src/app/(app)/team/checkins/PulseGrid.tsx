// 12-week pulse grid — person x week (PEOPLE_PLAN section 9.6 step 4).
//
// The rule that shapes every cell: a week nobody submitted is MISSING, not a
// zero. Missing renders as an empty outlined cell and is excluded from every
// average; only submitted weeks carry a tone. Counts are distinct check-ins.
//
// Server component; the parent already has the series.

import { pulseTone, type WeekPoint } from '@/lib/people/attentionSignals';
import { formatWeekRange } from '@/lib/people/checkinWeeks';

export interface PulseRow {
	personId: string;
	personName: string;
	/** Newest-first, contiguous — same series the signals were computed from. */
	weeks: WeekPoint[];
	needsAttention: boolean;
}

const TONE_CLASS: Record<string, string> = {
	missing: 'border border-dashed border-slate-200 dark:border-slate-700',
	low: 'bg-red-500/80',
	mid: 'bg-amber-400/80',
	high: 'bg-green-500/80',
};

export default function PulseGrid({ rows, weekLabels }: { rows: PulseRow[]; weekLabels: string[] }) {
	// Oldest -> newest reads like a timeline; the series arrives newest-first.
	const columns = [...weekLabels].reverse();

	return (
		<div className="overflow-x-auto">
			<table className="text-sm">
				<thead>
					<tr>
						<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2 sticky left-0 bg-white dark:bg-slate-800">
							Person
						</th>
						{columns.map((w) => (
							<th
								key={w}
								className="text-xs font-medium text-slate-400 dark:text-slate-500 px-1 py-2 w-8"
								title={formatWeekRange(w)}
							>
								{/* Day-of-month of the Friday: enough to scan, short enough to fit */}
								{Number(w.slice(8, 10))}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => {
						const byWeek = new Map(r.weeks.map((w) => [w.weekEnd, w.average]));
						const present = r.weeks.filter((w) => w.average !== null);
						const avg =
							present.length > 0
								? (present.reduce((s, w) => s + (w.average as number), 0) / present.length).toFixed(1)
								: null;
						return (
							<tr
								key={r.personId}
								className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
							>
								<td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-800">
									<span className="text-slate-700 dark:text-slate-300">{r.personName}</span>
									{r.needsAttention && (
										<span className="ml-2 text-2xs text-amber-600 dark:text-amber-400">needs attention</span>
									)}
								</td>
								{columns.map((w) => {
									const average = byWeek.get(w) ?? null;
									const tone = pulseTone(average);
									return (
										<td key={w} className="px-1 py-1.5">
											<div
												className={`w-4 h-4 rounded-sm mx-auto ${TONE_CLASS[tone]}`}
												title={
													average === null
														? `${formatWeekRange(w)} — no check-in`
														: `${formatWeekRange(w)} — ${average.toFixed(1)}/5`
												}
											/>
										</td>
									);
								})}
								<td className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
									{avg ? `${avg} avg · ${present.length}/${r.weeks.length}` : `0/${r.weeks.length}`}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

			<div className="flex items-center gap-4 px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">
				<span className="inline-flex items-center gap-1.5">
					<span className="w-3 h-3 rounded-sm bg-green-500/80" /> 4.0+
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="w-3 h-3 rounded-sm bg-amber-400/80" /> 2.5 – 3.9
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="w-3 h-3 rounded-sm bg-red-500/80" /> below 2.5
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="w-3 h-3 rounded-sm border border-dashed border-slate-300 dark:border-slate-600" /> no check-in
				</span>
			</div>
		</div>
	);
}
