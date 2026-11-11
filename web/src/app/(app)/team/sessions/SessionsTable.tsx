'use client';

// Client-side text search over the already-fetched page window (server owns
// type/month/attention — those are Links, see page.tsx). Same "in-memory over
// the fetched window" scope as the Needs attention chip.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import SearchInput from '@/components/ui/SearchInput';
import { formatDate } from '@/lib/format';
import { scoreBand, SCORE_BAND_BADGE } from '@/lib/sessions/analysis';

export interface SessionRow {
	id: string;
	occurredAt: string;
	callType: string;
	typeLabel: string;
	clientName: string | null;
	attendeeNames: string[];
	durationMinutes: number | null;
	score: number | null;
	pendingCount: number;
	needsAttention: boolean;
}

function attendeesLabel(names: string[]): string {
	if (names.length === 0) return '—';
	if (names.length <= 3) return names.join(', ');
	return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

export interface SessionsPager {
	page: number;
	pageCount: number;
	total: number;
	/** First row's 1-based index in the whole filtered window. */
	from: number;
	/**
	 * Ready-built hrefs, null at the ends. Two strings rather than an
	 * hrefFor(page) callback: this is a Client Component, and a function
	 * cannot cross that boundary from a server page ("Functions cannot be
	 * passed directly to Client Components"). The server builds both links
	 * with its own withParam, so month/type/tab still survive.
	 */
	prevHref: string | null;
	nextHref: string | null;
}

export default function SessionsTable({
	rows,
	pager,
}: {
	rows: SessionRow[];
	pager?: SessionsPager;
}) {
	const [search, setSearch] = useState('');

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return rows;
		return rows.filter((r) => {
			return (
				r.typeLabel.toLowerCase().includes(term) ||
				(r.clientName ?? '').toLowerCase().includes(term) ||
				r.attendeeNames.some((n) => n.toLowerCase().includes(term))
			);
		});
	}, [rows, search]);

	return (
		<>
			<div className="flex justify-end mb-3">
				<SearchInput
					placeholder="Search client, attendee, type…"
					aria-label="Search calls"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-64"
				/>
			</div>

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Date
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Type
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Client
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Attendees
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Duration
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Score
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5" />
							</tr>
						</thead>
						<tbody>
							{filtered.length === 0 && (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
										No calls match the current search.
									</td>
								</tr>
							)}
							{filtered.map((row) => (
								<tr
									key={row.id}
									className="relative border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
								>
									{/*
										Row-covering link, not a tr onClick: a bare <tr onClick> is
										invisible to keyboard/screen-reader users (no href, no focus
										stop). `tr` is `position: relative` (above); this <td> stays
										`position: static`, so the Link's `absolute inset-0` skips it
										and resolves its containing block to the tr's padding box —
										the standard "block link" trick, and it works across table
										cells because CSS containing-block resolution walks up to the
										nearest POSITIONED ancestor, not just the immediate parent.
										The link therefore visually covers the whole row (so a mouse
										click anywhere still navigates, same as before) while being a
										real, focusable, keyboard-and-AT-reachable <a> — no per-cell
										links to conflict with, since no other cell has one.
									*/}
									<td className="p-0 text-slate-700 dark:text-slate-300 whitespace-nowrap">
										<Link
											href={`/team/sessions/${row.id}`}
											className="absolute inset-0 flex items-center px-4 py-3"
											aria-label={`View call — ${row.typeLabel} — ${formatDate(row.occurredAt)}${row.clientName ? ` — ${row.clientName}` : ''}`}
										>
											{formatDate(row.occurredAt)}
										</Link>
									</td>
									<td className="px-4 py-3">
										<Badge>{row.typeLabel}</Badge>
									</td>
									<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
										{row.clientName ?? 'Internal'}
									</td>
									<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
										{attendeesLabel(row.attendeeNames)}
									</td>
									<td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
										{row.durationMinutes != null ? `${row.durationMinutes} min` : '—'}
									</td>
									<td className="px-4 py-3">
										{row.score != null ? (
											<Badge color={SCORE_BAND_BADGE[scoreBand(row.score)]}>
												{row.score.toFixed(1)}
											</Badge>
										) : (
											<span className="text-slate-400">—</span>
										)}
									</td>
									<td className="px-4 py-3 text-right">
										{row.pendingCount > 0 && (
											<Badge color="warning">{row.pendingCount} pending</Badge>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{pager && pager.pageCount > 1 && (
					<div className="px-4 py-2.5 flex items-center gap-1 border-t border-slate-200 dark:border-slate-700">
						<span className="text-xs text-slate-400 tabular-nums">
							Calls {pager.from}–{pager.from + rows.length - 1} of {pager.total}
						</span>
						<span className="ml-auto flex items-center gap-1">
							{pager.prevHref ? (
								<Link
									href={pager.prevHref}
									className="px-2 py-1 text-xs rounded-md text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
								>
									← Newer
								</Link>
							) : (
								<span className="px-2 py-1 text-xs text-slate-300 dark:text-slate-600">← Newer</span>
							)}
							<span className="px-1 text-xs text-slate-400 tabular-nums">
								{pager.page} / {pager.pageCount}
							</span>
							{pager.nextHref ? (
								<Link
									href={pager.nextHref}
									className="px-2 py-1 text-xs rounded-md text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
								>
									Older →
								</Link>
							) : (
								<span className="px-2 py-1 text-xs text-slate-300 dark:text-slate-600">Older →</span>
							)}
						</span>
					</div>
				)}
			</Card>

			{/* "this page" not "this window": search filters the fetched page,
			    and the pager above says where that page sits in the month. */}
			<p className="text-xs text-slate-400 mt-3">
				Showing {filtered.length} of {rows.length} calls on this page.
			</p>
		</>
	);
}
