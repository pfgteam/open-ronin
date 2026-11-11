'use client';

// Global search in the header: features/pages (navConfig, filtered by the
// viewer's modules + visibility), people, clients and media records.
//
// Pages are matched locally (searchIndex.ts). Records go through the
// searchRecords server action with the viewer's session, debounced, from two
// characters on; RLS decides what comes back.
//
// Keyboard: "/" focuses the box from anywhere (ignored while typing in an
// input, and when a page's own "/" handler — The Work list views — already
// took the focus). ⌘K / Ctrl+K opens the "+ New" palette (nav/NewMenu). Arrow
// keys move through the flat result list across groups, Enter opens, Escape closes.
//
// Below md the box collapses to an icon that opens a full-width panel under
// the header, so the tab row keeps its space on narrow screens.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { clsx } from 'clsx';
import { Building2, CheckSquare, Compass, LayoutList, Megaphone, Newspaper, PenLine, Search, User as UserIcon, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import SearchInput from '@/components/ui/SearchInput';
import { useAuthStore } from '@/stores/auth';
import { buildFeatureIndex, normalizeQuery, searchFeatures, type FeatureHit } from './searchIndex';
import { searchRecords } from './searchActions';
import { EMPTY_RECORD_RESULT, MIN_RECORD_QUERY, type RecordHit, type RecordKind, type RecordSearchResult } from './searchShared';

const DEBOUNCE_MS = 200;
const FEATURE_LIMIT = 6;

type Item =
	| { group: 'Pages'; id: string; href: string; title: string; subtitle: string | null; icon: LucideIcon; wip: boolean }
	| { group: 'Work' | 'People' | 'Clients' | 'Media'; id: string; href: string; title: string; subtitle: string | null; icon: LucideIcon; wip: false };

const RECORD_ICON: Record<RecordKind, LucideIcon> = {
	person: UserIcon,
	client: Building2,
	outlet: Newspaper,
	journalist: PenLine,
	opportunity: Megaphone,
	work_item: CheckSquare,
	board: LayoutList,
};

function isTypingTarget(el: Element | null): boolean {
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function toItems(features: FeatureHit[], records: RecordSearchResult): Item[] {
	const out: Item[] = features.map((f) => ({
		group: 'Pages' as const,
		id: `page:${f.href}`,
		href: f.href,
		title: f.label,
		subtitle: f.section || null,
		icon: Compass,
		wip: f.wip,
	}));
	const rec = (group: 'Work' | 'People' | 'Clients' | 'Media', hits: RecordHit[]) =>
		hits.map((h) => ({ group, id: h.id, href: h.href, title: h.title, subtitle: h.subtitle, icon: RECORD_ICON[h.kind], wip: false as const }));
	out.push(...rec('Work', records.work), ...rec('People', records.people), ...rec('Clients', records.clients), ...rec('Media', records.media));
	return out;
}

export default function GlobalSearch() {
	const router = useRouter();
	const { profile, modules } = useAuthStore();
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const [active, setActive] = useState(0);
	// Records are tagged with the query they answer. Anything else in the box
	// means they are stale: they are not shown and Enter can't open them (typing
	// "jan" then Enter inside the debounce used to open a hit for "ja").
	const [recordState, setRecordState] = useState<{ q: string; res: RecordSearchResult }>({ q: '', res: EMPTY_RECORD_RESULT });
	const [pending, startTransition] = useTransition();
	const inputRef = useRef<HTMLInputElement>(null);
	const mobileInputRef = useRef<HTMLInputElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const listId = 'global-search-results';
	// Only the newest request may write results: a slow early response must
	// not overwrite the answer to what is in the box now.
	const requestSeq = useRef(0);

	const featureIndex = useMemo(() => buildFeatureIndex(profile, modules), [profile, modules]);
	const features = useMemo(() => searchFeatures(featureIndex, query, profile?.id, FEATURE_LIMIT), [featureIndex, query, profile?.id]);
	const normalized = normalizeQuery(query);
	const records = recordState.q === normalized ? recordState.res : EMPTY_RECORD_RESULT;
	// True from the keystroke until the matching answer lands — covers the
	// debounce gap, where useTransition's pending is still false.
	const searching = normalized.length >= MIN_RECORD_QUERY && recordState.q !== normalized;
	const items = useMemo(() => toItems(features, records), [features, records]);

	// Debounced record search.
	useEffect(() => {
		const seq = ++requestSeq.current;
		if (normalized.length < MIN_RECORD_QUERY) {
			setRecordState({ q: normalized, res: EMPTY_RECORD_RESULT });
			return;
		}
		const t = setTimeout(() => {
			startTransition(async () => {
				const res = await searchRecords(normalized);
				if (requestSeq.current === seq) setRecordState({ q: normalized, res });
			});
		}, DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [normalized]);

	// Reset the highlight when the list changes.
	useEffect(() => {
		setActive(0);
	}, [items.length, normalized]);

	// "/" focuses the box. Deferred one tick so a page-level "/" handler that
	// focuses its own search box (The Work lists) wins when both are mounted.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
			if (isTypingTarget(document.activeElement)) return;
			// A modal or drawer owns the keyboard: "/" must not pull focus to
			// the header behind its overlay.
			if (document.querySelector('[aria-modal="true"], [role="dialog"]')) return;
			e.preventDefault();
			setTimeout(() => {
				const el = document.activeElement;
				if (isTypingTarget(el) && el !== inputRef.current && el !== mobileInputRef.current) return;
				if (inputRef.current && inputRef.current.offsetParent !== null) {
					inputRef.current.focus();
					inputRef.current.select();
				} else {
					setMobileOpen(true);
				}
			}, 0);
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	// Focus the panel's input once it renders.
	useEffect(() => {
		if (mobileOpen) mobileInputRef.current?.focus();
	}, [mobileOpen]);

	// Close on outside click (same pattern as the account menu).
	useEffect(() => {
		if (!open && !mobileOpen) return;
		function handler(e: MouseEvent) {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
				setMobileOpen(false);
			}
		}
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [open, mobileOpen]);

	const close = useCallback(() => {
		setOpen(false);
		setMobileOpen(false);
	}, []);

	const go = useCallback(
		(item: Item | undefined) => {
			if (!item) return;
			close();
			setQuery('');
			router.push(item.href);
		},
		[close, router],
	);

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (items.length) setActive((i) => (i + 1) % items.length);
			setOpen(true);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (items.length) setActive((i) => (i - 1 + items.length) % items.length);
		} else if (e.key === 'Enter') {
			if (items.length) {
				e.preventDefault();
				go(items[active]);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (query) setQuery('');
			else {
				close();
				(e.target as HTMLInputElement).blur();
			}
		} else if (e.key === 'Tab') {
			close();
		}
	}

	const showList = (open || mobileOpen) && normalized.length > 0;
	const nothing = showList && !searching && !pending && items.length === 0 && normalized.length >= MIN_RECORD_QUERY;

	const inputProps = {
		value: query,
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
			setQuery(e.target.value);
			setOpen(true);
		},
		onFocus: () => setOpen(true),
		onKeyDown,
		placeholder: 'Search everything',
		autoComplete: 'off',
		spellCheck: false,
		role: 'combobox',
		'aria-expanded': showList,
		'aria-controls': listId,
		'aria-autocomplete': 'list' as const,
		'aria-activedescendant': showList && items[active] ? `gs-${items[active].id}` : undefined,
	};

	const list = showList && (
		<ul
			id={listId}
			role="listbox"
			aria-label="Search results"
			className="max-h-[70vh] overflow-y-auto py-1"
		>
			{items.map((item, idx) => {
				const first = idx === 0 || items[idx - 1].group !== item.group;
				const Icon = item.icon;
				const isActive = idx === active;
				return (
					<li key={item.id} role="presentation">
						{first && (
							<div className={clsx('px-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400', idx > 0 && 'mt-1 pt-2 border-t border-slate-200 dark:border-slate-700')}>
								{item.group}
							</div>
						)}
						<button
							type="button"
							id={`gs-${item.id}`}
							role="option"
							aria-selected={isActive}
							onMouseEnter={() => setActive(idx)}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => go(item)}
							className={clsx(
								'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors',
								isActive
									? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300'
									: 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
							)}
						>
							<Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
							<span className="flex-1 min-w-0">
								<span className="block truncate font-medium">{item.title}</span>
								{item.subtitle && (
									<span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</span>
								)}
							</span>
							{item.wip && (
								<span className="shrink-0 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
									WIP
								</span>
							)}
						</button>
					</li>
				);
			})}
			{(searching || pending) && normalized.length >= MIN_RECORD_QUERY && (
				<li className="px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500" role="presentation">
					Searching records…
				</li>
			)}
			{nothing && (
				<li className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400 text-center" role="presentation">
					No matches for “{query.trim()}”
				</li>
			)}
			{!pending && normalized.length > 0 && normalized.length < MIN_RECORD_QUERY && (
				<li className="px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500" role="presentation">
					Type {MIN_RECORD_QUERY}+ characters to search work, people, clients and media
				</li>
			)}
			{records.error && (
				<li className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400" role="presentation">
					{records.error}
				</li>
			)}
		</ul>
	);

	return (
		<div ref={rootRef} className="relative shrink-0">
			{/* ≥md: inline box in the header. Kept narrow so the tab row keeps
			    its labels as long as possible (TopNav drops them on overflow). */}
			<div className="relative hidden md:block w-44 lg:w-52 xl:w-64">
				<SearchInput ref={inputRef} aria-label="Search pages, work, people, clients and media" {...inputProps} />
				{!query && !open && (
					<kbd
						aria-hidden="true"
						className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-2xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 pointer-events-none"
					>
						/
					</kbd>
				)}
				{open && !mobileOpen && (
					<div className="absolute right-0 top-full mt-1.5 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-panel border border-slate-200 dark:border-slate-700 z-50">
						{list || (
							<p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
								Pages, boards, work items, people, clients, outlets, journalists, opportunities
							</p>
						)}
					</div>
				)}
			</div>

			{/* <md: icon that opens a full-width panel under the header. */}
			<button
				type="button"
				onClick={() => setMobileOpen((v) => !v)}
				aria-label="Search"
				aria-expanded={mobileOpen}
				className="md:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
			>
				<Search className="w-4 h-4" aria-hidden="true" />
			</button>
			{mobileOpen && (
				<div className="md:hidden fixed inset-x-0 top-12 z-50 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-panel">
					<div className="flex items-center gap-2 px-3 py-2">
						<SearchInput ref={mobileInputRef} aria-label="Search pages, work, people, clients and media" className="flex-1" {...inputProps} />
						<button
							type="button"
							onClick={close}
							aria-label="Close search"
							className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
						>
							<X className="w-4 h-4" aria-hidden="true" />
						</button>
					</div>
					{list}
				</div>
			)}
		</div>
	);
}
