// The Beacon side of /clients/deliverables — today's Beacon Delivery Tracker
// table, unchanged. Source: Client Central → Beacon Delivery Tracker. Each
// row hangs off a Beacon Monthly whose Month End is the deliverable's month;
// `requested` (YYYY-MM) slices the table to that month.

import Card from '@/components/ui/Card';
import { BASE_IDS, DataAdapterError, type DataRecord } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { formatPercent } from '@/lib/format';
import type { MonthOption } from './MonthSelect';

interface DeliveryFields {
	Name?: string;
	Notes?: string;
	Assignee?: { id: string; name?: string };
	'Progress Bar'?: string;
	'Progress %'?: number;
	'Linked Beacon Monthly'?: { id: string; name?: string }[];
	'Client (from Linked Beacon Monthly)'?: unknown[];
	'Paid Date (from Linked Beacon Monthly)'?: unknown[];
	'Month End (from Linked Beacon Monthly)'?: unknown[];
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** First Month End lookup value as YYYY-MM, or null when the row has none. */
function monthKey(row: DataRecord<DeliveryFields>): string | null {
	const raw = row.fields['Month End (from Linked Beacon Monthly)']?.[0];
	if (typeof raw !== 'string' || raw.length < 7) return null;
	const key = raw.slice(0, 7);
	return MONTH_RE.test(key) ? key : null;
}

function trackerMonthLabel(key: string): string {
	const [y, m] = key.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});
}

async function fetchDelivery() {
	try {
		const { rows } = await listFullTable<DeliveryFields>(BASE_IDS.CLIENT_CENTRAL, 'Beacon Delivery Tracker');
		return { rows, error: null as string | null };
	} catch (e) {
		return {
			rows: [],
			error:
				e instanceof DataAdapterError
					? `${e.status} — ${e.message}`
					: e instanceof Error
						? e.message
						: String(e),
		};
	}
}

/** Months present in the tracker, newest first, for the page header's selector. */
export async function beaconMonths(): Promise<MonthOption[]> {
	const { rows } = await fetchDelivery();
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = monthKey(row);
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return Array.from(counts.entries())
		.sort((a, b) => (a[0] < b[0] ? 1 : -1))
		.map(([value, count]) => ({ value, label: trackerMonthLabel(value), count }));
}

export default async function BeaconTracker({ requested }: { requested: string | null }) {
	const { rows, error } = await fetchDelivery();
	let unlinked = 0;
	for (const row of rows) if (!monthKey(row)) unlinked++;
	const visible = requested ? rows.filter((r) => monthKey(r) === requested) : rows;

	return (
		<>
			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error}
					</p>
				</Card>
			)}

			{!requested && unlinked > 0 && (
				<p className="text-2xs text-slate-600 dark:text-slate-400 mb-3">
					{unlinked} tracker{unlinked === 1 ? '' : 's'} with no linked Beacon Monthly (no month; shown only under All months).
				</p>
			)}

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Tracker</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Month</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Assignee</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Progress</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">%</th>
							</tr>
						</thead>
						<tbody>
							{visible.length === 0 ? (
								<tr>
									<td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
										{requested ? `No deliverables for ${trackerMonthLabel(requested)}.` : 'No deliverables on file.'}
									</td>
								</tr>
							) : (
								visible.slice(0, 200).map((row) => {
									const f = row.fields;
									// Airtable's Progress % formula is percent-scale (100, 56.25),
									// while formatPercent and the bar expect a 0–1 fraction —
									// same trap the Delivery dashboard hit ("Avg delivery 8,177.7%").
									const pct = (f['Progress %'] ?? 0) / 100;
									const key = monthKey(row);
									return (
										<tr
											key={row.id}
											className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
										>
											<td className="px-4 py-3 text-slate-700 dark:text-slate-300">{f.Name ?? '—'}</td>
											<td className="px-4 py-3 text-slate-500 whitespace-nowrap">{key ? trackerMonthLabel(key) : '—'}</td>
											<td className="px-4 py-3 text-slate-500 truncate max-w-[160px]">{f.Assignee?.name ?? '—'}</td>
											<td className="px-4 py-3">
												<div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full w-32 overflow-hidden">
													<div
														className={`h-full rounded-full ${pct >= 1 ? 'bg-green-500' : pct >= 0.75 ? 'bg-amber-500' : 'bg-primary-500'}`}
														style={{ width: `${Math.min(100, pct * 100)}%` }}
													/>
												</div>
											</td>
											<td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">{formatPercent(pct)}</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</Card>
		</>
	);
}
