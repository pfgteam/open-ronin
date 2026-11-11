'use client';

// Sidebar, built to the "Alex draft (original)" tab (navConfig.ts).
//
//   Section headings — the menu's major title in bold at the top; every other
//   heading sits inline on a horizontal line ("Title inline with horizontal
//   line"). Headings are links: they open the first page under them.
//   Primary rows — icon + label. A row with sub items opens the SECOND
//   COLUMN: text only, separated from the first by a vertical line, with a
//   "Close panel" control at the bottom. While it is open the first column
//   collapses to icons only (tooltip = aria-label; headings shrink to their
//   line) and never goes away, so one click jumps sideways. Clicking the row
//   whose panel is open keeps the page and the panel. The open panel follows
//   the route (deep links and refreshes open it), unless the viewer closed it
//   on this URL.
//   Tablet / narrow (< lg): the second column slides OVER the page, opened by
//   tapping its row; tapping outside, Esc, Close panel or picking a page
//   dismisses it. Two levels max; tabs on a page are PageTabs.
//
// Data + visibility: navConfig.ts; tree + active row: navModel.ts.
//
// Keyboard: Tab walks every row; Up/Down (Home/End) move within a column,
// Right goes into the open panel, Left back to its primary row, Esc closes
// the panel. Focus moves into the panel when a click opens it.
//
// The first column is resizable when expanded (Sam, 19/08/2026): drag
// the right edge between MIN and MAX px; the width persists per-browser in
// localStorage. Double-click the handle to reset (240px).

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/stores/auth';
import { withServiceLines, type ServiceLineNav } from './serviceLineNav';
import Button from '@/components/ui/Button';
import { controlFocus } from '@/components/ui/focus';
import { sectionByKey } from './navConfig';
import { itemIcons } from './navIcons';
import { allTops, resolveActive, visibleNav, type NavBadge, type VisibleGroup, type VisibleTop } from './navModel';
import { useCurrentSection } from './menuPreference';
import { useNavFlags } from './navFlags';
import NewMenu from './NewMenu';

const SIDENAV_WIDTH_KEY = 'or-sidenav-width';
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 176;
const MAX_WIDTH = 384;
const PANEL_ID = 'or-nav-panel';
/** lg: at and above it the second column pushes the page; below it, it overlays. */
const WIDE_QUERY = '(min-width: 1024px)';

