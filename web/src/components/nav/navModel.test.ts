import { describe, expect, it } from 'vitest';
import type { Profile } from '@/stores/auth';
import { navSections, type NavGroup } from './navConfig';
import { activeTabs, allTops, matchScore, menuLanding, resolveActive, visibleNav } from './navModel';

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

const admin = { profile: profile({ role: 'admin' }), modules: null };
const contributor = { profile: profile({ role: 'contributor' }), modules: ['dashboard', 'the_work', 'clients', 'prospects', 'flywheel', 'media', 'social', 'team'] as never };
const menu = (key: string) => navSections.find((s) => s.key === key)!.groups;
const labelOf = (nav: ReturnType<typeof visibleNav>, key: string | null | undefined) => allTops(nav).find((t) => t.key === key)?.label;

describe('matchScore', () => {
	const p = (q = '') => new URLSearchParams(q);
	it('"/" is exact only; other paths match themselves and beneath', () => {
		expect(matchScore('/', '/', p())).not.toBeNull();
		expect(matchScore('/', '/clients', p())).toBeNull();
		expect(matchScore('/clients', '/clients/abc', p())).toEqual([8, 0, 0]);
		expect(matchScore('/clients', '/clientsx', p())).toBeNull();
		expect(matchScore('/the-work', '/the-work/abc', p(), true)).toBeNull();
	});
	it('a query in the pattern must be in the URL, and counts', () => {
		expect(matchScore('/?tab=work', '/', p())).toBeNull();
		expect(matchScore('/?tab=work', '/', p('tab=work'))).toEqual([1, 1, 1]);
		expect(matchScore('/clients/deliverables?service=social', '/clients/deliverables', p('service=social'))).toEqual([21, 1, 1]);
	});
});

describe('visibleNav', () => {
	it('keeps the sheet headings: bold major title first, the rest inline', () => {
		const work = visibleNav(menu('work'), admin);
		expect(work.map((g) => [g.title, g.major])).toEqual([['The Work', true], ['Client Work', false]]);
		// "Goes to Overview".
		expect(work[0].href).toBe('/');
		expect(work[1].href).toBe('/the-work/client-work');
		expect(work[0].items.map((t) => t.label)).toEqual(['Overview', 'My Work', 'Planning & Priorities', 'Internal Work', 'Bot Work', 'Planning Calendars']);
	});

	it('drops rows the viewer cannot see; wip placeholders are admin-only', () => {
		const work = visibleNav(menu('work'), contributor);
		expect(work[0].items.map((t) => t.label)).toEqual(['Overview', 'My Work', 'Planning & Priorities', 'Internal Work', 'Planning Calendars']);
		// Writing has only a placeholder sub row: gone for a contributor.
		// Client Work is the heading itself (row 23, Alex 11/10), not a row.
		expect(work[1].items.map((t) => t.label)).toEqual(['Media Outlets', 'Media Members', 'PR', 'Social', 'Flywheel', 'Beacon']);
		expect(work[1].href).toBe('/the-work/client-work');
		const beacon = work[1].items.find((t) => t.label === 'Beacon')!;
		expect(beacon.children.map((c) => c.label)).toEqual(['Deliverables']);
	});

	it('a primary with sub rows opens its first one; a heading opens its first row', () => {
		const studio = visibleNav(menu('studio'), admin);
		// Studio's major title has no rows of its own: it opens the menu's first page.
		expect(studio.map((g) => g.title)).toEqual(['Studio', 'Content', 'Tools', 'Pitching']);
		expect(studio[0].items).toEqual([]);
		expect(studio[0].href).toBe('/soon/post-ideas');
		expect(visibleNav(menu('studio'), contributor)[0].href).toBe('/social/studio');
		// Pitching is Labs: contributors lose the heading with its rows.
		expect(visibleNav(menu('studio'), contributor).map((g) => g.title)).toEqual(['Studio', 'Content', 'Tools']);
		const pr = allTops(visibleNav(menu('work'), admin)).find((t) => t.label === 'PR')!;
		expect(pr.href).toBe('/clients/deliverables');
	});

	it('menu landings follow the sheet notes ("lands here")', () => {
		const land = (key: string, ctx = admin) => menuLanding(visibleNav(menu(key), ctx));
		expect(land('work')).toBe('/');
		expect(land('clients')).toBe('/soon/clients-overview');
		expect(land('clients', contributor)).toBe('/clients');
		expect(land('growth')).toBe('/prospects/dashboards');
		expect(land('team')).toBe('/team');
		expect(land('management')).toBe('/dashboard');
	});

	it('drops a heading whose rows are all hidden', () => {
		const groups: NavGroup[] = [
			{ title: 'Main', row: 1, major: true, items: [{ row: 2, label: 'Shown', icon: 'overview', href: '/b' }] },
			{ title: 'Hidden', row: 3, items: [{ row: 4, label: 'Gone', icon: 'overview', href: '/c', visibility: 'admin' }] },
		];
		expect(visibleNav(groups, contributor).map((g) => g.title)).toEqual(['Main']);
	});

	it('a heading with a page of its own opens it, gated by its module (row 23 Client Work)', () => {
		const groups: NavGroup[] = [
			{ title: 'Main', row: 1, major: true, items: [{ row: 2, label: 'Shown', icon: 'overview', href: '/b' }] },
			{ title: 'Own', row: 3, link: { href: '/own', module: 'admin' }, items: [{ row: 4, label: 'Row', icon: 'overview', href: '/c' }] },
		];
		expect(visibleNav(groups, admin)[1]).toMatchObject({ title: 'Own', href: '/own', ownPage: true });
		// No module: the heading falls back to its first row.
		expect(visibleNav(groups, contributor)[1]).toMatchObject({ title: 'Own', href: '/c' });
		expect(visibleNav(groups, contributor)[1].ownPage).toBeUndefined();
	});
});

