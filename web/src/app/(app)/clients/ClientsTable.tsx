'use client';

// Client-side filter UI + table for the Clients module.
// Server passes all records in; this component handles filter, search, sort.

// Brands note: Brands live in the Client Media base → Client Metrics table
// (primary field "Contoso", with a Brand Name field per record, linked
// to the parent client by name string since Airtable can't cross-link bases).
// One contract can have multiple brands. /brands gets its own page.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import FilterChip from '@/components/ui/FilterChip';
import SearchInput from '@/components/ui/SearchInput';
import {
	statusColor,
	healthColor,
	formatHealth,
	hasHealth,
	type HealthValue,
} from '@/lib/clients/status';
import { formatCurrency } from '@/lib/format';
import type { DataRecord } from '@/lib/data';

interface Collaborator {
	id: string;
	email?: string;
	name?: string;
}

export interface ClientFields {
	Client?: string;
	'Client Status'?: string;
	Industry?: string;
	Packages?: string[];
	'Per Month'?: number;
	'Acct Lead'?: Collaborator;
	'Media Specialist'?: Collaborator;
	// Airtable percent field — a number like 0.85, NOT the word "High".
	'Client Health'?: HealthValue;
	'End of Service'?: string;
	'POC Email'?: string;
	'Lead Source'?: string;
}

type FilterKey = 'all' | 'active' | 'beacon' | 'pending' | 'post' | 'hold' | 'closed';

interface FilterDef {
	key: FilterKey;
	label: string;
	test: (f: ClientFields) => boolean;
}

// "Active" includes 30-day and 60-day — they're operationally Active after kickoff.
// Beacon records are split out into their own pill below.
const ACTIVE_STATUSES = new Set(['Active', '30-day', '60-day']);

const FILTERS: FilterDef[] = [
	{ key: 'all', label: 'All', test: () => true },
	{
		key: 'active',
		label: 'Active',
		test: (f) =>
			ACTIVE_STATUSES.has(f['Client Status'] ?? '') &&
			!(f.Packages ?? []).some((p) => /beacon/i.test(p)),
	},
	{
		key: 'beacon',
		label: 'Beacon',
		test: (f) => (f.Packages ?? []).some((p) => /beacon/i.test(p)),
	},
	{
		key: 'pending',
		label: 'Pending',
		test: (f) => /pending/i.test(f['Client Status'] ?? ''),
	},
	{
		key: 'post',
		label: 'Post Contract',
		test: (f) => /post contract/i.test(f['Client Status'] ?? ''),
	},
	{ key: 'hold', label: 'Hold', test: (f) => f['Client Status'] === 'Hold' },
	{ key: 'closed', label: 'Closed', test: (f) => f['Client Status'] === 'Closed' },
];

interface Props {
	rows: DataRecord<ClientFields>[];
	/** Airtable contract id -> clients_v2.id (the /clients/[id] route key). */
	clientIds: Record<string, string>;
}

export default function ClientsTable({ rows, clientIds }: Props) {
	const [filter, setFilter] = useState<FilterKey>('active');
	const [search, setSearch] = useState('');

	// Pre-compute counts for each filter pill (from the full dataset, regardless of search)
	const counts = useMemo(() => {
		const c: Record<FilterKey, number> = {
			all: rows.length,
			active: 0,
			beacon: 0,
			pending: 0,
			post: 0,
			hold: 0,
			closed: 0,
		};
		for (const r of rows) {
			for (const f of FILTERS) {
				if (f.key !== 'all' && f.test(r.fields)) c[f.key]++;
			}
		}
		return c;
	}, [rows]);

	// Apply filter + search (AND'd)
	const filtered = useMemo(() => {
		const filterDef = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
		const term = search.trim().toLowerCase();
		return rows.filter((r) => {
			if (!filterDef.test(r.fields)) return false;
			if (!term) return true;
			const fields = r.fields;
			return (
				(fields.Client ?? '').toLowerCase().includes(term) ||
				(fields.Industry ?? '').toLowerCase().includes(term) ||
				(fields['Acct Lead']?.name ?? '').toLowerCase().includes(term) ||
				(fields['POC Email'] ?? '').toLowerCase().includes(term) ||
				(fields.Packages ?? []).some((p) => p.toLowerCase().includes(term))
			);
		});
	}, [rows, filter, search]);

	const totalMrr = useMemo(
		() => filtered.reduce((sum, r) => sum + (r.fields['Per Month'] ?? 0), 0),
		[filtered],
	);

	return (
		<>
			{/* Filter pill row */}
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

			{/* Search + MRR */}
			<div className="flex flex-wrap items-center justify-end gap-3 mb-4">
				<SearchInput
					placeholder="Search clients…"
					aria-label="Search clients"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-56"
				/>
				<div className="text-right">
					<div className="text-xs text-slate-500 dark:text-slate-400">MRR</div>
					<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						{formatCurrency(totalMrr)}
					</div>
				</div>
			</div>

			{/* Table */}
			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Client
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Status
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Industry
								</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Per Month
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Packages
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Acct Lead
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Health
								</th>
							</tr>
						</thead>
						<tbody>
							{filtered.length === 0 && (
								<tr>
									<td
										colSpan={7}
										className="px-4 py-12 text-center text-sm text-slate-500"
									>
										No records match the current filter.
									</td>
								</tr>
							)}
							{filtered.map((row) => {
								const f = row.fields;
								const packages = f.Packages ?? [];
								const clientId = clientIds[row.id];
								return (
									<tr
										key={row.id}
										className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
									>
										<td className="px-4 py-3">
											{clientId ? (
												<Link
													href={`/clients/${clientId}`}
													className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
												>
													{f.Client ?? '(no name)'}
												</Link>
											) : (
												<span
													className="font-medium text-slate-700 dark:text-slate-300"
													title="Not yet mirrored to clients_v2 — the contracts sync has not seen this Airtable row"
												>
													{f.Client ?? '(no name)'}
												</span>
											)}
											{f['POC Email'] && (
												<div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
													{f['POC Email']}
												</div>
											)}
										</td>
										<td className="px-4 py-3">
											{f['Client Status'] && (
												<Badge color={statusColor(f['Client Status'])}>
													{f['Client Status']}
												</Badge>
											)}
										</td>
										<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
											{f.Industry ?? '—'}
										</td>
										<td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-slate-100">
											{formatCurrency(f['Per Month'])}
										</td>
										<td className="px-4 py-3">
											{packages.length === 0 ? (
												<span className="text-slate-400">—</span>
											) : (
												<div className="flex flex-wrap gap-1 max-w-xs">
													{packages.slice(0, 2).map((p) => (
														<Badge
															key={p}
															color={
																/beacon/i.test(p)
																	? 'accent'
																	: 'default'
															}
														>
															{p}
														</Badge>
													))}
													{packages.length > 2 && (
														<span
															className="text-xs text-slate-400"
															title={packages.slice(2).join(', ')}
														>
															+{packages.length - 2}
														</span>
													)}
												</div>
											)}
										</td>
										<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
											{f['Acct Lead']?.name ?? '—'}
										</td>
										<td className="px-4 py-3">
											{hasHealth(f['Client Health']) && (
												<Badge color={healthColor(f['Client Health'])}>
													{formatHealth(f['Client Health'])}
												</Badge>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</Card>

			<p className="text-xs text-slate-400 mt-3">
				Showing {filtered.length} of {rows.length} records · Source: Airtable · Client
				Central · Contract Agreement
			</p>
		</>
	);
}
