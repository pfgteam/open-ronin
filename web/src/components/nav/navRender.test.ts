// Server-render smoke test for the nav shell built to the "Alex draft
// (original)" tab. renderToStaticMarkup runs no effects, so this exercises
// the pure render path of SideNav / PageTabs / TopNav / NewMenu with the auth
// store seeded per role — a runtime regression (bad key, undefined icon,
// hook misuse) fails here before anyone signs in. The server snapshot is the
// desktop layout (second column pushes the page).
// Shape vs the sheet: navSheet.test.ts; gates: navConfig.test.ts; tree +
// active row: navModel.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Profile } from '@/stores/auth';

let pathname = '/';
let search = '';
vi.mock('next/navigation', () => ({
	usePathname: () => pathname,
	useSearchParams: () => new URLSearchParams(search),
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({
	createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }), then: (cb: (r: unknown) => void) => cb({ data: [], error: null }) }) }) }) }),
}));
// zustand's hook serves the INITIAL state to server renders
// (useSyncExternalStore's getServerSnapshot), so setState() would not reach
// renderToStaticMarkup. A plain object stands in for the store instead.
const authState: { profile: Profile | null; modules: string[] | null; user: { email: string } | null; initialized: boolean; init: () => Promise<void>; logout: () => Promise<void> } = {
	profile: null,
	modules: null,
	user: null,
	initialized: true,
	init: async () => {},
	logout: async () => {},
};
vi.mock('@/stores/auth', () => ({
	useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

import SideNav from './SideNav';
import PageTabs from './PageTabs';
import TopNav from './TopNav';
import NewMenu from './NewMenu';

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

const contributorModules = ['dashboard', 'the_work', 'clients', 'prospects', 'flywheel', 'media', 'social', 'team'] as const;

function seed(p: Profile, modules: readonly string[] | null) {
	authState.profile = p;
	authState.modules = modules ? [...modules] : null;
	authState.user = { email: p.email };
}

function render(el: React.ElementType, props?: Record<string, unknown>): string {
	return renderToStaticMarkup(createElement(el, props));
}

/** The second column's markup ('' when closed). */
function panel(html: string): string {
	const at = html.indexOf('id="or-nav-panel"');
	return at === -1 ? '' : html.slice(at);
}

/** The first column's markup. */
function column1(html: string): string {
	const at = html.indexOf('id="or-nav-panel"');
	return at === -1 ? html : html.slice(0, at);
}

/** The link that carries aria-current="page" (href), or null. */
function currentHref(html: string): string | null {
	const m = html.match(/<a [^>]*aria-current="page"[^>]*href="([^"]+)"/);
	return m ? m[1].replaceAll('&amp;', '&') : null;
}

describe('nav shell renders per role', () => {
	beforeEach(() => {
		pathname = '/';
		search = '';
	});

	it('top bar: six menus, then Search, Calendar, Notifications, Profile (left to right); no theme button', () => {
		seed(profile({ role: 'admin' }), null);
		const top = render(TopNav);
		for (const label of ['Work', 'Clients', 'Growth', 'Studio', 'Team', 'Management']) expect(top).toContain(`>${label}<`);
		const order = ['aria-label="Search', 'aria-label="Calendar"', 'aria-label="Notifications', 'aria-label="Profile"'].map((s) => top.indexOf(s));
		expect(order.every((i) => i > -1), String(order)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(top).not.toContain('Toggle theme');
		// Menus open where the sheet says they land.
		expect(top).toContain('title="Clients" aria-label="Clients" href="/soon/clients-overview"');
		expect(top).toContain('title="Growth" aria-label="Growth" href="/prospects/dashboards"');
	});

	it('Work on Overview: + New, the bold major title, the inline Client Work heading, icon rows', () => {
		seed(profile({ role: 'admin' }), null);
		const side = render(SideNav);
		expect(side).toContain('>New<');
		expect(side).toMatch(/data-nav-heading="The Work"[^>]*font-bold|font-bold[^>]*>The Work</);
		expect(side).toContain('data-nav-heading="Client Work"');
		// Inline heading: the title link, then the line beside it.
		expect(side).toMatch(/data-nav-heading="Client Work"><a [^>]*>Client Work<\/a><span aria-hidden="true" class="h-px flex-1/);
		for (const label of ['Overview', 'My Work', 'Planning &amp; Priorities', 'Internal Work', 'Bot Work', 'Planning Calendars', 'Media Outlets', 'Media Members', 'PR', 'Social', 'Writing', 'Flywheel', 'Beacon']) expect(side).toContain(`>${label}<`);
		expect(panel(side)).toBe('');
		expect(currentHref(side)).toBe('/');
		// Primary rows are icon + label (Client Work is the heading, row 23: 13 rows).
		expect(side.match(/data-nav-col="1"[^>]*>\s*<svg/g)).toHaveLength(13);
		// The Client Work heading opens the Client Work table.
		expect(side).toMatch(/data-nav-heading="Client Work"><a [^>]*href="\/the-work\/client-work">Client Work<\/a>/);
	});

	it('a sub row page opens the second column: icons-only first column, headings shrink to their line', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/media/opps';
		const side = render(SideNav);
		const col1 = column1(side);
		const col2 = panel(side);
		expect(col2).not.toBe('');
		expect(col1).toContain('w-14');
		expect(col1).not.toContain('>PR<');
		expect(col1).toMatch(/aria-label="PR" aria-current="true" aria-expanded="true" aria-controls="or-nav-panel"/);
		expect(col1).not.toContain('>The Work<');
		expect(col1).toMatch(/data-nav-heading="Client Work" class="mx-1.5 my-2 h-px/);
		expect(col2).not.toContain('<svg');
		expect(col2).toContain('>PR<');
		for (const label of ['Deliverables', 'Media Opps', 'Reports']) expect(col2).toContain(`>${label}<`);
		expect(currentHref(col2)).toBe('/media/opps');
		expect(col2).toContain('>Close panel<');
		expect(col2).toMatch(/^id="or-nav-panel" class="[^"]*border-l/);
		// Sub rows are menu rows, never tabs.
		expect(render(PageTabs)).toBe('');
	});

	it('Social › Deliverables: the query picks the row', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/clients/deliverables';
		search = 'service=social';
		const col2 = panel(render(SideNav));
		expect(col2).toContain('>Social<');
		expect(currentHref(col2)).toBe('/clients/deliverables?service=social');
	});

	it('contributor: no Management menu, no Soon or WIP rows', () => {
		seed(profile({ role: 'contributor' }), contributorModules);
		const top = render(TopNav);
		expect(top).not.toContain('>Management<');
		expect(top).toContain('title="Clients" aria-label="Clients" href="/clients"');
		pathname = '/the-work/planning';
		const side = render(SideNav);
		expect(side).not.toContain('>Soon<');
		expect(side).not.toContain('>WIP<');
		expect(side).not.toContain('/soon/');
		expect(side).not.toContain('>Bot Work<');
		expect(currentHref(side)).toBe('/the-work/planning');
	});

	it('Studio: an adopted page shows its menu; the empty major title still shows', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/media/lead-scraper';
		const side = render(SideNav);
		expect(side).toContain('aria-label="Studio menu"');
		expect(side).toContain('data-nav-heading="Studio"');
		for (const h of ['Content', 'Tools', 'Pitching']) expect(side).toContain(`data-nav-heading="${h}"`);
		expect(currentHref(side)).toBe('/media/lead-scraper');
	});

	it('Management on an admin settings page lights Platform › Admin Overview', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/admin/prospects/stages';
		const side = render(SideNav);
		expect(side).toContain('aria-label="Management menu"');
		expect(panel(side)).toContain('>Platform<');
		expect(currentHref(panel(side))).toBe('/admin');
	});

	it('Management › Dashboards: the areas are tabs on the page, general first', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/dashboard/ops';
		const side = render(SideNav);
		expect(panel(side)).toBe('');
		expect(currentHref(side)).toBe('/dashboard');
		const tabs = render(PageTabs);
		expect(currentHref(tabs)).toBe('/dashboard/ops');
		expect(tabs.indexOf('>General<')).toBeLessThan(tabs.indexOf('>Delivery<'));
		expect(tabs).toContain('>Marketing<');
	});

	it('Internal Work = the hub: each tab lights the row; the hub draws its own strip', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/the-work/bugs';
		const side = render(SideNav);
		expect(side).toMatch(/aria-current="page"[^>]*>.*?>Internal Work</);
		expect(side).not.toContain('>Bugs<');
		expect(render(PageTabs)).toBe('');
	});

	it('the + New palette open: Create and Request groups', () => {
		seed(profile({ role: 'admin' }), null);
		const open = render(NewMenu, { initialOpen: true });
		expect(open).toContain('role="dialog"');
		expect(open).toContain('>Create<');
		expect(open).toContain('>Request<');
		const compact = render(NewMenu, { compact: true });
		expect(compact).toContain('<span class="sr-only">New</span>');
	});

	it('renders no sidebar and no tabs on a page no menu owns', () => {
		seed(profile({ role: 'admin' }), null);
		pathname = '/settings';
		expect(render(SideNav)).toBe('');
		expect(render(PageTabs)).toBe('');
	});
});
