// Feature index for the global search bar (TopNav → GlobalSearch).
//
// Pure: builds the list of pages the VIEWER may open from the same nav data
// TopNav and SideNav render (navConfig.ts), applying the same two rules —
// canAccessModule for the tab and isItemVisible for the entry — so search
// can never surface a page the nav itself would hide. '{me}' is replaced by
// the signed-in profile id exactly as SideNav does; entries that need it are
// dropped until the profile hydrates.
//
// Matching is a plain case-insensitive substring over label, section and a
// few aliases ("kpi" → KPIs, "people" → Directory). Ranking: prefix match on
// the label first, then substring on the label, then section-only hits.

import type { Profile } from '@/stores/auth';
import type { ModuleKey } from '@/lib/permissions/constants';
import { calendarItem, isItemVisible, profileMenuItems, sideNavMap, topNavItems } from './navConfig';

export interface FeatureHit {
	/** Resolved href (no '{me}' left). */
	href: string;
	label: string;
	/** Menu the page lives under, e.g. "Team"; "Profile" for the top-right tabs. Empty for the menu itself. */
	section: string;
	/** True when the entry carries the WIP flag or is a /soon placeholder (shown with a badge). */
	wip: boolean;
}

// Alternative words people type. Keyed by href so a rename in navConfig
// does not silently orphan an alias.
const ALIASES: Record<string, string[]> = {
	'/': ['home', 'self', 'overview'],
	'/?tab=work': ['my work', 'my day', 'queue'],
	'/team': ['people', 'directory', 'staff'],
	'/team/{me}': ['me', 'my profile'],
	'/team/{me}?tab=pap': ['performance'],
	'/team/{me}?tab=checkins': ['check-in', 'checkin'],
	'/dashboard/metrics': ['kpi', 'kpis', 'metrics'],
	'/the-work/planning': ['tasks', 'projects', 'goals', 'priorities'],
	'/the-work/calendar': ['calendar'],
	'/the-work/innovation-desk': ['my requests', 'innovation'],
	'/settings': ['theme', 'dark mode', 'light mode', 'connections'],
	'/clients': ['customers', 'accounts'],
	'/prospects': ['deals', 'prospects', 'sales'],
	'/prospects/contacts': ['people', 'brands', 'duplicates'],
	'/media/opps': ['opportunities', 'placements'],
	'/media/members': ['journalists', 'contacts', 'reporters'],
	'/media/lead-scraper': ['lead scraper', 'media scraper'],
	'/admin/users': ['people admin', 'accounts'],
	'/admin/roles': ['permissions'],
	'/admin/tags': ['departments', 'teams'],
	'/admin/bots': ['bots', 'hermes'],
	'/social/studio': ['content', 'studio', 'posts'],
	'/team/knowledge-base': ['wiki', 'kb', 'docs'],
	'/team/sessions': ['calls', 'meetings'],
	'/data/imports': ['csv', 'upload'],
};

/**
 * Every page the viewer may open, in nav order (menu, then its sidebar
 * entries, then the top-right Profile tabs and Calendar). Menus come first
 * so "Team" finds the directory before "Team · Templates".
 */
export function buildFeatureIndex(profile: Profile | null, modules: ModuleKey[] | null): FeatureHit[] {
	const out: FeatureHit[] = [];
	const seen = new Set<string>();
	const push = (hit: FeatureHit) => {
		if (seen.has(hit.href)) return;
		seen.add(hit.href);
		out.push(hit);
	};
	const pushItem = (item: { href: string; label: string; visibility?: string }, section: string) => {
		if (item.href.includes('{me}')) {
			if (!profile?.id) return;
			push({ href: item.href.replace('{me}', profile.id), label: item.label, section, wip: item.visibility === 'wip' });
			return;
		}
		push({ href: item.href, label: item.label, section, wip: item.visibility === 'wip' });
	};

	for (const tab of topNavItems) {
		if (!isItemVisible(tab, profile, modules)) continue;
		push({ href: tab.href, label: tab.label, section: '', wip: false });

		for (const item of sideNavMap[tab.key] ?? []) {
			// Cycle-gated entries (Profile -> Calibration, 0118) stay
			// searchable: the page itself explains when no cycle is open.
			if (!isItemVisible(item, profile, modules, { calibrationOpen: true })) continue;
			pushItem(item, tab.label);
		}
	}
	// Top-right: the Profile menu (My Profile, Requests, Settings) and Calendar.
	if (profile) {
		for (const item of profileMenuItems) {
			if (!isItemVisible(item, profile, modules, { calibrationOpen: true })) continue;
			pushItem(item, 'Profile');
		}
		pushItem(calendarItem, '');
	}
	return out;
}

/** Aliases for a RESOLVED href: '{me}' entries are looked up by their template. */
function aliasesFor(href: string, profileId: string | null | undefined): string[] {
	const direct = ALIASES[href];
	if (direct) return direct;
	if (profileId && href.includes(profileId)) {
		return ALIASES[href.replace(profileId, '{me}')] ?? [];
	}
	return [];
}

export function normalizeQuery(q: string): string {
	return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Rank the index against a query. Empty query → empty result (the dropdown
 * shows nothing until the person types). `limit` caps the returned hits.
 */
export function searchFeatures(
	index: FeatureHit[],
	query: string,
	profileId: string | null | undefined,
	limit = 6,
): FeatureHit[] {
	const q = normalizeQuery(query);
	if (!q) return [];
	const scored: { hit: FeatureHit; score: number }[] = [];
	for (const hit of index) {
		const label = hit.label.toLowerCase();
		const section = hit.section.toLowerCase();
		let score = 0;
		if (label.startsWith(q)) score = 4;
		else if (label.includes(q)) score = 3;
		else if (aliasesFor(hit.href, profileId).some((a) => a.startsWith(q) || a.includes(q))) score = 2;
		else if (section.includes(q)) score = 1;
		else if (`${section} ${label}`.includes(q)) score = 1;
		if (score > 0) scored.push({ hit, score });
	}
	// Stable: equal scores keep nav order.
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((s) => s.hit);
}
