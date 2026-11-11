import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Profile } from '@/stores/auth';
import {
	COMING_SOON,
	isItemVisible,
	isSoonHref,
	navSections,
	newMenuGroups,
	profileMenuItems,
	sectionForPath,
	sideNavMap,
	topNavItems,
} from './navConfig';
import { ADMIN_SECTIONS } from '@/lib/revenue/adminOptions';
import { itemIcons } from './navIcons';

// The menu SHAPE (names, levels, order) is pinned against Alex's sheet in
// navSheet.test.ts. This file pins the wiring: every href is a real page,
// gates, and which menu a URL belongs to.

// ---------------------------------------------------------------------------
// Route manifest: every page.tsx under src/app, expressed as a matcher.
// Route groups like (app) do not appear in the URL; [param] segments match
// one path segment. Built from the filesystem so a nav entry can never point
// at a 404 silently: delete a page and this test names the dead href.
// ---------------------------------------------------------------------------

const appDir = path.resolve(import.meta.dirname, '../../app');

function collectRoutes(dir: string, segments: string[] = []): RegExp[] {
	const out: RegExp[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			// Route groups "(name)" add no URL segment.
			const next = /^\(.*\)$/.test(entry) ? segments : [...segments, entry];
			out.push(...collectRoutes(full, next));
		} else if (entry === 'page.tsx' || entry === 'page.ts') {
			const pattern = segments
				.map((s) => (/^\[.*\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
				.join('/');
			out.push(new RegExp(`^/${pattern}$`));
		}
	}
	return out;
}

const routes = collectRoutes(appDir);

function hrefToPath(href: string): string {
	// '{me}' is replaced by the signed in profile id at render time.
	const withId = href.replace('{me}', '00000000-0000-4000-8000-000000000000');
	return withId.split('?')[0];
}

// A nav href is either a static page, carries a real id ('{me}'), or is a
// /soon/<slug> placeholder whose slug is in the registry. A static looking
// href that only matches through a [param] sibling (/team/org-chartt
// swallowed by /team/[id]) would render a "not found" record page, so
// dynamic matches count only for hrefs that contained '{me}' or a slug.
function routeExists(pathname: string, allowDynamic: boolean): boolean {
	return routes.some((re) => {
		if (!re.test(pathname)) return false;
		return allowDynamic || !re.source.includes('[^/]+');
	});
}

function hrefResolves(href: string): boolean {
	if (isSoonHref(href)) {
		const slug = href.slice('/soon/'.length);
		return slug in COMING_SOON && routeExists(href, true);
	}
	return routeExists(hrefToPath(href), href.includes('{me}'));
}

function profile(over: Partial<Profile>): Profile {
	return {
		id: '00000000-0000-4000-8000-000000000000',
		email: 'user-11f6ad@example.com',
		first_name: 'Test',
		last_name: 'User',
		title: null,
		department: null,
		photo_url: null,
		avatar_url: null,
		in_office: false,
		airtable_user_id: null,
		role: 'contributor',
		is_active: true,
		created_at: '',
		updated_at: '',
		...over,
	};
}

describe('nav hrefs', () => {
	it('builds a manifest from src/app', () => {
		expect(routes.length).toBeGreaterThan(50);
		expect(routeExists('/', false)).toBe(true);
		expect(routeExists('/settings', false)).toBe(true);
		expect(routeExists('/team/some-profile-id', true)).toBe(true);
		expect(routeExists('/team/some-profile-id', false)).toBe(false);
		expect(routeExists('/definitely/not/a/page', true)).toBe(false);
		expect(hrefResolves('/soon/call-tracker')).toBe(true);
		expect(hrefResolves('/soon/not-registered')).toBe(false);
	});

	it('every sidebar href and activeFor prefix resolves to a page in the app router', () => {
		const dead: string[] = [];
		for (const section of navSections) {
			if (!hrefResolves(section.href)) dead.push(`${section.href} (${section.label} landing)`);
			for (const item of sideNavMap[section.key]) {
				if (!hrefResolves(item.href)) dead.push(`${item.href} (${item.label}, under ${section.label})`);
				for (const p of item.activeFor ?? []) {
					// Legacy redirect prefixes (/projects, /priorities) are
					// handled by middleware, not pages; system boards
					// (/the-work/b/<slug>) are rows of public.boards behind the
					// [slug] route. Everything else must exist.
					if (p === '/projects' || p === '/priorities') continue;
					if (p.startsWith('/the-work/b/') && routeExists(p, true)) continue;
					if (!routeExists(p, false)) dead.push(`${p} (activeFor ${item.label}, under ${section.label})`);
				}
			}
		}
		expect(dead, `nav entries with no page.tsx:\n  ${dead.join('\n  ')}`).toEqual([]);
	});

	it('every profile-menu and "+ New" href resolves', () => {
		const dead: string[] = [];
		for (const item of profileMenuItems) if (!hrefResolves(item.href)) dead.push(item.href);
		for (const group of newMenuGroups) {
			for (const option of group.options) {
				if (option.href && !hrefResolves(option.href)) dead.push(`${option.href} (${group.title} › ${option.label})`);
				if (!option.href && !option.event) dead.push(`${group.title} › ${option.label} has neither href nor event`);
			}
		}
		expect(dead).toEqual([]);
	});

	it('every /soon placeholder in the registry is reachable from a menu or "+ New"', () => {
		const used = new Set<string>();
		for (const items of Object.values(sideNavMap)) for (const i of items) if (isSoonHref(i.href)) used.add(i.href.slice(6));
		for (const g of newMenuGroups) for (const o of g.options) if (o.href && isSoonHref(o.href)) used.add(o.href.slice(6));
		const orphans = Object.keys(COMING_SOON).filter((slug) => !used.has(slug));
		expect(orphans, 'registry rows nothing links to').toEqual([]);
	});

	it('placeholders are wip-gated (honest nav)', () => {
		for (const items of Object.values(sideNavMap)) {
			for (const i of items) if (isSoonHref(i.href)) expect(i.visibility, i.label).toBe('wip');
		}
	});
});

// sectionForPath decides BOTH the highlighted top menu and which sidebar
// list renders. These pin the rules.
describe('sectionForPath', () => {
	it('resolves the six menus by a listed page', () => {
		expect(sectionForPath('/')).toBe('work');
		expect(sectionForPath('/the-work/planning')).toBe('work');
		expect(sectionForPath('/clients/tickets')).toBe('clients');
		expect(sectionForPath('/prospects/referrals')).toBe('growth');
		expect(sectionForPath('/social/studio')).toBe('studio');
		expect(sectionForPath('/team/checkins')).toBe('team');
		expect(sectionForPath('/admin/users')).toBe('management');
	});

	it('gives a page to the menu the sheet lists it under, not the URL prefix owner', () => {
		// /media is Work's by default; Scrapers and the Pitching rows are Studio.
		expect(sectionForPath('/media/lead-scraper')).toBe('studio');
		expect(sectionForPath('/media/media-scraper')).toBe('studio');
		expect(sectionForPath('/media/lists')).toBe('studio');
		expect(sectionForPath('/media/outlets')).toBe('work');
		// Team › Knowledge › Sessions.
		expect(sectionForPath('/team/sessions')).toBe('team');
		// /clients is Clients'; the deliverables and the PR report are Work › Client Work.
		expect(sectionForPath('/clients/deliverables')).toBe('work');
		expect(sectionForPath('/clients/analytics')).toBe('work');
		expect(sectionForPath('/clients/social')).toBe('studio');
		// Proof Library is Clients; Workflows + Products are Studio › Tools.
		expect(sectionForPath('/prospects/proof')).toBe('clients');
		expect(sectionForPath('/prospects/workflows')).toBe('studio');
		expect(sectionForPath('/prospects/products')).toBe('studio');
		// Acquisitions is Growth.
		expect(sectionForPath('/the-work/acquisitions')).toBe('growth');
		// Time Studies is Management › Team Systems; KPIs too.
		expect(sectionForPath('/social/time-study')).toBe('management');
		expect(sectionForPath('/dashboard/metrics')).toBe('management');
		// Forms is Studio › Tools.
		expect(sectionForPath('/data/forms')).toBe('studio');
		// Planning Calendars covers the hiring calendar; Sales My Day is Growth › Prospects (row 55).
		expect(sectionForPath('/hiring/calendar')).toBe('work');
		expect(sectionForPath('/prospects/my-day')).toBe('growth');
		// The Client Work heading's own page (row 23).
		expect(sectionForPath('/the-work/client-work')).toBe('work');
	});

	it('keeps a deeper path under the listing menu too', () => {
		expect(sectionForPath('/team/sessions/abc-123')).toBe('team');
		expect(sectionForPath('/social/studio/clips')).toBe('studio');
		expect(sectionForPath('/data/forms/intake/submissions')).toBe('studio');
		expect(sectionForPath('/admin/prospects/stages')).toBe('management');
	});

	it('falls back to the owning prefix for unlisted record pages', () => {
		expect(sectionForPath('/clients/some-uuid/health')).toBe('clients');
		expect(sectionForPath('/team/some-uuid')).toBe('team');
		expect(sectionForPath('/the-work/some-uuid')).toBe('work');
		expect(sectionForPath('/the-work/b/ops')).toBe('work');
		expect(sectionForPath('/flywheel/some-uuid/pages/p1')).toBe('work');
		expect(sectionForPath('/hiring/positions/some-uuid/applications')).toBe('team');
		expect(sectionForPath('/prospects/deals/some-uuid')).toBe('growth');
		expect(sectionForPath('/data/some-base/some-table')).toBe('management');
		expect(sectionForPath('/calibration')).toBe('work');
	});

	it('returns an empty section for a path no menu owns', () => {
		expect(sectionForPath('/auth/login')).toBe('');
		expect(sectionForPath('/chat')).toBe('');
		expect(sectionForPath('/settings')).toBe('');
		expect(sectionForPath('/nope')).toBe('');
	});

	it('every listed href resolves to a menu that lists it', () => {
		for (const [key, items] of Object.entries(sideNavMap)) {
			for (const item of items) {
				if (item.href.includes('{me}')) continue;
				const pathname = item.href.split('?')[0];
				const resolved = sectionForPath(pathname);
				const listedUnder = Object.entries(sideNavMap)
					.filter(([, list]) => list.some((i) => i.href.split('?')[0] === pathname))
					.map(([k]) => k);
				expect(listedUnder, `${item.href} listed under ${key}`).toContain(resolved);
			}
		}
	});

	it('the only page two menus list is Social › Reports = the Social dashboard tab (the menu you came from keeps it)', () => {
		const owners = new Map<string, string[]>();
		for (const [section, links] of Object.entries(sideNavMap)) {
			for (const l of links) {
				const p = l.href.split('?')[0];
				owners.set(p, [...new Set([...(owners.get(p) ?? []), section])]);
			}
		}
		const shared = [...owners.entries()].filter(([, s]) => s.length > 1).map(([p, s]) => `${p} ${s.join('+')}`);
		expect(shared).toEqual(['/dashboard/social work+management']);
		expect(sectionForPath('/dashboard/social')).toBe('work');
		expect(sectionForPath('/dashboard/social', 'management')).toBe('management');
		expect(sectionForPath('/dashboard/ops', 'work')).toBe('management');
	});
});

describe('menus and gating', () => {
	const admin = profile({ role: 'admin' });
	const manager = profile({ role: 'manager' });
	const contributor = profile({ role: 'contributor' });
	const contributorModules = ['dashboard', 'the_work', 'clients', 'prospects', 'flywheel', 'media', 'social', 'team'] as const;

	it('has the six top menus in order, named as the sheet names them', () => {
		expect(topNavItems.map((t) => t.label)).toEqual(['Work', 'Clients', 'Growth', 'Studio', 'Team', 'Management']);
	});

	it('Management is managers and admins only; Planning & Priorities is for everyone', () => {
		const mgmt = topNavItems.find((t) => t.key === 'management')!;
		expect(isItemVisible(mgmt, admin, null)).toBe(true);
		expect(isItemVisible(mgmt, manager, [...contributorModules])).toBe(true);
		expect(isItemVisible(mgmt, contributor, [...contributorModules])).toBe(false);
		const planning = sideNavMap.work.find((i) => i.label === 'Planning & Priorities')!;
		expect(isItemVisible(planning, contributor, [])).toBe(true);
	});

	it('items carry their module gate so a contributor never sees Admin or Data pages', () => {
		for (const items of Object.values(sideNavMap)) {
			for (const i of items) {
				const visible = isItemVisible(i, contributor, [...contributorModules]);
				const p = i.href.split('?')[0];
				if (p === '/admin' || p.startsWith('/admin/') || p === '/data' || p.startsWith('/data/')) {
					expect(visible, `${i.label} ${i.href}`).toBe(false);
				}
			}
		}
	});

	it('Labs / wip entries stay hidden from a contributor and visible to admins', () => {
		for (const items of Object.values(sideNavMap)) {
			for (const i of items.filter((x) => x.visibility === 'wip')) {
				expect(isItemVisible(i, contributor, [...contributorModules]), i.label).toBe(false);
				expect(isItemVisible(i, admin, null), i.label).toBe(true);
			}
		}
	});

	it('Acquisitions: only direct permission holders (row 60), not even admins by role', () => {
		const acq = sideNavMap.growth.find((i) => i.label === 'Acquisitions')!;
		expect(acq.capability).toBe('acquisitions');
		expect(isItemVisible(acq, admin, null)).toBe(false);
		expect(isItemVisible(acq, admin, null, { capabilities: ['run_scrapers'] })).toBe(false);
		expect(isItemVisible(acq, contributor, [...contributorModules], { capabilities: ['acquisitions'] })).toBe(true);
	});

	it('the "+ New" menu has the Create and Request groups from the sheet', () => {
		expect(newMenuGroups.map((g) => g.title)).toEqual(['Create', 'Request']);
		expect(newMenuGroups[0].options[0].event).toBe('or-quick-add');
	});
});

describe('two levels max', () => {
	it('every primary row has an icon; parents have sub rows, tabbed pages 2+ tabs', () => {
		for (const section of navSections) {
			for (const g of section.groups) {
				for (const top of g.items) {
					expect(itemIcons[top.icon], `${section.label} › ${top.label} icon`).toBeTruthy();
					if (top.children) expect(top.children.length, `${top.label} children`).toBeGreaterThan(0);
					if (top.tabs) expect(top.tabs.length, `${top.label} tabs`).toBeGreaterThan(1);
					for (const sub of top.children ?? []) {
						// The type forbids a third level; this pins it at runtime too.
						expect((sub as { children?: unknown }).children, `${top.label} › ${sub.label}`).toBeUndefined();
						expect((sub as { tabs?: unknown }).tabs, `${top.label} › ${sub.label}`).toBeUndefined();
					}
				}
			}
		}
	});

	it('every destination is unique within its menu (href incl. query)', () => {
		for (const [section, links] of Object.entries(sideNavMap)) {
			const hrefs = links.map((l) => l.href);
			const dupes = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
			expect(dupes, section).toEqual([]);
		}
	});

	it('menuLinks carries the trail, the heading and inherits the row gate', () => {
		const pr = sideNavMap.work.filter((l) => l.trail[0] === 'PR').map((l) => `${l.group}: ${l.trail.join(' › ')}`);
		expect(pr).toEqual(['Client Work: PR › Deliverables', 'Client Work: PR › Media Opps', 'Client Work: PR › Reports']);
		const hiring = sideNavMap.team.filter((l) => l.trail[0] === 'Hiring');
		expect(hiring.every((l) => l.module === 'hiring' && l.level === 2)).toBe(true);
		const dash = sideNavMap.management.filter((l) => l.trail[0] === 'Dashboards');
		expect(dash.map((l) => l.trail[1])).toEqual(['General', 'Delivery', 'Social', 'Dev', 'Ops', 'Sales', 'Lead Gen', 'Marketing']);
		expect(dash.every((l) => l.level === 3 && l.row === 106)).toBe(true);
	});
});

describe('Management → Prospects settings sections', () => {
	// Platform › Admin Overview (/admin) is "the panel for settings/tools in
	// every area not on the menus": every /admin page no row lists lights it.
	it('every section is a real page that keeps the Management menu', () => {
		expect(routes.some((r) => r.test('/admin/settings')), '/admin/settings has no page.tsx').toBe(true);
		for (const s of ADMIN_SECTIONS) {
			const href = `/admin/prospects/${s.key}`;
			expect(routes.some((r) => r.test(href)), `${href} has no page.tsx`).toBe(true);
			expect(sectionForPath(href)).toBe('management');
		}
	});
});
