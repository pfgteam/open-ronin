'use client';

// "All runs →" — the full history behind the run bar's visible chips.
//
// A popover rather than a route or a drawer (Sam, 2026-08-26): picking an
// older dataset is a navigation aid, not a destination, and the module's nav
// is locked.
//
// ON THE POPOVER ANCHOR CONTRACT: the spec's phase-3 precondition warns that
// `Popover` only accepts `anchorRef: RefObject` and that a third adopter
// should widen it to `anchorEl: HTMLElement | null`. That warning is about
// anchors REPOINTED DURING RENDER off selection state (HomeView moves one
// stable ref between rows). This trigger is a single fixed button whose ref
// never repoints and whose node never unmounts while the panel is open, so it
// cannot produce the detached-node failure that motivates the change. The
// contract is deliberately left alone here — widening it touches four
// consumers and belongs to phase 3, not to a layout change.

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ChevronDown, Store, Search } from 'lucide-react';
import Popover from '@/components/ui/Popover';
import { formatRelative } from '@/lib/format';
import { type JobRow, STATUS_TONE, describeParams, isTradeShow } from './jobDisplay';

export default function AllRunsPopover({
	jobs,
	selectedId,
	filterQuery,
	basePath = '/media/lead-scraper',
}: {
	jobs: JobRow[];
	selectedId: string | null;
	filterQuery: string;
	basePath?: string;
}) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				onClick={() => setOpen(!open)}
				className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-2xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
			>
				All runs
				<ChevronDown className="w-3 h-3" />
			</button>

			<Popover open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} placement="bottom-end" width="w-96">
				<div className="py-1 max-h-96 overflow-y-auto">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
						<span className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
							All runs
						</span>
					</div>

					{jobs.map((j) => {
						const Icon = isTradeShow(j.params) ? Store : Search;
						return (
							<Link
								key={j.id}
								href={`${basePath}?job=${j.id}${filterQuery ? `&${filterQuery}` : ''}`}
								onClick={() => setOpen(false)}
								className={`flex items-start gap-2 px-3 py-2 text-xs hover:bg-hover transition-colors ${
									j.id === selectedId ? 'bg-selected' : ''
								}`}
							>
								<span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_TONE[j.status] ?? 'bg-slate-400'}`} />
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
										<Icon className="w-3 h-3 shrink-0 text-slate-400" />
										<span className="truncate">{describeParams(j.params)}</span>
									</span>
									<span className="block text-2xs text-slate-600 dark:text-slate-400 mt-0.5">
										{formatRelative(j.created_at)} · {j.status}
									</span>
								</span>
								<span className="shrink-0 text-2xs tabular-nums text-slate-600 dark:text-slate-400 mt-0.5">
									{j.imported}
								</span>
							</Link>
						);
					})}
				</div>
			</Popover>
		</>
	);
}
