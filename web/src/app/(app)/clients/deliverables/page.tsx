// /clients/deliverables — delivery tracking, two portfolios.
//
// Open Ronin (default): the Media Opps delivery board — in-scope, non-Beacon
// contracts, this month's secured opps vs the goal of record, from the
// Supabase mirror only. Beacon: the Beacon Delivery Tracker table read live
// from Client Central, exactly as before. ?view=beacon switches; ?month and
// ?pace are the board's filters, ?month also slices the Beacon table.

import { Suspense } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { trendMonths } from '@/lib/clients/analytics';
import type { PaceFilter } from '@/lib/delivery/board';
import { currentMonth, isMonthParam, loadDeliveryBoard, monthTitle } from '@/lib/delivery/server';
import DeliveryBoard from './DeliveryBoard';
import MonthSelect, { type MonthOption } from './MonthSelect';
import BeaconTracker, { beaconMonths } from './BeaconTracker';

export const metadata = { title: 'Deliverables' };
export const dynamic = 'force-dynamic';

const BASE = '/clients/deliverables';
const PACES: PaceFilter[] = ['all', 'behind', 'zero', 'nogoal', 'onpace', 'met'];

function ViewToggle({ view }: { view: 'main' | 'beacon' }) {
	const cls = (active: boolean) =>
		`px-3 py-1.5 text-xs font-medium transition-colors ${
			active
				? 'bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
				: 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/45'
		}`;
	return (
		<div
			className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden"
			role="group"
			aria-label="Portfolio"
		>
			<Link href={BASE} aria-current={view === 'main' ? 'page' : undefined} className={cls(view === 'main')}>
				Open Ronin
			</Link>
			<Link
				href={`${BASE}?view=beacon`}
				aria-current={view === 'beacon' ? 'page' : undefined}
				className={`${cls(view === 'beacon')} border-l border-slate-200 dark:border-slate-700`}
			>
				Beacon
			</Link>
		</div>
	);
}

export default async function DeliverablesPage({
	searchParams,
}: {
	searchParams: Promise<{ view?: string; month?: string; pace?: string }>;
}) {
	const sp = await searchParams;
	const view = sp.view === 'beacon' ? 'beacon' : 'main';

	if (view === 'beacon') {
		const requested = isMonthParam(sp.month) ? sp.month : null;
		const months = await beaconMonths();
		return (
			<>
				<PageHeader
					title="Deliverables"
					description={
						requested
							? `Beacon · ${monthTitle(requested)}`
							: 'Beacon · live from Airtable · Client Central · Beacon Delivery Tracker'
					}
					actions={
						<div className="flex items-center gap-2">
							<ViewToggle view="beacon" />
							{/* useSearchParams keeps ?view=beacon across a month change. */}
							<Suspense fallback={null}>
								<MonthSelect months={months} selected={requested} basePath={BASE} />
							</Suspense>
						</div>
					}
				/>
				<BeaconTracker requested={requested} />
			</>
		);
	}

	const month = isMonthParam(sp.month) ? sp.month : currentMonth();
	const pace: PaceFilter = PACES.includes(sp.pace as PaceFilter) ? (sp.pace as PaceFilter) : 'all';
	const board = await loadDeliveryBoard(month);
	// Twelve months back, newest first, for the selector; no counts (there is always a month).
	const options: MonthOption[] = trendMonths(new Date(), 12)
		.reverse()
		.map((iso) => ({ value: iso.slice(0, 7), label: monthTitle(iso.slice(0, 7)), count: 0 }));

	return (
		<>
			<PageHeader
				title="Deliverables"
				description={`${monthTitle(month)} · ${board.rows.length} active Open Ronin contracts · secured media opps vs goal of record`}
				actions={
					<div className="flex items-center gap-2">
						<ViewToggle view="main" />
						<Suspense fallback={null}>
							<MonthSelect months={options} selected={month} basePath={BASE} allLabel={null} />
						</Suspense>
					</div>
				}
			/>
			<DeliveryBoard board={board} pace={pace} />
		</>
	);
}