describe('resolveActive', () => {
	const work = visibleNav(menu('work'), admin);
	const mgmt = visibleNav(menu('management'), admin);
	const growth = visibleNav(menu('growth'), admin);

	it('Overview on "/", My Work on "/?tab=work"; Sales My Day is Growth › Prospects (row 55)', () => {
		expect(labelOf(work, resolveActive(work, '/', '')?.top)).toBe('Overview');
		expect(labelOf(work, resolveActive(work, '/', 'tab=work')?.top)).toBe('My Work');
		expect(resolveActive(work, '/prospects/my-day', '')).toBeNull();
		expect(labelOf(growth, resolveActive(growth, '/prospects/my-day', '')?.top)).toBe('Prospects');
	});

	it('the Client Work heading lights on its own page (row 23)', () => {
		const g = work.find((x) => x.title === 'Client Work')!;
		expect(resolveActive(work, '/the-work/client-work', '')?.top).toBe(g.key);
		expect(resolveActive(work, '/the-work/client-work/strategy', '')?.top).toBe(g.key);
		expect(resolveActive(work, '/the-work/b/client-work', '')?.top).toBe(g.key);
		expect(labelOf(work, resolveActive(work, '/media/outlets', '')?.top)).toBe('Media Outlets');
	});

	it('each hub tab lights Internal Work; the hub draws its own strip', () => {
		const pri = resolveActive(work, '/the-work/priorities', '');
		expect(labelOf(work, pri?.top)).toBe('Internal Work');
		expect(pri?.tab).toBe('/the-work/priorities');
		expect(resolveActive(work, '/the-work/b/goals-priorities', '')?.tab).toBe('/the-work/priorities');
		expect(activeTabs(work, pri)).toBeNull();
		expect(labelOf(work, resolveActive(work, '/the-work/planning', '')?.top)).toBe('Planning & Priorities');
		expect(resolveActive(work, '/the-work/some-uuid', '')).toBeNull();
	});

	it('the deliverables views: the query picks the primary; the bare page is PR', () => {
		expect(labelOf(work, resolveActive(work, '/clients/deliverables', '')?.top)).toBe('PR');
		expect(labelOf(work, resolveActive(work, '/clients/deliverables', 'service=flywheel')?.top)).toBe('Flywheel');
		expect(labelOf(work, resolveActive(work, '/clients/deliverables', 'service=nope')?.top)).toBe('PR');
	});

	it('the longest path wins (Pipeline vs People & Brands)', () => {
		expect(labelOf(growth, resolveActive(growth, '/prospects/contacts', '')?.top)).toBe('People & Brands');
		expect(labelOf(growth, resolveActive(growth, '/prospects/deals/abc', '')?.top)).toBe('Pipeline');
		expect(labelOf(growth, resolveActive(growth, '/prospects', '')?.top)).toBe('Pipeline');
	});

	it('Dashboards: general first, the areas as tabs on the page', () => {
		const ops = activeTabs(mgmt, resolveActive(mgmt, '/dashboard/ops', ''));
		expect(ops?.label).toBe('Dashboards');
		expect(ops?.active).toBe('/dashboard/ops');
		expect(ops?.tabs.map((t) => t.label)).toEqual(['General', 'Delivery', 'Social', 'Dev', 'Ops', 'Sales', 'Lead Gen', 'Marketing']);
		expect(activeTabs(mgmt, resolveActive(mgmt, '/dashboard', ''))?.active).toBe('/dashboard');
		// KPIs is a Team Systems sub row, not a tab.
		const kpi = resolveActive(mgmt, '/dashboard/metrics', '');
		expect(labelOf(mgmt, kpi?.top)).toBe('Team Systems');
		expect(activeTabs(mgmt, kpi)).toBeNull();
	});

	it('Team Systems has one Departments row (row 117; row 111 deleted by Alex 11/10)', () => {
		const ts = allTops(mgmt).find((t) => t.label === 'Team Systems')!;
		expect(ts.children.filter((c) => c.label === 'Departments').map((c) => c.key)).toEqual(['r117']);
		expect(resolveActive(mgmt, '/admin/tags', '')?.sub).toBe('r117');
	});

	it('unlisted admin pages light Platform › Admin Overview', () => {
		const t = resolveActive(mgmt, '/admin/design-system', '');
		expect(labelOf(mgmt, t?.top)).toBe('Platform');
		expect(t?.sub).toBe('r124');
	});
});
