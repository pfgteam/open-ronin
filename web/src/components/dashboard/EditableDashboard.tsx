'use client';

// Client-side edit-mode shell for dashboard tile grids.
// Handles: drag-and-drop reorder (@dnd-kit), gear menu (rename/remove),
// add-a-tile picker, and optimistic persistence via the saveLayout server action.
//
// Server fetches the resolved visible + hidden tiles (see lib/dashboard/layout.ts)
// and passes them in via <EditableDashboardProvider>. <EditButton /> is rendered
// in the page header; <EditableGrid /> renders the tiles below.

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
	ArrowUpRight,
	Loader2,
	Pencil,
	Plus,
	RotateCcw,
	Settings,
	Trash2,
	ArrowLeftRight,
	X,
} from 'lucide-react';
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core';
import {
	SortableContext,
	arrayMove,
	rectSortingStrategy,
	sortableKeyboardCoordinates,
	useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import Button from '@/components/ui/Button';
import SearchInput from '@/components/ui/SearchInput';
import Card from '@/components/ui/Card';
import { resetLayout, saveLayout } from '@/lib/dashboard/actions';
import type { LayoutItem, RenderedTile, TileDelta } from '@/lib/dashboard/types';

type Variant = 'overview' | 'delivery' | 'department';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface EditableContextValue {
	dashboardKey: string;
	variant: Variant;
	isEditing: boolean;
	isPending: boolean;
	visible: RenderedTile[];
	hidden: RenderedTile[];
	toggleEdit: () => void;
	reorder: (fromKey: string, toKey: string) => void;
	removeTile: (key: string) => void;
	addTile: (key: string) => void;
	/** Swap a card for another metric, keeping its position in the grid. */
	replaceTile: (oldKey: string, newKey: string) => void;
	/** Picker state: `replacing` is the card being swapped, null when adding. */
	picker: { open: boolean; replacing: string | null };
	openPicker: (replacing?: string | null) => void;
	closePicker: () => void;
	reset: () => void;
}

const EditableContext = createContext<EditableContextValue | null>(null);

function useEditable() {
	const ctx = useContext(EditableContext);
	if (!ctx) throw new Error('Editable dashboard components must be inside EditableDashboardProvider');
	return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ProviderProps {
	dashboardKey: string;
	variant: Variant;
	initialVisible: RenderedTile[];
	initialHidden: RenderedTile[];
	children: React.ReactNode;
}

export function EditableDashboardProvider({
	dashboardKey,
	variant,
	initialVisible,
	initialHidden,
	children,
}: ProviderProps) {
	const [visible, setVisible] = useState<RenderedTile[]>(initialVisible);
	const [hidden, setHidden] = useState<RenderedTile[]>(initialHidden);
	const [isEditing, setIsEditing] = useState(false);
	const [picker, setPicker] = useState<{ open: boolean; replacing: string | null }>({
		open: false,
		replacing: null,
	});
	const [isPending, startTransition] = useTransition();

	// Re-sync with server values after revalidatePath.
	useEffect(() => setVisible(initialVisible), [initialVisible]);
	useEffect(() => setHidden(initialHidden), [initialHidden]);

	// The layout is just which metrics are pinned, in order — labels come from the
	// sheet, so there is nothing to override (cards are swapped, not renamed).
	const toLayoutItems = useCallback((tiles: RenderedTile[]): LayoutItem[] => {
		return tiles.map((t) => ({ tile_key: t.key }));
	}, []);

	const persist = useCallback(
		(next: RenderedTile[]) => {
			const layout = toLayoutItems(next);
			startTransition(async () => {
				const res = await saveLayout(dashboardKey, layout);
				if (res.error) console.error('Failed to save dashboard layout:', res.error);
			});
		},
		[dashboardKey, toLayoutItems],
	);

	const reorder = useCallback(
		(fromKey: string, toKey: string) => {
			setVisible((items) => {
				const from = items.findIndex((t) => t.key === fromKey);
				const to = items.findIndex((t) => t.key === toKey);
				if (from < 0 || to < 0 || from === to) return items;
				const next = arrayMove(items, from, to);
				persist(next);
				return next;
			});
		},
		[persist],
	);

	const removeTile = useCallback(
		(key: string) => {
			setVisible((items) => {
				const tile = items.find((t) => t.key === key);
				const next = items.filter((t) => t.key !== key);
				if (tile) setHidden((h) => (h.some((x) => x.key === key) ? h : [...h, tile]));
				persist(next);
				return next;
			});
		},
		[persist],
	);

	const addTile = useCallback(
		(key: string) => {
			setHidden((items) => {
				const tile = items.find((t) => t.key === key);
				if (!tile) return items;
				setVisible((v) => {
					if (v.some((t) => t.key === key)) return v;
					const merged = [...v, tile];
					persist(merged);
					return merged;
				});
				return items.filter((t) => t.key !== key);
			});
		},
		[persist],
	);

	// Swap in place: the new metric takes the old card's slot, the old one goes
	// back to the picker. Renaming a card was removed — the sheet owns the names,
	// and a renamed card made it impossible to tell which sheet row you were
	// looking at.
	const replaceTile = useCallback(
		(oldKey: string, newKey: string) => {
			setVisible((items) => {
				const index = items.findIndex((t) => t.key === oldKey);
				const incoming = hidden.find((t) => t.key === newKey);
				if (index < 0 || !incoming) return items;
				const outgoing = items[index];
				const next = [...items];
				next[index] = incoming;
				setHidden((h) => [...h.filter((t) => t.key !== newKey), outgoing]);
				persist(next);
				return next;
			});
		},
		[hidden, persist],
	);

	const reset = useCallback(() => {
		if (!window.confirm('Reset this dashboard to defaults?')) return;
		startTransition(async () => {
			const res = await resetLayout(dashboardKey);
			if (res.error) console.error('Failed to reset layout:', res.error);
		});
	}, [dashboardKey]);

	const value = useMemo<EditableContextValue>(
		() => ({
			dashboardKey,
			variant,
			isEditing,
			isPending,
			visible,
			hidden,
			toggleEdit: () => setIsEditing((v) => !v),
			reorder,
			removeTile,
			addTile,
			replaceTile,
			picker,
			openPicker: (replacing: string | null = null) => setPicker({ open: true, replacing }),
			closePicker: () => setPicker({ open: false, replacing: null }),
			reset,
		}),
		[
			dashboardKey,
			variant,
			isEditing,
			isPending,
			visible,
			hidden,
			picker,
			reorder,
			removeTile,
			addTile,
			replaceTile,
			reset,
		],
	);

	return <EditableContext.Provider value={value}>{children}</EditableContext.Provider>;
}

// ---------------------------------------------------------------------------
// Header controls
// ---------------------------------------------------------------------------

export function EditButton({ className }: { className?: string }) {
	const { isEditing, isPending, toggleEdit, reset } = useEditable();
	return (
		<div className={clsx('flex items-center gap-2', className)}>
			{isEditing && (
				<>
					{isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
					<Button variant="ghost" size="sm" onClick={reset} disabled={isPending}>
						<RotateCcw className="w-3.5 h-3.5" />
						Reset
					</Button>
				</>
			)}
			<Button
				variant={isEditing ? 'primary' : 'outline'}
				size="sm"
				onClick={toggleEdit}
				aria-pressed={isEditing}
			>
				<Pencil className="w-3.5 h-3.5" />
				{isEditing ? 'Done' : 'Edit'}
			</Button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function EditableGrid({ className }: { className?: string }) {
	const { visible, hidden, isEditing, variant, reorder, addTile, replaceTile, picker, openPicker, closePicker } =
		useEditable();

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	function onDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		reorder(String(active.id), String(over.id));
	}

	// Group visible tiles by catalog section, preserving tile order within each
	// group and first-appearance order across groups. Sectionless tiles form a
	// single unnamed group, so dashboards without sections keep the flat grid.
	const groups = useMemo(() => {
		const out: { title: string | null; tiles: RenderedTile[] }[] = [];
		const index = new Map<string, number>();
		for (const t of visible) {
			const key = t.section ?? '';
			let i = index.get(key);
			if (i === undefined) {
				i = out.length;
				index.set(key, i);
				out.push({ title: t.section ?? null, tiles: [] });
			}
			out[i].tiles.push(t);
		}
		return out;
	}, [visible]);

	const gridCls = clsx(
		'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
		variant === 'overview' ? 'gap-4' : 'gap-3',
	);

	return (
		<>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={onDragEnd}
			>
				<SortableContext
					items={visible.map((t) => t.key)}
					strategy={rectSortingStrategy}
				>
					<div className={clsx('mb-6 space-y-6', className)}>
						{groups.map((group, gi) => (
							<section key={group.title ?? `_flat_${gi}`}>
								{group.title && (
									<div className="flex items-center gap-3 mb-3">
										<h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
											{group.title}
										</h2>
										<div className="flex-1 h-px bg-slate-200 dark:bg-slate-700/60" />
									</div>
								)}
								<div className={gridCls}>
									{group.tiles.map((tile) => (
										<SortableTile
											key={tile.key}
											tile={tile}
											variant={variant}
											isEditing={isEditing}
										/>
									))}
									{isEditing && gi === groups.length - 1 && (
										<AddTileCard hasHidden={hidden.length > 0} onClick={() => openPicker()} />
									)}
								</div>
							</section>
						))}
						{groups.length === 0 && isEditing && (
							<div className={gridCls}>
								<AddTileCard hasHidden={hidden.length > 0} onClick={() => openPicker()} />
							</div>
						)}
					</div>
				</SortableContext>
			</DndContext>

			{isEditing && picker.open && (
				<TilePicker
					hidden={hidden}
					replacingLabel={
						picker.replacing ? (visible.find((t) => t.key === picker.replacing)?.label ?? null) : null
					}
					onPick={(key) => {
						if (picker.replacing) replaceTile(picker.replacing, key);
						else addTile(key);
						closePicker();
					}}
					onClose={closePicker}
				/>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// Sortable tile
// ---------------------------------------------------------------------------

interface SortableTileProps {
	tile: RenderedTile;
	variant: Variant;
	isEditing: boolean;
}

function SortableTile({ tile, variant, isEditing }: SortableTileProps) {
	const { removeTile, openPicker } = useEditable();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: tile.key,
		disabled: !isEditing,
	});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const showArrow = variant === 'overview';

	const content = (
		<Card
			className={clsx(
				'h-full transition-colors',
				variant === 'overview' &&
					!isEditing &&
					'hover:border-primary-300 dark:hover:border-primary-700',
				isEditing &&
					'border-dashed border-primary-300 dark:border-primary-700 cursor-grab active:cursor-grabbing',
			)}
		>
			<div
				className={clsx(
					'flex items-start justify-between',
					variant === 'overview' ? 'mb-3' : 'mb-2',
				)}
			>
				<div className="w-8 h-8 rounded-md bg-primary-50 dark:bg-primary-950 flex items-center justify-center">
					{tile.icon}
				</div>
				<div className="flex items-center gap-1">
					{isEditing && (
						<TileMenu
							onReplace={() => openPicker(tile.key)}
							onRemove={() => removeTile(tile.key)}
						/>
					)}
					{showArrow && (
						<ArrowUpRight
							className={clsx(
								'w-4 h-4 transition-colors',
								isEditing
									? 'text-slate-300 dark:text-slate-600'
									: 'text-slate-300 dark:text-slate-600 group-hover:text-primary-500',
							)}
						/>
					)}
				</div>
			</div>
			<p className="text-xs text-slate-500 dark:text-slate-400">{tile.label}</p>
			{tile.stats ? (
				<TileStatsBody tile={tile} />
			) : (
				<>
					<p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
						{tile.value}
					</p>
					<p className="text-xs text-slate-400 mt-1">{tile.subtitle}</p>
				</>
			)}
		</Card>
	);

	if (isEditing) {
		return (
			<div
				ref={setNodeRef}
				style={style}
				{...attributes}
				{...listeners}
				className="touch-none"
			>
				{content}
			</div>
		);
	}

	if (tile.href) {
		return (
			<div ref={setNodeRef} style={style}>
				<Link href={tile.href} className="block group">
					{content}
				</Link>
			</div>
		);
	}

	return (
		<div ref={setNodeRef} style={style}>
			{content}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Sheet-fed card body: value + delta chip, then either the target bar (weekly
// tiles) or the week line + 7-day reading (daily tiles).
// ---------------------------------------------------------------------------

const deltaCls = (tone: TileDelta['tone']) =>
	clsx(
		tone === 'good' && 'text-green-600 dark:text-green-400',
		tone === 'bad' && 'text-red-600 dark:text-red-400',
		tone === 'neutral' && 'text-slate-400 dark:text-slate-500',
	);

const arrowFor = (dir: TileDelta['dir']) => (dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·');

function TileStatsBody({ tile }: { tile: RenderedTile }) {
	const stats = tile.stats!;
	const { delta, target } = stats;
	const secondary = stats.secondary ?? null;

	return (
		<>
			<div className="flex items-baseline gap-2 flex-wrap mt-0.5">
				<p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
					{tile.value}
				</p>
				{delta && (
					<span
						className={clsx(
							'text-2xs font-semibold px-1.5 py-0.5 rounded-full tabular-nums',
							delta.tone === 'good' &&
								'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950/40',
							delta.tone === 'bad' &&
								'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/40',
							delta.tone === 'neutral' &&
								'text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-700/50',
						)}
					>
						{arrowFor(delta.dir)} {delta.text}
					</span>
				)}
			</div>
			{delta && (
				<p className="text-2xs text-slate-400 dark:text-slate-500 mt-0.5">{delta.note}</p>
			)}
			{target ? (
				<div className="mt-3">
					<div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
						<div
							className={clsx(
								'h-full rounded-full',
								target.hit ? 'bg-green-500' : 'bg-primary-500',
							)}
							style={{ width: `${target.barPct}%` }}
						/>
					</div>
					<div className="flex items-center justify-between gap-2 mt-1.5 text-2xs tabular-nums">
						<span
							className={clsx(
								'font-medium shrink-0',
								target.hit
									? 'text-green-600 dark:text-green-400'
									: 'text-slate-500 dark:text-slate-400',
							)}
						>
							{target.hit ? '✓ ' : ''}
							{target.label}
						</span>
						<span className="text-slate-400 dark:text-slate-500 truncate">{target.detail}</span>
					</div>
				</div>
			) : (
				<div className="mt-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700 space-y-0.5">
					{secondary && (
						<p className="text-2xs flex items-baseline gap-1.5 flex-wrap tabular-nums">
							<span className="text-slate-400 dark:text-slate-500">{secondary.label}</span>
							<span className="font-medium text-slate-600 dark:text-slate-300">
								{secondary.value}
							</span>
							{secondary.delta && (
								<span className={clsx('font-semibold', deltaCls(secondary.delta.tone))}>
									{arrowFor(secondary.delta.dir)} {secondary.delta.text}
								</span>
							)}
							{secondary.note && (
								<span className="text-slate-400 dark:text-slate-500">{secondary.note}</span>
							)}
						</p>
					)}
					<p className="text-2xs text-slate-400 dark:text-slate-500">{tile.subtitle}</p>
				</div>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// Gear menu
// ---------------------------------------------------------------------------

function TileMenu({ onReplace, onRemove }: { onReplace: () => void; onRemove: () => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, [open]);

	const stop = (e: React.SyntheticEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};

	return (
		<div
			ref={ref}
			className="relative"
			onPointerDown={stop}
			onMouseDown={stop}
			onClick={stop}
		>
			<button
				type="button"
				onClick={(e) => {
					stop(e);
					setOpen((v) => !v);
				}}
				aria-label="Tile options"
				aria-expanded={open}
				className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
			>
				<Settings className="w-4 h-4" />
			</button>
			{open && (
				<div
					role="menu"
					className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-panel py-1 text-sm"
				>
					<button
						type="button"
						role="menuitem"
						onClick={(e) => {
							stop(e);
							setOpen(false);
							onReplace();
						}}
						className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
					>
						<ArrowLeftRight className="w-3.5 h-3.5" />
						Replace KPI
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={(e) => {
							stop(e);
							setOpen(false);
							onRemove();
						}}
						className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
					>
						<Trash2 className="w-3.5 h-3.5" />
						Remove
					</button>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Add-a-tile card + picker modal
// ---------------------------------------------------------------------------

function AddTileCard({ hasHidden, onClick }: { hasHidden: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={!hasHidden}
			title={hasHidden ? 'Add a KPI' : 'Every KPI in the sheet is already pinned here'}
			className="h-full min-h-[7.5rem] rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-white/40 dark:bg-slate-800/40 hover:border-primary-400 dark:hover:border-primary-600 hover:bg-primary-50/40 dark:hover:bg-primary-950/40 text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex flex-col items-center justify-center gap-1.5 group disabled:opacity-50 disabled:hover:border-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
			aria-label="Add a KPI"
		>
			<div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-700 group-hover:bg-primary-100 dark:group-hover:bg-primary-900 flex items-center justify-center transition-colors">
				<Plus className="w-4 h-4" />
			</div>
			<span className="text-xs font-medium">Add a KPI</span>
		</button>
	);
}

function TilePicker({
	hidden,
	replacingLabel,
	onPick,
	onClose,
}: {
	hidden: RenderedTile[];
	/** Label of the card being swapped, or null when adding a new one. */
	replacingLabel: string | null;
	onPick: (key: string) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState('');

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	// A department has 15-57 metrics off the grid, so the list needs a search box.
	const q = query.trim().toLowerCase();
	const matches = q
		? hidden.filter(
				(t) => t.label.toLowerCase().includes(q) || (t.subtitle ?? '').toLowerCase().includes(q),
			)
		: hidden;
	const title = replacingLabel ? `Replace “${replacingLabel}”` : 'Add a KPI';

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label={title}
				className="w-full max-w-lg rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-panel"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="px-3 pt-3">
					<SearchInput
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search KPI…"
						aria-label="Search KPI"
						className="w-full"
					/>
				</div>
				<div className="p-3 max-h-[60vh] overflow-y-auto">
					{hidden.length === 0 ? (
						<p className="text-sm text-slate-500 dark:text-slate-400 p-2">
							Every KPI in the sheet is already pinned on this dashboard.
						</p>
					) : matches.length === 0 ? (
						<p className="text-sm text-slate-500 dark:text-slate-400 p-2">
							No KPI matches “{query}”.
						</p>
					) : (
						<ul className="space-y-1">
							{matches.map((tile) => (
								<li key={tile.key}>
									<button
										type="button"
										onClick={() => onPick(tile.key)}
										className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left transition-colors"
									>
										<div className="w-8 h-8 rounded-md bg-primary-50 dark:bg-primary-950 flex items-center justify-center shrink-0">
											{tile.icon}
										</div>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
												{tile.label}
											</p>
											<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
												{tile.subtitle}
											</p>
										</div>
										<span className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums shrink-0">
											{tile.value}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
