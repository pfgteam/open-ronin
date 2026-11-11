'use client';

// Editable Children card — lets you attach existing items as children
// (search-to-add) and detach them (x button), so the hierarchy — Goal →
// Priority → Project → Task, and the client-side mirror Strategy → 12 Week
// Plan → Campaign → Assignment — is something you can actually build, not
// just view. Bounded on purpose: Goal has no parent (see WorkItemForm) and
// Task/Assignment have no children (CHILD_KINDS_FOR_PARENT returns an empty
// list for them, so the add-UI just doesn't render).
//
// Self-fetches its own children list (via getChildren) instead of taking it
// as a prop, specifically so it works both inside the compact WorkItemDrawer
// (opened from Priorities/Client Work/My Work lists — no server-side
// children query available there) and on the full /the-work/[id] detail page.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import { X, Plus, Search } from 'lucide-react';
import { addChild, removeChild, searchChildCandidates, getChildren } from './actions';
import { CHILD_KINDS_FOR_PARENT } from './hierarchy';
import { SkeletonRows } from '@/components/ui/Skeleton';

interface ChildItem { id: string; name: string; kind: string; status: string }
interface Candidate { id: string; name: string; kind: string }

interface Props {
	parentId: string;
	parentKind: string;
	/** Section label. Defaults to "Children" so every existing caller is
	 *  untouched; the task detail page passes "Subtasks". */
	heading?: string;
}

export default function ChildrenPanel({ parentId, parentKind, heading = 'Children' }: Props) {
	const router = useRouter();
	const [items, setItems] = useState<ChildItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [adding, setAdding] = useState(false);
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<Candidate[]>([]);
	const [searching, setSearching] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const canHaveChildren = (CHILD_KINDS_FOR_PARENT[parentKind] ?? []).length > 0;

	async function refetch() {
		setLoading(true);
		const data = await getChildren(parentId);
		setItems(data);
		setLoading(false);
	}

	useEffect(() => {
		refetch();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [parentId]);

	useEffect(() => {
		if (!adding) return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(async () => {
			setSearching(true);
			const res = await searchChildCandidates(parentKind, query, parentId);
			setResults(res);
			setSearching(false);
		}, 250);
		return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
	}, [query, adding, parentKind, parentId]);

	async function handleAdd(childId: string) {
		setPendingId(childId);
		setError(null);
		const res = await addChild(parentId, childId);
		setPendingId(null);
		if (!res.ok) { setError(res.error); return; }
		setAdding(false);
		setQuery('');
		setResults([]);
		await refetch();
		router.refresh();
	}

	async function handleRemove(childId: string) {
		setPendingId(childId);
		setError(null);
		const res = await removeChild(childId);
		setPendingId(null);
		if (!res.ok) { setError(res.error); return; }
		await refetch();
		router.refresh();
	}

	return (
		<div>
			<div className="flex items-center justify-between mb-2">
				<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">
					{heading} {!loading && `(${items.length})`}
				</div>
				{canHaveChildren && !adding && (
					<button
						onClick={() => setAdding(true)}
						className="text-slate-400 hover:text-primary-600 p-0.5 rounded-md transition-colors"
						title="Add child"
					>
						<Plus className="w-3.5 h-3.5" />
					</button>
				)}
			</div>

			{!canHaveChildren && (
				<p className="text-2xs text-slate-600 dark:text-slate-400 mb-2">
					{parentKind === 'task' || parentKind === 'assignment'
						? "This kind can't have children — it's the bottom of the tree."
						: 'No child kinds configured for this item.'}
				</p>
			)}

			{error && (
				<div className="text-2xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-2 py-1.5 mb-2">
					{error}
				</div>
			)}

			{adding && (
				<div className="mb-2">
					<div className="relative">
						<Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
						<input
							autoFocus
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={`Search ${(CHILD_KINDS_FOR_PARENT[parentKind] ?? []).join('/')}…`}
							className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-6 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
						/>
					</div>
					<div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
						{searching && <div className="text-xs text-slate-400 px-2 py-1.5">Searching…</div>}
						{!searching && results.length === 0 && (
							<div className="text-xs text-slate-400 px-2 py-1.5">
								{query.trim() ? 'No matches.' : 'Type to search…'}
							</div>
						)}
						{results.map((c) => (
							<button
								key={c.id}
								onClick={() => handleAdd(c.id)}
								disabled={pendingId === c.id}
								className="w-full text-left text-xs px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-between gap-2 transition-colors"
							>
								<span className="truncate">{c.name}</span>
								<Badge color="default">{c.kind}</Badge>
							</button>
						))}
					</div>
					<button
						onClick={() => { setAdding(false); setQuery(''); setResults([]); }}
						className="text-2xs text-slate-600 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 mt-1 transition-colors"
					>
						Cancel
					</button>
				</div>
			)}

			{loading ? (
				<SkeletonRows rows={2} />
			) : items.length === 0 ? (
				<p className="text-xs text-slate-400">No nested items yet.</p>
			) : (
				<ul className="space-y-1">
					{items.map((c) => (
						<li key={c.id} className="flex items-center justify-between gap-2 group">
							<Link href={`/the-work/${c.id}`} className="text-xs text-slate-700 dark:text-slate-300 hover:text-primary-600 flex items-center gap-2 py-1 min-w-0 flex-1 transition-colors">
								<span className="truncate">{c.name}</span>
								<Badge color="default">{c.kind}</Badge>
							</Link>
							<button
								onClick={() => handleRemove(c.id)}
								disabled={pendingId === c.id}
								className="text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
								title="Remove from this parent"
							>
								<X className="w-3 h-3" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
