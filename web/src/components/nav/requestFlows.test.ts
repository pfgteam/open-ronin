import { describe, expect, it } from 'vitest';
import { withParams } from './newMenuEvents';
import { ASK_FOR_TILES, DEPARTMENT_TABS, MODULE_SETTINGS, navSections, newMenuOption, sectionForPath, settingsForTool } from './navConfig';
import { activeTabs, resolveActive, visibleNav } from './navModel';

const signedOut = visibleNav(navSections.find((s) => s.key === 'management')!.groups, { profile: null, modules: null });
// Visibility needs a profile; an admin-shaped stand-in sees every Management row.
const admin = { id: 'a', role: 'admin', department: null } as unknown as Parameters<typeof visibleNav>[1]['profile'];
const mgmtAdmin = visibleNav(navSections.find((s) => s.key === 'management')!.groups, { profile: admin, modules: null });
function departmentTabFor(pathname: string): string | null {
	return activeTabs(mgmtAdmin, resolveActive(mgmtAdmin, pathname))?.active ?? null;
}

describe('withParams (+ New context on option hrefs)', () => {
	it('appends params and keeps an existing query', () => {
		expect(withParams('/the-work/content-requests', { client: 'abc' })).toBe('/the-work/content-requests?client=abc');
		expect(withParams('/hiring/requests?new=1', { client: 'abc' })).toBe('/hiring/requests?new=1&client=abc');
	});
	it('leaves the href alone without params', () => {
		expect(withParams('/x', undefined)).toBe('/x');
		expect(withParams('/x', { a: '' })).toBe('/x');
	});
});

describe('Ask for… tiles', () => {
	it('every tile names a real + New option', () => {
		for (const t of ASK_FOR_TILES) {
			expect(newMenuOption(t.option), t.option).toBeDefined();
			if (t.also) expect(newMenuOption(t.also), t.also).toBeDefined();
		}
	});
});

describe('Dashboards tabs (sheet row 106: general first, then the areas)', () => {
	it('picks the tab for a dashboard page and nothing elsewhere', () => {
		expect(signedOut, 'signed out sees no Management rows').toEqual([]);
		expect(departmentTabFor('/dashboard/sales')).toBe('/dashboard/sales');
		expect(departmentTabFor('/dashboard/ops')).toBe('/dashboard/ops');
		expect(departmentTabFor('/dashboard')).toBe('/dashboard');
		expect(departmentTabFor('/dashboard/metrics')).toBeNull();
	});
	it('every department page stays in a menu', () => {
		for (const t of DEPARTMENT_TABS) expect(sectionForPath(t.href), t.href).not.toBe('');
	});
});

describe('Module Settings gear', () => {
	it('maps each tool to its settings page, and the settings pages stay in Management', () => {
		for (const m of MODULE_SETTINGS) {
			expect(settingsForTool(m.tool)?.href).toBe(m.href);
			expect(sectionForPath(m.href), m.href).toBe('management');
		}
		expect(settingsForTool('/nowhere')).toBeNull();
	});
});
