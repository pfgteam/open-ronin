'use client';

// Month selector for the Deliverables pages — writes ?month=YYYY-MM under
// `basePath`, preserving every other param (so ?view=beacon and ?pace=
// survive a month change). `allLabel` renders the empty "all months" option;
// pass null where there is always a month (the board, the Delivery tab).

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import Select from '@/components/ui/Select';

export interface MonthOption {
	/** YYYY-MM */
	value: string;
	/** e.g. "September 2026" */
	label: string;
	/** Rows in that month; 0 hides the count. */
	count: number;
}

export default function MonthSelect({
	months,
	selected,
	basePath,
	allLabel = 'All months',
}: {
	months: MonthOption[];
	selected: string | null;
	basePath: string;
	allLabel?: string | null;
}) {
	const router = useRouter();
	const params = useSearchParams();
	const [pending, startTransition] = useTransition();

	function change(value: string) {
		const next = new URLSearchParams(params.toString());
		if (value) next.set('month', value);
		else next.delete('month');
		const qs = next.toString();
		startTransition(() => router.replace(qs ? `${basePath}?${qs}` : basePath));
	}

	return (
		<div className="inline-flex items-center gap-2">
			<span className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Month</span>
			<Select
				size="sm"
				aria-label="Filter by month"
				value={selected ?? ''}
				disabled={pending}
				onChange={(e) => change(e.target.value)}
			>
				{allLabel != null && <option value="">{allLabel}</option>}
				{months.map((m) => (
					<option key={m.value} value={m.value}>
						{m.count > 0 ? `${m.label} (${m.count})` : m.label}
					</option>
				))}
			</Select>
		</div>
	);
}
