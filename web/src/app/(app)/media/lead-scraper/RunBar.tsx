// The run bar — every executed search as a chip, above the results.
//
// Replaces the full-width jobs table. The table's job was navigation dressed
// as a report: five numeric columns for rows whose only real action was
// "Review". As chips, the same rows become what they actually are — a set of
// datasets to switch between — and the numbers that matter (staged count,
// status) ride along on the chip.
//
// A server component on purpose: chips are plain Links to ?job=<id>, so
// switching datasets is a normal navigation and the page stays server-
// rendered. Only the All-runs popover needs client state.

import Link from 'next/link';
import { Store, Search, Building2, Newspaper, Mail, Globe } from 'lucide-react';
import {
	type JobRow,
	STATUS_TONE,
	shortLabel,
	describeParams,
	isTradeShow,
	isAcquisition,
	mediaPreset,
} from './jobDisplay';
import AllRunsPopover from './AllRunsPopover';

/** How many chips ride in the bar. The rest live behind "All runs". */
const VISIBLE = 8;

/** Chip icon by what the run is. Media presets (0102) get their own three. */
function iconFor(j: JobRow) {
	const media = mediaPreset(j);
	if (media === 'news_journalists') return Newspaper;
	if (media === 'email_waterfall') return Mail;
	if (media === 'outlet_crawl') return Globe;
	if (isAcquisition(j)) return Building2;
	return isTradeShow(j.params) ? Store : Search;
}

export default function RunBar({
	jobs,
	selectedId,
	filterQuery,
	basePath = '/media/lead-scraper',
}: {
	jobs: JobRow[];
	selectedId: string | null;
	/** The current `f.*` (and `mode`) params, already serialised. Chips carry
	 *  them so switching datasets never discards the search being composed. */
	filterQuery: string;
	/** Which page the chips link back to. The Media Scraper (0102) reuses this
	 *  bar under its own route. */
	basePath?: string;
}) {
	const href = (id: string) => `${basePath}?job=${id}${filterQuery ? `&${filterQuery}` : ''}`;

	if (jobs.length === 0) {
		return (
			<div className="mb-3 px-3 py-2 rounded-md border border-dashed border-slate-200 dark:border-slate-700 text-2xs text-slate-600 dark:text-slate-400">
				No searches run yet — compose one on the left and press Run search.
			</div>
		);
	}

	return (
		<div className="mb-3 flex items-center gap-2">
			<div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto pb-1">
				{jobs.slice(0, VISIBLE).map((j) => {
					const active = j.id === selectedId;
					const Icon = iconFor(j);
					return (
						<Link
							key={j.id}
							href={href(j.id)}
							title={describeParams(j.params)}
							aria-current={active ? 'true' : undefined}
							className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-2xs transition-colors ${
								active
									? 'border-primary-500 bg-primary-50 text-slate-900 dark:bg-primary-950/30 dark:text-slate-100'
									: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/45'
							}`}
						>
							<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_TONE[j.status] ?? 'bg-slate-400'}`} />
							<Icon className="w-3 h-3 shrink-0 text-slate-400" />
							<span className="max-w-52 truncate">{shortLabel(j.params)}</span>
							<span className="tabular-nums text-slate-400 shrink-0">{j.imported}</span>
						</Link>
					);
				})}
			</div>

			<AllRunsPopover jobs={jobs} selectedId={selectedId} filterQuery={filterQuery} basePath={basePath} />
		</div>
	);
}
