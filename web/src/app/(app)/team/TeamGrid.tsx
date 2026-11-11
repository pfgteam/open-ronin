'use client';

// Client half of /team — search + department chips over the directory cards.
//
// The page stayed a pure server component for a long time, which meant 67
// active people rendered as department sections with no way to filter: finding
// a colleague was browser Ctrl+F. The server still does all the reading,
// grouping and permission work; this component only owns the two filters and
// renders the cards it is handed.
//
// Same pattern as clients/ClientsTable.tsx: SearchInput + FilterChip, counts
// on the chips, empty state when a filter matches nothing.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import FilterChip from '@/components/ui/FilterChip';
import SearchInput from '@/components/ui/SearchInput';
import { MapPin, Mail, Pencil, Users } from 'lucide-react';

/** Card-ready shape — the server resolves department/position/manager first. */
export interface TeamMember {
	id: string;
	email: string;
	fullName: string;
	initials: string;
	position: string | null;
	jobRole: string | null;
	department: string;
	photo: string | null;
	managerId: string | null;
	managerName: string | null;
	reports: number;
	nashvilleInOffice: boolean;
	canEdit: boolean;
}

interface Props {
	members: TeamMember[];
	/** Department labels in canon order (/admin/tags), 'Unassigned' last. */
	departments: string[];
}

export default function TeamGrid({ members, departments }: Props) {
	const [dept, setDept] = useState<string>('all');
	const [search, setSearch] = useState('');

	const counts = useMemo(() => {
		const c: Record<string, number> = { all: members.length };
		for (const m of members) c[m.department] = (c[m.department] ?? 0) + 1;
		return c;
	}, [members]);

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		return members.filter((m) => {
			if (dept !== 'all' && m.department !== dept) return false;
			if (!term) return true;
			return (
				m.fullName.toLowerCase().includes(term) ||
				m.email.toLowerCase().includes(term) ||
				(m.position ?? '').toLowerCase().includes(term) ||
				(m.jobRole ?? '').toLowerCase().includes(term) ||
				m.department.toLowerCase().includes(term)
			);
		});
	}, [members, dept, search]);

	// Keep the department headings, but only for departments still on screen.
	const grouped = useMemo(() => {
		const g: Record<string, TeamMember[]> = {};
		for (const m of filtered) (g[m.department] ??= []).push(m);
		return g;
	}, [filtered]);

	const visibleDepts = departments.filter((d) => grouped[d]?.length);

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<FilterChip active={dept === 'all'} count={counts.all} onClick={() => setDept('all')}>
					All
				</FilterChip>
				{departments.map((d) =>
					counts[d] ? (
						<FilterChip key={d} active={dept === d} count={counts[d]} onClick={() => setDept(d)}>
							{d}
						</FilterChip>
					) : null,
				)}
				<SearchInput
					aria-label="Search team by name, email, position or department"
					placeholder="Search people…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full sm:w-64 sm:ml-auto"
				/>
			</div>

			{filtered.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 text-center py-8">
						No one matches{search.trim() ? ` “${search.trim()}”` : ''}
						{dept !== 'all' ? ` in ${dept}` : ''}.{' '}
						<button
							type="button"
							onClick={() => {
								setSearch('');
								setDept('all');
							}}
							className="text-primary-600 hover:underline"
						>
							Clear filters
						</button>
					</p>
				</Card>
			) : (
				<>
					<p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
						{filtered.length} of {members.length} people
					</p>
					{visibleDepts.map((d) => (
						<div key={d} className="mb-6">
							<h2 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
								{d} <span className="text-slate-400">({grouped[d].length})</span>
							</h2>
							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
								{grouped[d].map((p) => (
									<div
										key={p.id}
										className="group relative p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-start gap-3 hover:bg-hover transition-colors"
									>
										<Link href={`/team/${p.id}`} className="shrink-0">
											<div className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-bold overflow-hidden">
												{p.photo ? (
													// eslint-disable-next-line @next/next/no-img-element
													<img
														src={p.photo}
														alt={p.fullName}
														className="w-full h-full object-cover"
													/>
												) : (
													p.initials
												)}
											</div>
										</Link>
										<div className="min-w-0 flex-1">
											<Link
												href={`/team/${p.id}`}
												className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate hover:text-primary-600 transition-colors block"
											>
												{p.fullName}
											</Link>
											<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
												{p.position}
												{p.jobRole ? ` · ${p.jobRole}` : ''}
											</p>
											<div className="mt-1.5 flex items-center gap-2 text-xs">
												<a
													href={`mailto:${p.email}`}
													className="inline-flex items-center gap-1 text-primary-600 hover:underline truncate"
												>
													<Mail className="w-3 h-3 shrink-0" />
													{p.email}
												</a>
											</div>
											<div className="mt-1 text-2xs text-slate-500 dark:text-slate-400 truncate">
												{p.managerId && p.managerName ? (
													<>
														Reports to{' '}
														<Link
															href={`/team/${p.managerId}`}
															className="hover:text-primary-600 transition-colors"
														>
															{p.managerName}
														</Link>
													</>
												) : (
													<span className="text-amber-600 dark:text-amber-500">No manager set</span>
												)}
											</div>
											<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
												{p.reports > 0 && (
													<Badge color="default" className="text-2xs">
														<Users className="w-2.5 h-2.5 mr-0.5" />
														{p.reports} report{p.reports > 1 ? 's' : ''}
													</Badge>
												)}
												{p.nashvilleInOffice && (
													<Badge color="primary">
														<MapPin className="w-2.5 h-2.5 mr-0.5" />
														HQ
													</Badge>
												)}
											</div>
										</div>
										{p.canEdit && (
											<Link
												href={`/team/${p.id}/edit`}
												aria-label={`Edit ${p.fullName}`}
												className="absolute top-2 right-2 p-1 rounded-md text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700/45 hover:text-primary-600 transition-all"
											>
												<Pencil className="w-3 h-3" />
											</Link>
										)}
									</div>
								))}
							</div>
						</div>
					))}
				</>
			)}
		</>
	);
}
