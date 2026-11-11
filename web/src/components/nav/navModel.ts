// Nav model for the "Alex draft (original)" menus (navConfig.ts).
//
// Pure, no React: turns one menu's config (section headings → primary rows →
// sub rows) into what the viewer may see, and works out which row is active
// for a URL. SideNav, TopNav and PageTabs render it; navModel.test.ts pins it.
//
//   visibleNav()    — gate every link, drop empty primaries, resolve each
//                     primary / tabbed page / heading to its landing (the
//                     first visible destination under it), drop a heading
//                     with nothing under it
//                     (a major title stays: it opens the menu's first page).
//   resolveActive() — ONE active destination for the whole menu: the link
//                     whose href (or activeFor) matches the URL with the
//                     longest path, then the most matching ?query keys. A
//                     link whose query asks for something the URL lacks never
//                     matches (Social's ?service=social Deliverables vs PR's
//                     plain Deliverables). Ties go to the first in menu order.

import {
	isItemVisible,
	isSoonHref,
	type NavFlags,
	type NavGroup,
	type NavIconName,
	type NavSub,
	type NavTab,
	type NavTop,
} from './navConfig';
import type { Profile } from '@/stores/auth';
import type { ModuleKey } from '@/lib/permissions/constants';

export type NavBadge = 'soon' | 'wip' | null;

/** A sub menu row the viewer can see. `href` = its page. */
export interface VisibleSub {
	key: string;
	label: string;
	href: string;
	activeFor?: string[];
	exact?: boolean;
	/** Tabs on the page (primary rows only; [] for a plain page). */
	tabs: NavTab[];
	/** The page draws its tab strip itself (navConfig ownTabs): PageTabs stays out. */
	ownTabs?: boolean;
	/** "Soon" when everything in the row is a placeholder, "WIP" when everything is wip-gated. */
	badge: NavBadge;
}

/** A primary row the viewer can see. `href` = its page, landing tab or landing sub row. */
export interface VisibleTop extends VisibleSub {
	icon: NavIconName;
	children: VisibleSub[];
}

/** A section heading with the primary rows the viewer can see under it. */
export interface VisibleGroup {
	key: string;
	title: string;
	/** The bold title at the top of the menu; the others draw inline on a line. */
	major: boolean;
	/** Where clicking the heading goes: its own page (navConfig `link`), else its first page (or the menu's next page for an empty major title). */
	href: string;
	/** The heading opens a page of its own (navConfig `link`): it lights on that page. */
	ownPage?: boolean;
	activeFor?: string[];
	items: VisibleTop[];
}

export interface ViewerContext {
	profile: Profile | null;
	modules: ModuleKey[] | null;
	flags?: NavFlags;
}

function fillMe(href: string, profile: Profile | null): string | null {
	if (!href.includes('{me}')) return href;
	return profile?.id ? href.replaceAll('{me}', profile.id) : null;
}

function gateLinks(links: NavTab[], ctx: ViewerContext): NavTab[] {
	const out: NavTab[] = [];
	for (const l of links) {
		if (!isItemVisible(l, ctx.profile, ctx.modules, ctx.flags)) continue;
		const href = fillMe(l.href, ctx.profile);
		if (href) out.push({ ...l, href });
	}
	return out;
}

/**
 * Where a parent, a tabbed page or a heading opens: its first visible row,
 * placeholder or not ("Clients lands here" on Overview means Overview, even
 * before that page is built).
 */
function landing<T extends { href: string }>(rows: T[]): T {
	return rows[0];
}

function badgeOf(rows: { href: string; visibility?: string; badge?: NavBadge }[], own?: string): NavBadge {
	if (rows.every((r) => r.badge === 'soon' || isSoonHref(r.href))) return 'soon';
	if (own === 'wip' || rows.every((r) => r.badge === 'wip' || r.badge === 'soon' || r.visibility === 'wip')) return 'wip';
	return null;
}

function visibleSub(node: NavSub, ctx: ViewerContext): VisibleSub | null {
	if (!isItemVisible(node, ctx.profile, ctx.modules, ctx.flags)) return null;
	const href = fillMe(node.href, ctx.profile);
	if (!href) return null;
	return {
		key: `r${node.row}`,
		label: node.label,
		href,
		tabs: [],
		badge: badgeOf([{ href, visibility: node.visibility }]),
		...(node.activeFor ? { activeFor: node.activeFor } : {}),
		...(node.exact ? { exact: true } : {}),
	};
}

function visibleTop(top: NavTop, ctx: ViewerContext): VisibleTop | null {
	if (!isItemVisible(top, ctx.profile, ctx.modules, ctx.flags)) return null;
	const key = `r${top.row}`;
	if (top.children) {
		const children = top.children.map((s) => visibleSub(s, ctx)).filter((s): s is VisibleSub => !!s);
		if (!children.length) return null;
		return { key, label: top.label, icon: top.icon, href: landing(children).href, tabs: [], badge: badgeOf(children, top.visibility), children };
	}
	if (top.tabs) {
		const tabs = gateLinks(top.tabs, ctx);
		if (!tabs.length) return null;
		return {
			key,
			label: top.label,
			icon: top.icon,
			href: landing(tabs).href,
			tabs,
			badge: badgeOf(tabs, top.visibility),
			children: [],
			...(top.ownTabs ? { ownTabs: true } : {}),
		};
	}
	const sub = visibleSub(top, ctx);
	return sub ? { ...sub, icon: top.icon, children: [] } : null;
}

