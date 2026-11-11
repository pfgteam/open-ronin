'use client';

// Generic Airtable table viewer.
// - Renders any Airtable table via FieldCell
// - Defaults to first 8 fields visible; toggle the rest via the Fields menu
// - Client-side search across visible field values
// - "Load more" hits /api/airtable/records to follow the cursor
// - View picker pulls from the table's defined views

import { useEffect, useMemo, useRef, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import FieldCell from '@/components/airtable/FieldCell';
import { Columns3, Search, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { DataRecord, FieldSchema, TableSchema, ListResult } from '@/lib/data';

interface Props {
	baseId: string;
	tableId: string;
	table: TableSchema;
	initialRows: DataRecord[];
	initialCursor?: string;
	/**
	 * Per cell emphasis (Data Spreadsheets uses it to mark cells that changed
	 * since the previous snapshot). Return true to paint the cell amber.
	 */
	highlightCell?: (row: DataRecord, field: FieldSchema) => boolean;
}

export default function BaseExplorerTable({
	baseId,
	tableId,
	table,
	initialRows,
	initialCursor,
	highlightCell,
}: Props) {
	const [rows, setRows] = useState<DataRecord[]>(initialRows);
	const [cursor, setCursor] = useState<string | undefined>(initialCursor);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [viewId, setViewId] = useState<string>('');
	const [showFieldsPanel, setShowFieldsPanel] = useState(false);
	// All fields visible by default — BaseExplorer is the see-everything view.
	// Curated module pages can hide fields via Airtable views.
	const [hiddenFieldIds, setHiddenFieldIds] = useState<Set<string>>(new Set());

	const sentinelRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const loadingRef = useRef(false);
	const cursorRef = useRef(cursor);
	cursorRef.current = cursor;

	const visibleFields = useMemo(
		() => table.fields.filter((f) => !hiddenFieldIds.has(f.id)),
		[table.fields, hiddenFieldIds],
	);

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return rows;
		return rows.filter((row) => {
			for (const f of visibleFields) {
				const v = row.fields[f.name];
				if (v == null) continue;
				const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
				if (s.toLowerCase().includes(term)) return true;
			}
			return false;
		});
	}, [rows, visibleFields, search]);

	async function loadMore() {
		const currentCursor = cursorRef.current;
		if (!currentCursor || loadingRef.current) return;
		loadingRef.current = true;
		setLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams({ baseId, tableId, cursor: currentCursor });
			if (viewId) params.set('view', viewId);
			const res = await fetch(`/api/airtable/records?${params.toString()}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: 'Request failed' }));
				throw new Error(body.error ?? `HTTP ${res.status}`);
			}
			const data = (await res.json()) as ListResult<unknown>;
			setRows((prev) => [...prev, ...(data.rows as DataRecord[])]);
			setCursor(data.cursor);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			loadingRef.current = false;
			setLoading(false);
		}
	}

	// Scroll-to-load — sentinel lives INSIDE the scroll container so the
	// IntersectionObserver fires when the user scrolls vertically to the
	// bottom of the table itself (not when they scroll the outer page).
	useEffect(() => {
		const node = sentinelRef.current;
		const root = scrollRef.current;
		if (!node || !root) return;
		if (!cursor) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					void loadMore();
				}
			},
			{ root, rootMargin: '300px' },
		);
		observer.observe(node);
		return () => observer.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cursor, viewId, rows.length]);

	async function switchView(newViewId: string) {
		setLoading(true);
		setError(null);
		setViewId(newViewId);
		try {
			const params = new URLSearchParams({ baseId, tableId });
			if (newViewId) params.set('view', newViewId);
			const res = await fetch(`/api/airtable/records?${params.toString()}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: 'Request failed' }));
				throw new Error(body.error ?? `HTTP ${res.status}`);
			}
			const data = (await res.json()) as ListResult<unknown>;
			setRows(data.rows as DataRecord[]);
			setCursor(data.cursor);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}

	function toggleField(fieldId: string) {
		setHiddenFieldIds((prev) => {
			const next = new Set(prev);
			if (next.has(fieldId)) next.delete(fieldId);
			else next.add(fieldId);
			return next;
		});
	}

	function showAllFields() {
		setHiddenFieldIds(new Set());
	}

	function hideAllFields() {
		const hidden = new Set<string>();
		table.fields.forEach((f) => hidden.add(f.id));
		// keep the primary field visible so the table isn't completely empty
		hidden.delete(table.primaryFieldId);
		setHiddenFieldIds(hidden);
	}

	return (
		<>
			{/* Top toolbar */}
			<div className="flex flex-wrap items-center justify-between gap-3 mb-3">
				<div className="flex items-center gap-2">
					{table.views.length > 0 && (
						<select
							value={viewId}
							onChange={(e) => switchView(e.target.value)}
							className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400 max-w-[180px]"
						>
							<option value="">Default view</option>
							{table.views.map((v) => (
								<option key={v.id} value={v.id}>
									{v.name}
								</option>
							))}
						</select>
					)}

					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowFieldsPanel(!showFieldsPanel)}
					>
						<Columns3 className="w-3.5 h-3.5" />
						Fields ({visibleFields.length}/{table.fields.length})
					</Button>
				</div>

				<div className="flex items-center gap-2">
					<div className="relative">
						<Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
						<input
							type="search"
							placeholder="Search visible fields…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-7 pr-3 py-1.5 text-xs placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
						/>
					</div>
					<span className="text-xs text-slate-500 dark:text-slate-400">
						{filtered.length} of {rows.length}
					</span>
				</div>
			</div>

			{/* Field visibility panel */}
			{showFieldsPanel && (
				<Card className="mb-3" padding="sm">
					<div className="flex items-center justify-between mb-2">
						<p className="text-xs font-medium text-slate-700 dark:text-slate-300">
							Fields ({visibleFields.length} of {table.fields.length} visible)
						</p>
						<div className="flex gap-1">
							<button
								onClick={showAllFields}
								className="text-xs text-primary-600 hover:underline"
							>
								Show all
							</button>
							<span className="text-xs text-slate-300">·</span>
							<button
								onClick={hideAllFields}
								className="text-xs text-primary-600 hover:underline"
							>
								Hide all
							</button>
						</div>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1">
						{table.fields.map((f) => (
							<label
								key={f.id}
								className="flex items-center gap-2 text-xs px-2 py-1 rounded-md hover:bg-hover cursor-pointer transition-colors"
							>
								<input
									type="checkbox"
									checked={!hiddenFieldIds.has(f.id)}
									onChange={() => toggleField(f.id)}
									className="w-3 h-3 rounded-md border-slate-300 text-primary-600 focus:ring-primary-500"
								/>
								<span className="truncate" title={`${f.name} · ${f.type}`}>
									{f.name}
								</span>
							</label>
						))}
					</div>
				</Card>
			)}

			{error && (
				<Card className="mb-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">{error}</p>
				</Card>
			)}

			{/* Table — wrapper constrained to viewport so horizontal scrollbar
			    sticks to the bottom edge of the visible area, not to the bottom of
			    a thousand-row table. Both X and Y scrolling happen inside this div. */}
			<Card padding="none" className="overflow-hidden">
				<div
					ref={scrollRef}
					className="scrollbar-x-always"
					style={{ maxHeight: 'calc(100vh - 280px)' }}
				>
					<div className="overflow-x-auto">
					<table className="text-sm" style={{ minWidth: 'max-content', width: 'max-content' }}>
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								{visibleFields.map((f) => (
									<th
										key={f.id}
										className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap"
										title={`${f.name} · ${f.type}`}
									>
										{f.name}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{filtered.length === 0 && (
								<tr>
									<td
										colSpan={visibleFields.length || 1}
										className="px-4 py-12 text-center text-sm text-slate-500"
									>
										{rows.length === 0
											? 'No records.'
											: 'No matches for the current search.'}
									</td>
								</tr>
							)}
							{filtered.map((row) => (
								<tr
									key={row.id}
									className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
								>
									{visibleFields.map((f) => (
										<td
											key={f.id}
											className={clsx(
												'px-3 py-2 align-top max-w-xs',
												highlightCell?.(row, f) &&
													'bg-amber-50 dark:bg-amber-950/30 ring-1 ring-inset ring-amber-200 dark:ring-amber-800',
											)}
											title={highlightCell?.(row, f) ? 'Changed since the previous snapshot' : undefined}
										>
											<FieldCell field={f} value={row.fields[f.name]} dense />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					</div>

					{/* Infinite-scroll sentinel inside the scroll container.
					    sticky left:0 keeps it horizontally pinned regardless of x-scroll. */}
					{cursor && (
						<div
							ref={sentinelRef}
							className="sticky left-0 flex items-center justify-center gap-2 py-3 text-xs text-slate-500 bg-white dark:bg-slate-800"
							style={{ width: '100%' }}
						>
							{loading ? (
								<>
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
									Loading more…
								</>
							) : (
								<span className="text-slate-400">Scroll to load more</span>
							)}
						</div>
					)}
				</div>
			</Card>

			{/* Final-state status below the table */}
			<div className="flex items-center justify-center mt-3 min-h-[1.5rem]">
				{!cursor && (
					<span className="text-xs text-slate-400">
						All {rows.length} records loaded.
					</span>
				)}
			</div>
		</>
	);
}