function clampWidth(w: number): number {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

function subscribeWide(cb: () => void): () => void {
	const m = window.matchMedia(WIDE_QUERY);
	m.addEventListener('change', cb);
	return () => m.removeEventListener('change', cb);
}

/** Desktop on the server and during hydration; the real answer right after. */
function useIsWide(): boolean {
	return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
}

function isPlainClick(e: React.MouseEvent): boolean {
	return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

const rowBase = 'transition-colors duration-150 motion-reduce:transition-none';
const rowIdle = 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100';
const rowLit = 'bg-primary-50 dark:bg-primary-950 text-primary-900 dark:text-primary-300 font-semibold';

function Badge({ badge }: { badge: NavBadge }) {
	if (!badge) return null;
	return (
		<span
			className="shrink-0 text-2xs font-medium tabular-nums text-amber-800 dark:text-amber-300"
			title={badge === 'soon' ? 'Planned — not built yet. Opens a placeholder with the spec.' : 'In development — hidden from the rest of the team'}
		>
			{badge === 'soon' ? 'Soon' : 'WIP'}
		</span>
	);
}

/** A section heading: the bold major title, or the title inline on a line. `current` = the heading's own page is open. */
function Heading({ group, collapsed, first, current }: { group: VisibleGroup; collapsed: boolean; first: boolean; current: boolean }) {
	if (collapsed) {
		// Icons only: a heading keeps its line (the major title has none).
		return group.major ? null : <div aria-hidden="true" data-nav-heading={group.title} className="mx-1.5 my-2 h-px bg-slate-200 dark:bg-slate-700" />;
	}
	if (group.major) {
		return (
			<Link
				href={group.href}
				aria-current={current ? 'page' : undefined}
				data-nav-heading={group.title}
				className={clsx('block truncate rounded-md px-2.5 pb-1.5 text-13 font-bold text-slate-900 hover:text-primary-700 dark:text-slate-100 dark:hover:text-primary-300', first ? 'pt-0.5' : 'pt-3', controlFocus)}
			>
				{group.title}
			</Link>
		);
	}
	return (
		<div className="flex items-center gap-2 px-2.5 pb-1 pt-3" data-nav-heading={group.title}>
			<Link
				href={group.href}
				aria-current={current ? 'page' : undefined}
				className={clsx(
					'shrink-0 rounded-sm text-xs font-medium',
					current ? 'text-primary-700 dark:text-primary-300' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
					controlFocus,
				)}
			>
				{group.title}
			</Link>
			<span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
		</div>
	);
}

export default function SideNav({ serviceLines }: { serviceLines?: ServiceLineNav[] } = {}) {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const search = searchParams.toString();
	const here = search ? `${pathname}?${search}` : pathname;
	const { profile, modules, init, initialized } = useAuthStore();
	const wide = useIsWide();
	const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
	const dragging = useRef(false);
	const asideRef = useRef<HTMLElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const topRefs = useRef(new Map<string, HTMLAnchorElement>());
	const focusPanelNext = useRef(false);
	const focusTopNext = useRef<string | null>(null);
	// Primary-row tooltip while the column shows icons only (text = the row's aria-label).
	const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

	// Read the persisted width once on mount (SSR renders the default).
	useEffect(() => {
		const stored = Number(localStorage.getItem(SIDENAV_WIDTH_KEY));
		if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) {
			setWidth(stored);
		}
	}, []);

	const startResize = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		dragging.current = true;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		const onMove = (ev: PointerEvent) => {
			if (!dragging.current) return;
			// The first column's left edge is the viewport's left edge.
			setWidth(clampWidth(ev.clientX));
		};
		const onUp = (ev: PointerEvent) => {
			dragging.current = false;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			localStorage.setItem(SIDENAV_WIDTH_KEY, String(clampWidth(ev.clientX)));
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}, []);

	const resetWidth = useCallback(() => {
		setWidth(DEFAULT_WIDTH);
		localStorage.removeItem(SIDENAV_WIDTH_KEY);
	}, []);

	// TopNav normally initializes the store, but don't depend on mount order.
	useEffect(() => {
		if (!initialized) void init();
	}, [initialized, init]);

	// The viewer's own capabilities (Growth › Acquisitions is "only
	// available to direct permission access users").
	const flags = useNavFlags(profile?.id);

	// Shared with TopNav's active tab (and PageTabs) so the three never
	// disagree — sectionForPath + the remembered menu, menuPreference.ts.
	const currentSection = useCurrentSection(pathname);
	const section = currentSection ? sectionByKey(currentSection) : undefined;
	const nav = useMemo<VisibleGroup[]>(
		() => (section ? visibleNav(withServiceLines(section.groups, serviceLines), { profile, modules, flags }) : []),
		[section, profile, modules, flags, serviceLines],
	);
	const tops = useMemo(() => allTops(nav), [nav]);
	const active = useMemo(() => resolveActive(nav, pathname, search), [nav, pathname, search]);

	// What the viewer just clicked, until the route catches up (a dev
	// compile can take seconds): the panel follows the click at once.
	const [intent, setIntent] = useState<{ key: string; from: string } | null>(null);
	const intentKey = intent && intent.from === here ? intent.key : null;
	// Desktop: the panel the viewer closed, for as long as they stay on that URL.
	const [closed, setClosed] = useState<{ key: string; at: string } | null>(null);
	// Narrow: the panel the viewer opened as an overlay, in this menu.
	const [overlay, setOverlay] = useState<{ key: string; section: string } | null>(null);

	const litKey = intentKey ?? active?.top ?? null;
	const byKey = (key: string | null) => (key ? tops.find((t) => t.key === key) : undefined);
	let panelTop: VisibleTop | undefined;
	if (wide) {
		const candidate = byKey(litKey);
		const shut = closed && closed.key === candidate?.key && closed.at === here;
		panelTop = candidate?.children.length && !shut ? candidate : undefined;
	} else if (overlay && overlay.section === currentSection) {
		panelTop = byKey(overlay.key);
		if (!panelTop?.children.length) panelTop = undefined;
	}
	const panelOpen = !!panelTop;
	const collapsed = panelOpen;
	const overlayOpen = panelOpen && !wide;

	const closePanel = useCallback(() => {
		if (!panelTop) return;
		focusTopNext.current = panelTop.key;
		if (wide) {
			setClosed({ key: panelTop.key, at: here });
			setIntent(null);
		} else {
			setOverlay(null);
		}
	}, [panelTop, wide, here]);

	// Focus moves into the panel when a click opened it; back to the
	// primary row when it closes.
	const panelKey = panelTop?.key ?? null;
	useEffect(() => {
		if (focusPanelNext.current && panelKey && panelRef.current) {
			focusPanelNext.current = false;
			const target = panelRef.current.querySelector<HTMLElement>('[aria-current="page"]') ?? panelRef.current.querySelector<HTMLElement>('[data-nav-col="2"]');
			target?.focus();
		}
		if (focusTopNext.current && !panelKey) {
			topRefs.current.get(focusTopNext.current)?.focus();
			focusTopNext.current = null;
		}
	}, [panelKey, pathname]);

	// The overlay closes on Esc from anywhere (focus may be on the page).
	useEffect(() => {
		if (!overlayOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !e.defaultPrevented) closePanel();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [overlayOpen, closePanel]);

	// Publish the sidebar's real width (both columns when the panel pushes
	// the page) as a CSS var so the TopNav can align its logo divider with
	// the sidebar's right border (Sam, 18/08). Cleared when this page has
	// no sidebar, so the header falls back to its natural layout.
	const hasItems = tops.length > 0;
	useEffect(() => {
		const el = asideRef.current;
		if (!hasItems || !el) {
			document.documentElement.style.removeProperty('--or-sidenav-w');
			return;
		}
		const set = () => document.documentElement.style.setProperty('--or-sidenav-w', `${el.offsetWidth}px`);
		set();
		const ro = new ResizeObserver(set);
		ro.observe(el);
		return () => {
			ro.disconnect();
			document.documentElement.style.removeProperty('--or-sidenav-w');
		};
	}, [hasItems]);

	if (!hasItems) return null;

	function showTip(e: React.SyntheticEvent<HTMLElement>, label: string) {
		const r = e.currentTarget.getBoundingClientRect();
		setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
	}

	function hideTip() {
		setTip(null);
	}

	function onTopClick(e: React.MouseEvent, top: VisibleTop) {
		if (!isPlainClick(e)) return;
		const isCurrent = top.key === active?.top;
		if (!top.children.length) {
			setIntent({ key: top.key, from: here });
			setOverlay(null);
			return;
		}
		focusPanelNext.current = true;
		setClosed(null);
		if (wide) {
			// The row whose panel is open (or just closed here): page stays.
			if (isCurrent) e.preventDefault();
			else setIntent({ key: top.key, from: here });
		} else {
			setOverlay({ key: top.key, section: currentSection });
			if (isCurrent) e.preventDefault();
		}
	}

	function onSubClick(e: React.MouseEvent) {
		if (!isPlainClick(e)) return;
		if (!wide) setOverlay(null);
	}

	function moveFocus(e: React.KeyboardEvent, col: '1' | '2') {
		const root = asideRef.current;
		if (!root) return;
		const rows = [...root.querySelectorAll<HTMLElement>(`[data-nav-col="${col}"]`)];
		const at = rows.indexOf(document.activeElement as HTMLElement);
		if (at === -1) return;
		let next: HTMLElement | undefined;
		if (e.key === 'ArrowDown') next = rows[Math.min(rows.length - 1, at + 1)];
		else if (e.key === 'ArrowUp') next = rows[Math.max(0, at - 1)];
		else if (e.key === 'Home') next = rows[0];
		else if (e.key === 'End') next = rows[rows.length - 1];
		else if (e.key === 'ArrowRight' && col === '1' && panelRef.current) {
			next = panelRef.current.querySelector<HTMLElement>('[aria-current="page"]') ?? panelRef.current.querySelector<HTMLElement>('[data-nav-col="2"]') ?? undefined;
		} else if (e.key === 'ArrowLeft' && col === '2' && panelTop) next = topRefs.current.get(panelTop.key);
		if (next) {
			e.preventDefault();
			next.focus();
		}
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Escape' && panelOpen) {
			e.preventDefault();
			closePanel();
			return;
		}
		const col = (document.activeElement as HTMLElement | null)?.dataset.navCol;
		if (col === '1' || col === '2') moveFocus(e, col);
	}

	return (
		<aside
			ref={asideRef}
			onKeyDown={onKeyDown}
			className="relative flex shrink-0 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700"
		>
			{/* First column: headings + primary rows */}
			<div
				style={collapsed ? undefined : { width }}
				className={clsx(
					'relative flex shrink-0 flex-col overflow-y-auto overflow-x-hidden',
					// The page scrolls the document (AppLayout is min-h-screen), so
					// both columns stick under the 48px TopNav and keep Close panel
					// on screen.
					'sticky top-12 h-[calc(100dvh-3rem)] self-start',
					collapsed && 'w-14',
					// Above the overlay's scrim, so a tap on another row still lands.
					overlayOpen && 'z-40 bg-white dark:bg-slate-800',
				)}
			>
				<nav aria-label={section ? `${section.label} menu` : 'Menu'} className="px-2 py-3">
					{/* "+ New" — top of the side menu (sheet row 12). */}
					<div className="pb-3">
						<NewMenu compact={collapsed} />
					</div>
					{nav.map((group, gi) => (
						<div key={group.key} role="group" aria-label={group.title}>
							<Heading group={group} collapsed={collapsed} first={gi === 0} current={!!group.ownPage && active?.top === group.key} />
							<ul className="space-y-px">
								{group.items.map((top) => {
									const Icon = itemIcons[top.icon];
									const lit = top.key === litKey;
									const isPage = lit && !top.children.length;
									return (
										<li key={top.key}>
											<Link
												ref={(el) => {
													if (el) topRefs.current.set(top.key, el);
													else topRefs.current.delete(top.key);
												}}
												href={top.href}
												data-nav-col="1"
												onClick={(e) => onTopClick(e, top)}
												onMouseEnter={collapsed ? (e) => showTip(e, top.label) : undefined}
												onMouseLeave={collapsed ? hideTip : undefined}
												onFocus={collapsed ? (e) => showTip(e, top.label) : undefined}
												onBlur={collapsed ? hideTip : undefined}
												aria-label={collapsed ? top.label : undefined}
												aria-current={isPage ? 'page' : lit ? 'true' : undefined}
												aria-expanded={top.children.length ? panelTop?.key === top.key : undefined}
												aria-controls={top.children.length && panelTop?.key === top.key ? PANEL_ID : undefined}
												className={clsx(
													'flex items-center rounded-md text-13',
													rowBase,
													controlFocus,
													collapsed ? 'mx-auto h-9 w-10 justify-center' : 'gap-2.5 px-2.5 py-1.5',
													lit ? rowLit : rowIdle,
												)}
											>
												<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
												{!collapsed && <span className="flex-1 truncate">{top.label}</span>}
												{!collapsed && <Badge badge={top.badge} />}
											</Link>
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</nav>
				{/* Resize handle — drag to resize, double-click to reset */}
				{!collapsed && wide && (
					<div
						onPointerDown={startResize}
						onDoubleClick={resetWidth}
						title="Drag to resize · double-click to reset"
						className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary-400/40 active:bg-primary-500/50 transition-colors duration-150 motion-reduce:transition-none"
					/>
				)}
			</div>

			{/* Second column: the sub menu. On narrow screens it slides over the page. */}
			{panelTop && (
				<>
					{overlayOpen && (
						<div aria-hidden="true" onClick={closePanel} className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[2px]" />
					)}
					<SecondColumn
						key={panelTop.key}
						panelRef={panelRef}
						top={panelTop}
						activeSub={active?.top === panelTop.key ? active.sub : null}
						overlay={overlayOpen}
						onPick={onSubClick}
						onClose={closePanel}
					/>
				</>
			)}

			{collapsed && tip && (
				<div
					role="tooltip"
					aria-hidden="true"
					style={{ top: tip.top, left: tip.left }}
					className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-panel dark:bg-slate-100 dark:text-slate-900"
				>
					{tip.label}
				</div>
			)}
		</aside>
	);
}

/**
 * The second column: text-only sub rows, the primary's name on top (the
 * icon column no longer shows it), "Close panel" at the bottom. In overlay
 * mode it slides in over the page.
 */
function SecondColumn({
	panelRef,
	top,
	activeSub,
	overlay,
	onPick,
	onClose,
}: {
	panelRef: React.RefObject<HTMLDivElement | null>;
	top: VisibleTop;
	activeSub: string | null;
	overlay: boolean;
	onPick: (e: React.MouseEvent) => void;
	onClose: () => void;
}) {
	// Slide-in on mount (overlay only); reduced motion skips the transition.
	const [entered, setEntered] = useState(!overlay);
	useEffect(() => {
		if (entered) return;
		const id = requestAnimationFrame(() => setEntered(true));
		return () => cancelAnimationFrame(id);
	}, [entered]);

	return (
		<div
			id={PANEL_ID}
			ref={panelRef}
			className={clsx(
				'flex w-56 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
				overlay
					? 'fixed bottom-0 left-14 top-12 z-30 shadow-panel transition duration-150 motion-reduce:transition-none'
					: 'sticky top-12 h-[calc(100dvh-3rem)] self-start',
				overlay && (entered ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0'),
			)}
		>
			<nav aria-label={`${top.label} pages`} className="flex-1 overflow-y-auto px-2 py-3">
				<p className="truncate px-2.5 pb-2 pt-1 text-13 font-semibold text-slate-900 dark:text-slate-100">{top.label}</p>
				<ul className="space-y-px">
					{top.children.map((sub) => {
						const lit = sub.key === activeSub;
						return (
							<li key={sub.key}>
								<Link
									href={sub.href}
									data-nav-col="2"
									onClick={onPick}
									aria-current={lit ? 'page' : undefined}
									className={clsx('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-13', rowBase, controlFocus, lit ? rowLit : rowIdle)}
								>
									<span className="flex-1 truncate">{sub.label}</span>
									<Badge badge={sub.badge} />
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>
			<div className="border-t border-slate-200 p-2 dark:border-slate-700">
				<Button type="button" variant="outline" size="sm" full data-nav-col="2" onClick={onClose}>
					Close panel
				</Button>
			</div>
		</div>
	);
}