/** What the viewer sees of one menu: headings with their primary rows. */
export function visibleNav(groups: NavGroup[], ctx: ViewerContext): VisibleGroup[] {
	const draft = groups.map((g) => ({ g, items: g.items.map((t) => visibleTop(t, ctx)).filter((t): t is VisibleTop => !!t) }));
	const out: VisibleGroup[] = [];
	draft.forEach(({ g, items }, i) => {
		// A heading opens its first page; an empty major title (Studio) opens
		// the first page of the headings after it.
		// A heading with a page of its own (Client Work) opens that page.
		const own = g.link && isItemVisible(g.link, ctx.profile, ctx.modules, ctx.flags) ? g.link : null;
		const pool = items.length ? items : g.major ? draft.slice(i + 1).flatMap((d) => d.items) : [];
		if (!own && !pool.length) return;
		out.push({
			key: `g${g.row}`,
			title: g.title,
			major: !!g.major,
			href: own ? own.href : landing(pool).href,
			...(own ? { ownPage: true, ...(own.activeFor ? { activeFor: own.activeFor } : {}) } : {}),
			items,
		});
	});
	return out;
}

/** The menu's landing for this viewer (TopNav): the major title's page. */
export function menuLanding(nav: VisibleGroup[]): string | null {
	return nav[0]?.href ?? null;
}

/** Every visible primary row of a menu, in order. */
export function allTops(nav: VisibleGroup[]): VisibleTop[] {
	return nav.flatMap((g) => g.items);
}

// ---------------------------------------------------------------------------
// Active row
// ---------------------------------------------------------------------------

/** [path length, matching query keys, exact path] — compared left to right. */
type Score = [number, number, number];

function better(a: Score, b: Score | null): boolean {
	if (!b) return true;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return a[i] > b[i];
	}
	return false;
}

/** How well one href / activeFor pattern matches the URL; null = no match. */
export function matchScore(pattern: string, pathname: string, params: URLSearchParams, exact = false): Score | null {
	const [path, query] = pattern.split('?');
	const onPath = path === '/' || exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
	if (!onPath) return null;
	let keys = 0;
	for (const [k, v] of new URLSearchParams(query ?? '')) {
		if (params.get(k) !== v) return null;
		keys++;
	}
	return [path.length, keys, pathname === path ? 1 : 0];
}

function linkScore(link: { href: string; activeFor?: string[]; exact?: boolean }, pathname: string, params: URLSearchParams): Score | null {
	let best: Score | null = null;
	const own = matchScore(link.href, pathname, params, !!link.exact);
	if (own) best = own;
	for (const p of link.activeFor ?? []) {
		const s = matchScore(p, pathname, params);
		if (s && better(s, best)) best = s;
	}
	return best;
}

export interface ActiveTrail {
	/** Key of the active primary row (or of the heading, `g<row>`, when the page is a heading's own page). */
	top: string;
	/** Key of the active sub row, when the page sits in the second column. */
	sub: string | null;
	/** href of the active tab, when the page is a tab. */
	tab: string | null;
}

/** The one active destination of a visible menu, or null. */
export function resolveActive(nav: VisibleGroup[], pathname: string, search: URLSearchParams | string = ''): ActiveTrail | null {
	const params = typeof search === 'string' ? new URLSearchParams(search) : search;
	let bestScore: Score | null = null;
	let bestTrail: ActiveTrail | null = null;
	const consider = (link: { href: string; activeFor?: string[]; exact?: boolean }, trail: ActiveTrail) => {
		const s = linkScore(link, pathname, params);
		if (s && better(s, bestScore)) {
			bestScore = s;
			bestTrail = trail;
		}
	};
	for (const g of nav) if (g.ownPage) consider(g, { top: g.key, sub: null, tab: null });
	for (const top of allTops(nav)) {
		if (top.children.length) for (const sub of top.children) consider(sub, { top: top.key, sub: sub.key, tab: null });
		else if (top.tabs.length) for (const t of top.tabs) consider(t, { top: top.key, sub: null, tab: t.href });
		else consider(top, { top: top.key, sub: null, tab: null });
	}
	return bestTrail;
}

/** The tab strip for an active trail, or null when the page is not a tab (or draws its own strip). */
export function activeTabs(nav: VisibleGroup[], trail: ActiveTrail | null): { label: string; tabs: NavTab[]; active: string } | null {
	if (!trail?.tab) return null;
	const row = allTops(nav).find((t) => t.key === trail.top);
	if (!row || !row.tabs.length || row.ownTabs) return null;
	return { label: row.label, tabs: row.tabs, active: trail.tab };
}
