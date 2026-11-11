'use client';

// "+ New" — the Gmail-compose button at the top of the sidebar, and the
// Ctrl+K / ⌘K command palette (menu restructure, 2026-10-23). One panel, two
// entry points:
//   - empty box: the CREATE and REQUEST groups from the sheet's Request Types
//     tab (navConfig.newMenuGroups), filtered by the viewer's modules.
//   - typing: the same options filtered by label, plus every menu page the
//     viewer may open (searchIndex.buildFeatureIndex, the data GlobalSearch
//     uses). "time off" → Request › Time off; "kpi" → Company › KPIs.
// Task fires the `or-quick-add` event (GlobalNewTask → NewItemModal) so a
// task is still created the one way it is everywhere else. Records are NOT
// searched here — that is the header search ("/").

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Compass, Plus, Sparkles, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import SearchInput from '@/components/ui/SearchInput';
import { useAuthStore } from '@/stores/auth';
import { isItemVisible, isSoonHref, newMenuGroups, type NewMenuOption } from './navConfig';
import { buildFeatureIndex, normalizeQuery, searchFeatures } from './searchIndex';
import { OPEN_NEW_EVENT, withParams, type NewMenuPreset } from './newMenuEvents';

const PAGE_LIMIT = 6;

interface Row {
	id: string;
	group: 'Create' | 'Request' | 'Go to';
	title: string;
	subtitle: string | null;
	icon: LucideIcon;
	soon: boolean;
	run: () => void;
}

export function resolveOptionHref(option: NewMenuOption, profileId: string | null | undefined): string | null {
	if (!option.href) return null;
	if (!option.href.includes('{me}')) return option.href;
	return profileId ? option.href.replace('{me}', profileId) : null;
}

