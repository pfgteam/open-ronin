'use client';

import { useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import FilterChip from '@/components/ui/FilterChip';
import SearchInput from '@/components/ui/SearchInput';
import { formatDate, formatNumber } from '@/lib/format';
import { isLive, stageOf, stageColor } from '@/lib/media/status';
import type { DataRecord } from '@/lib/data';

export interface MediaOppFields {
	'Media Opp'?: string;
	Outlet?: string;
	'Outlet URL'?: string;
	Reach?: number;
	'Live Date'?: string;
	'Live Link'?: string;
	'Date Secured'?: string;
	Status?: string;
	Category?: string;
	'Opp Type'?: string;
	'Media Tier'?: string;
	Client?: { id: string; name?: string }[];
	'Story Title'?: string;
	'Potential Story / Angle'?: string;
	'Secured By'?: string;
	'Date Added'?: string;
}

// Chips are the R3 stage buckets (lib/media/status.ts) over Airtable's real
// 17-value vocabulary — the old chips tested tokens Airtable doesn't use and
// permanently showed 0. "Live" is a property (Live Link non-empty), so it
// gets its own chip independent of status.
type FilterKey = 'all' | 'live' | 'secured' | 'pitched' | 'client_lost' | 'media_lost' | 'other';

const FILTERS: { key: FilterKey; label: string; test: (f: MediaOppFields) => boolean }[] = [
	{ key: 'all', label: 'All', test: () => true },
	{ key: 'live', label: 'Live', test: (f) => isLive(f['Live Link']) },
	{ key: 'secured', label: 'Secured', test: (f) => stageOf(f.Status) === 'secured' },
	{ key: 'pitched', label: 'Pitched', test: (f) => stageOf(f.Status) === 'pitched' },
	{ key: 'client_lost', label: 'Client-side loss', test: (f) => stageOf(f.Status) === 'client_lost' },
	{ key: 'media_lost', label: 'Media-side loss', test: (f) => stageOf(f.Status) === 'media_lost' },
	{ key: 'other', label: 'Other', test: (f) => stageOf(f.Status) === 'unmapped' },
];

function tierColor(t?: string): 'default' | 'primary' | 'accent' {
	if (!t) return 'default';
	if (/tier\s*1|top/i.test(t)) return 'accent';
	if (/tier\s*2/i.test(t)) return 'primary';
	return 'default';
}

interface Props {
	rows: DataRecord<MediaOppFields>[];
	/** Prefills the search box — carries ?client=<name> from a client's "View all" link. */
	initialSearch?: string;
}

export default function MediaOppsTable({ rows, initialSearch = '' }: Props) {
	const [filter, setFilter] = useState<FilterKey>('all');
	const [search, setSearch] = useState(initialSearch);

	const counts = useMemo(() => {
		const c: Record<FilterKey, number> = {
			all: rows.length,
			live: 0,
			secured: 0,
			pitched: 0,
			client_lost: 0,
			media_lost: 0,
			other: 0,
		};
		for (const r of rows) {
			for (const f of FILTERS) {
				if (f.key !== 'all' && f.test(r.fields)) c[f.key]++;
			}
		}
		return c;
	}, [rows]);

	const filtered = useMemo(() => {
		const def = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
		const term = search.trim().toLowerCase();
		return rows.filter((r) => {
			if (!def.test(r.fields)) return false;
			if (!term) return true;
			const f = r.fields;
			return (
				(f.Outlet ?? '').toLowerCase().includes(term) ||
				(f['Media Opp'] ?? '').toLowerCase().includes(term) ||
				(f['Story Title'] ?? '').toLowerCase().includes(term) ||
				(f.Client ?? []).some((c) => (c.name ?? '').toLowerCase().includes(term))
			);
		});
	}, [rows, filter, search]);

	// Reach of LIVE rows (live link non-empty) — an audience count, not money.
	const totalReach = useMemo(
		() =>
			filtered
				.filter((r) => isLive(r.fields['Live Link']))
				.reduce((s, r) => s + (r.fields.Reach ?? 0), 0),
		[filtered],
	);

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				{FILTERS.map((f) => (
					<FilterChip
						key={f.key}
						active={filter === f.key}
						count={counts[f.key]}
						onClick={() => setFilter(f.key)}
					>
						{f.label}
					</FilterChip>
				))}
			</div>

			<div className="flex flex-wrap items-center justify-end gap-3 mb-4">
				<SearchInput
					placeholder="Search outlet, headline, client…"
					aria-label="Search media opportunities"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-64"
				/>
				<div className="text-right">
					<div className="text-xs text-slate-500 dark:text-slate-400">Live reach</div>
					<div className="text-sm font-semibold">{formatNumber(totalReach)}</div>
				</div>
			</div>

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Headline / Outlet
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Client
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Status
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Tier
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Secured
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Live
								</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Reach
								</th>
							</tr>
						</thead>
						<tbody>
							{filtered.length === 0 ? (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
										No records match.
									</td>
								</tr>
							) : (
								filtered.slice(0, 200).map((row) => {
									const f = row.fields;
									return (
										<tr
											key={row.id}
											className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
										>
											<td className="px-4 py-3">
												<div className="font-medium text-slate-900 dark:text-slate-100">
													{f['Story Title'] ?? f['Media Opp'] ?? '—'}
												</div>
												{f.Outlet && (
													<div className="text-xs text-slate-500 dark:text-slate-400">
														{f['Outlet URL'] ? (
															<a
																href={f['Outlet URL']}
																target="_blank"
																rel="noopener noreferrer"
																className="hover:underline"
															>
																{f.Outlet}
															</a>
														) : (
															f.Outlet
														)}
													</div>
												)}
											</td>
											<td className="px-4 py-3 text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
												{(f.Client ?? []).map((c) => c.name).filter(Boolean).join(', ') || '—'}
											</td>
											<td className="px-4 py-3">
												{f.Status && (
													<Badge color={stageColor(f.Status)}>{f.Status}</Badge>
												)}
											</td>
											<td className="px-4 py-3">
												{f['Media Tier'] && (
													<Badge color={tierColor(f['Media Tier'])}>
														{f['Media Tier']}
													</Badge>
												)}
											</td>
											<td className="px-4 py-3 text-slate-500 whitespace-nowrap">
												{formatDate(f['Date Secured'])}
											</td>
											<td className="px-4 py-3 text-slate-500 whitespace-nowrap">
												{f['Live Link'] ? (
													<a
														href={f['Live Link']}
														target="_blank"
														rel="noopener noreferrer"
														className="text-primary-600 hover:underline"
													>
														{formatDate(f['Live Date']) || 'link'}
													</a>
												) : (
													formatDate(f['Live Date'])
												)}
											</td>
											<td className="px-4 py-3 text-right font-mono">
												{f.Reach ? formatNumber(f.Reach) : '—'}
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</Card>

			<p className="text-xs text-slate-400 mt-3">
				Showing first {Math.min(filtered.length, 200)} of {filtered.length} matching records.
			</p>
		</>
	);
}
