'use client';

// The detail page's status control. Deliberately the SAME visual/behavioral
// control the Home popover uses (Task 8, spec "one chassis, three
// emphases") — same chip shape (Badge-sized pill), same active treatment
// (!bg-primary-600 !text-white). Calls the existing setWorkItemStatus server
// action (../actions.ts:156) in a transition, with an optimistic flip that
// reverts + toasts on failure — same shape as ProjectOverview's
// handleStatusChange, just rendered as chips instead of a <select>.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { useToast } from '@/components/ui/Toast';
import { setWorkItemStatus } from '../actions';

export interface StatusChipOption {
	slug: string;
	label: string;
}

interface Props {
	itemId: string;
	/** Not read directly today — kept so the aria-label and any future
	 *  kind-specific chip styling has it without a signature change. */
	kind: string;
	currentStatus: string;
	statuses: StatusChipOption[];
}

export default function DetailStatusChips({ itemId, kind, currentStatus, statuses }: Props) {
	const { toast } = useToast();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	// Optimistic override: cleared in handleClick's `finally`, once the server
	// confirms or fails. currentStatus itself updates via router.refresh() ->
	// re-fetch, so this never drifts stale once the transition settles.
	// Callers that keep ONE instance mounted across different items (the Home
	// popover) must also pass `key={item.id}` — see TaskQuickPopover.
	const [optimistic, setOptimistic] = useState<string | null>(null);
	const active = optimistic ?? currentStatus;

	function handleClick(slug: string) {
		if (slug === active || pending) return;
		setOptimistic(slug);
		startTransition(async () => {
			try {
				const res = await setWorkItemStatus(itemId, slug);
				if (!res.ok) {
					toast({ message: `Could not update status: ${res.error}`, variant: 'error' });
					return;
				}
				// router.refresh() is awaited inside the transition, so the
				// re-fetched currentStatus and the cleared override commit in the
				// same paint — no flash back to the old chip in between.
				router.refresh();
			} catch (e) {
				// A thrown action (network drop, redirect-less crash) must revert
				// too, not leave a highlight the server never agreed to.
				console.error('[DetailStatusChips] setWorkItemStatus failed:', e);
				toast({ message: 'Could not update status.', variant: 'error' });
			} finally {
				// Always clear: on success currentStatus now carries the new value,
				// on failure the chip falls back to the truth the server still holds.
				setOptimistic(null);
			}
		});
	}

	return (
		<div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={`${kind} status`}>
			{statuses.map((s) => {
				const isActive = s.slug === active;
				return (
					<button
						key={s.slug}
						type="button"
						onClick={() => handleClick(s.slug)}
						disabled={pending}
						aria-pressed={isActive}
						className={clsx(
							'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-60',
							isActive
								? '!bg-primary-600 !text-white !border-primary-600'
								: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600',
						)}
					>
						{s.label}
					</button>
				);
			})}
		</div>
	);
}
