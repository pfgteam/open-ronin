'use client';

// Searchable, checkbox-driven multi-select for which users' calendars to
// overlay on the current view. Selected user ids land in the URL (?users=)
// so the choice survives reloads + can be shared via link. Each user gets
// a consistent color (hashed from their id) so their events stand out.

import { useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Users, Search, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { vizFor } from '@/lib/colors';

export interface UserOption {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

interface Props {
	users: UserOption[];                   // every profile in the org
	selectedIds: string[];
	selfId: string;                        // hide "me" from the list
}

export function userCalendarColor(id: string): string {
	// Stable pick from the token palette (style guide decision 8: no hashed hsl()).
	return vizFor(id);
}

export default function UsersCalendarPicker({ users, selectedIds, selfId }: Props) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [, startTransition] = useTransition();
	void startTransition;

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');

	const selectedSet = new Set(selectedIds);
	const filtered = users
		.filter((u) => u.id !== selfId)
		.filter((u) => {
			if (!query) return true;
			const name = ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.email).toLowerCase();
			return name.includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase());
		})
		.sort((a, b) => {
			const an = ([a.first_name, a.last_name].filter(Boolean).join(' ') || a.email).toLowerCase();
			const bn = ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.email).toLowerCase();
			return an.localeCompare(bn);
		});

	function setSelected(ids: string[]) {
		const params = new URLSearchParams(searchParams.toString());
		if (ids.length === 0) params.delete('users');
		else params.set('users', ids.join(','));
		router.push(`${pathname}?${params.toString()}`);
	}

	function toggleUser(id: string) {
		const next = selectedSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
		setSelected(next);
	}

	function clearAll() { setSelected([]); }

	return (
		<div className="relative">
			<Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)} className="gap-1.5">
				<Users className="w-3.5 h-3.5" />
				Calendars
				{selectedIds.length > 0 && (
					<span className="bg-primary-600 text-white rounded-full text-2xs px-1.5 py-0">{selectedIds.length}</span>
				)}
			</Button>

			{open && (
				<>
					<div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
					<div className="absolute right-0 top-full mt-1 z-40 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-panel">
						<div className="p-2 border-b border-slate-200 dark:border-slate-700">
							<div className="relative">
								<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
								<input
									type="text"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="Search teammates…"
									className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
									autoFocus
								/>
							</div>
							{selectedIds.length > 0 && (
								<div className="flex items-center justify-between mt-1.5 text-2xs text-slate-600 dark:text-slate-400">
									<span>{selectedIds.length} on</span>
									<button onClick={clearAll} className="text-primary-600 hover:underline inline-flex items-center gap-0.5">
										<X className="w-3 h-3" /> Clear
									</button>
								</div>
							)}
						</div>
						<ul className="max-h-72 overflow-y-auto py-1">
							{filtered.length === 0 ? (
								<li className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400">No matches.</li>
							) : (
								filtered.map((u) => {
									const checked = selectedSet.has(u.id);
									const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
									const color = userCalendarColor(u.id);
									return (
										<li key={u.id}>
											<label className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
												<input
													type="checkbox"
													checked={checked}
													onChange={() => toggleUser(u.id)}
													className="w-3.5 h-3.5"
												/>
												<span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
												<span className="flex-1 min-w-0 truncate">{name}</span>
												<span className="text-2xs text-slate-600 dark:text-slate-400 truncate max-w-[120px]">{u.email}</span>
											</label>
										</li>
									);
								})
							)}
						</ul>
					</div>
				</>
			)}
		</div>
	);
}
