'use client';

// Pace filter for the Delivery board — URL-driven (?pace=) like ClientsTable's
// status chips, so a filtered board is a shareable link and the server page
// does the filtering. One chip active at a time; "All" clears the param.

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import FilterChip from '@/components/ui/FilterChip';
import type { PaceFilter } from '@/lib/delivery/board';

const CHIPS: { key: PaceFilter; label: string; tone?: 'default' | 'danger' | 'warning' }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'behind', label: 'Behind pace', tone: 'danger' },
	{ key: 'zero', label: 'No opps this month', tone: 'danger' },
	{ key: 'nogoal', label: 'No goal', tone: 'warning' },
	{ key: 'onpace', label: 'On pace' },
	{ key: 'met', label: 'Goal met' },
];

export default function PaceChips({
	counts,
	active,
	basePath,
}: {
	counts: Record<PaceFilter, number>;
	active: PaceFilter;
	basePath: string;
}) {
	const router = useRouter();
	const params = useSearchParams();
	const [pending, startTransition] = useTransition();

	function pick(key: PaceFilter) {
		const next = new URLSearchParams(params.toString());
		if (key === 'all') next.delete('pace');
		else next.set('pace', key);
		const qs = next.toString();
		startTransition(() => router.replace(qs ? `${basePath}?${qs}` : basePath));
	}

	return (
		<div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by pace" aria-busy={pending}>
			{CHIPS.map((c) => (
				<FilterChip
					key={c.key}
					active={active === c.key}
					count={counts[c.key]}
					tone={c.tone}
					onClick={() => pick(c.key)}
					disabled={pending}
				>
					{c.label}
				</FilterChip>
			))}
		</div>
	);
}