export default function NewMenu({ className, initialOpen = false, initialQuery = '', compact = false }: {
	className?: string;
	/** Server-render / test hooks: render the palette already open (with a query typed). */
	initialOpen?: boolean;
	initialQuery?: string;
	/** Icon-only trigger (the sidebar's level-1 column is collapsed). */
	compact?: boolean;
}) {
	const router = useRouter();
	const { profile, modules } = useAuthStore();
	const [open, setOpen] = useState(initialOpen);
	const [query, setQuery] = useState(initialQuery);
	const [active, setActive] = useState(0);
	// Contextual buttons (RequestButton) open the palette with one option
	// preselected and page context (client) riding on the option hrefs.
	const [preset, setPreset] = useState<NewMenuPreset | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	const close = () => {
		setOpen(false);
		setQuery('');
		setActive(0);
		setPreset(null);
	};

	useEffect(() => {
		const onOpen = (e: Event) => {
			const detail = (e as CustomEvent<NewMenuPreset>).detail ?? {};
			setPreset(detail);
			setQuery('');
			setOpen(true);
		};
		window.addEventListener(OPEN_NEW_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_NEW_EVENT, onOpen);
	}, []);

	// Ctrl+K / ⌘K opens the palette from anywhere (not over another dialog).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || (e.key !== 'k' && e.key !== 'K')) return;
			e.preventDefault();
			if (!open && document.querySelector('[role="dialog"]')) return;
			setOpen((v) => !v);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	useEffect(() => {
		if (open) setTimeout(() => inputRef.current?.focus(), 0);
	}, [open]);

	const featureIndex = useMemo(() => buildFeatureIndex(profile, modules), [profile, modules]);
	const normalized = normalizeQuery(query);

	const rows = useMemo<Row[]>(() => {
		const out: Row[] = [];
		const go = (href: string) => () => {
			close();
			router.push(href);
		};
		for (const group of newMenuGroups) {
			for (const option of group.options) {
				if (!isItemVisible(option, profile, modules)) continue;
				const raw = resolveOptionHref(option, profile?.id);
				// Page context (?client=) rides on real pages only, not placeholders.
				const href = raw && !isSoonHref(raw) ? withParams(raw, preset?.context?.params) : raw;
				const event = option.event;
				const run = event
					? () => {
							close();
							window.dispatchEvent(new Event(event));
						}
					: href
						? go(href)
						: null;
				if (!run) continue;
				const hay = `${option.label} ${option.hint}`.toLowerCase();
				if (normalized && !hay.includes(normalized)) continue;
				out.push({
					id: `${group.title}:${option.label}`,
					group: group.title,
					title: option.label,
					subtitle: option.hint,
					icon: group.title === 'Create' ? Sparkles : Send,
					soon: !!href && isSoonHref(href),
					run,
				});
			}
		}
		if (normalized) {
			for (const hit of searchFeatures(featureIndex, normalized, profile?.id, PAGE_LIMIT)) {
				out.push({
					id: `page:${hit.href}`,
					group: 'Go to',
					title: hit.label,
					subtitle: hit.section || null,
					icon: Compass,
					soon: isSoonHref(hit.href),
					run: go(hit.href),
				});
			}
		}
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [normalized, profile, modules, featureIndex, preset]);

	useEffect(() => {
		// A preset option starts highlighted (Enter takes it); otherwise the first row.
		const idx = !normalized && preset?.option ? rows.findIndex((r) => r.group !== 'Go to' && r.title === preset.option) : -1;
		setActive(idx >= 0 ? idx : 0);
	}, [normalized, rows, preset]);

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (rows.length) setActive((i) => (i + 1) % rows.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (rows.length) setActive((i) => (i - 1 + rows.length) % rows.length);
		} else if (e.key === 'Enter') {
			if (rows[active]) {
				e.preventDefault();
				rows[active].run();
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (query) setQuery('');
			else {
				close();
				buttonRef.current?.focus();
			}
		}
	}

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				onClick={() => setOpen(true)}
				aria-haspopup="dialog"
				aria-expanded={open}
				title="New or request anything (Ctrl+K)"
				className={clsx(
					'flex items-center rounded-lg text-13 font-semibold transition-colors duration-150 motion-reduce:transition-none',
					// Compact: the icon column of the nav v2 sidebar (second column open).
					compact ? 'mx-auto h-9 w-10 justify-center' : 'gap-2 w-full px-3 py-2',
					'bg-primary-600 text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-400 dark:text-slate-900',
					className,
				)}
			>
				<Plus className="w-4 h-4" aria-hidden="true" />
				<span className={compact ? 'sr-only' : 'flex-1 text-left'}>New</span>
				{!compact && (
					<kbd aria-hidden="true" className="hidden lg:inline text-2xs font-mono font-normal opacity-70">
						Ctrl K
					</kbd>
				)}
			</button>

			{open && (
				<div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
					<div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={close} aria-hidden="true" />
					<div
						role="dialog"
						aria-modal="true"
						aria-label="New or request"
						className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-panel overflow-hidden"
					>
						<div className="px-3 pt-3 pb-2 border-b border-slate-200 dark:border-slate-700">
							<SearchInput
								ref={inputRef}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={onKeyDown}
								placeholder="Create, request, or jump to a page…"
								aria-label="Create, request, or jump to a page"
								autoComplete="off"
								spellCheck={false}
								role="combobox"
								aria-expanded
								aria-controls="new-menu-options"
								aria-autocomplete="list"
								aria-activedescendant={rows[active] ? `nm-${rows[active].id}` : undefined}
							/>
							{preset?.context && (
								<p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
									For <span className="font-semibold text-slate-900 dark:text-slate-100">{preset.context.label}</span>: the request opens prefilled.
								</p>
							)}
						</div>
						<ul id="new-menu-options" role="listbox" aria-label="Options" className="max-h-[60vh] overflow-y-auto py-1">
							{rows.map((row, idx) => {
								const first = idx === 0 || rows[idx - 1].group !== row.group;
								const Icon = row.icon;
								const isActive = idx === active;
								return (
									<li key={row.id} role="presentation">
										{first && (
											<div
												className={clsx(
													'px-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400',
													idx > 0 && 'mt-1 pt-2 border-t border-slate-200 dark:border-slate-700',
												)}
											>
												{row.group}
											</div>
										)}
										<button
											type="button"
											id={`nm-${row.id}`}
											role="option"
											aria-selected={isActive}
											onMouseEnter={() => setActive(idx)}
											onMouseDown={(e) => e.preventDefault()}
											onClick={row.run}
											className={clsx(
												'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors',
												isActive
													? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300'
													: 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
											)}
										>
											<Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
											<span className="flex-1 min-w-0">
												<span className="block truncate font-medium">{row.title}</span>
												{row.subtitle && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{row.subtitle}</span>}
											</span>
											{row.soon && (
												<span className="shrink-0 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
													Soon
												</span>
											)}
										</button>
									</li>
								);
							})}
							{rows.length === 0 && (
								<li className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400 text-center" role="presentation">
									No matches for “{query.trim()}”
								</li>
							)}
						</ul>
					</div>
				</div>
			)}
		</>
	);
}
