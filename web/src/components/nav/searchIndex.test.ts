import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Profile } from '@/stores/auth';
import { sideNavMap, topNavItems } from './navConfig';
import { buildFeatureIndex, searchFeatures } from './searchIndex';
import { sanitizeQuery } from './searchShared';

// Same route manifest navConfig.test.ts builds: every page.tsx under src/app
// as a matcher, so an indexed href can never point at a 404.
const appDir = path.resolve(import.meta.dirname, '../../app');

function collectRoutes(dir: string, segments: string[] = []): RegExp[] {
	const out: RegExp[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
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
const ME = '00000000-0000-4000-8000-000000000000';

function routeExists(pathname: string, allowDynamic: boolean): boolean {
	return routes.some((re) => re.test(pathname) && (allowDynamic || !re.source.includes('[^/]+')));
}

function profile(over: Partial<Profile>): Profile {
	return {
		id: ME,
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

const admin = profile({ role: 'admin' });
const contributor = profile({ role: 'contributor' });
const contributorModules = ['dashboard', 'the_work', 'clients', 'media', 'social', 'team'] as const;

describe('buildFeatureIndex', () => {
	it('indexes every tab and every sidebar entry for an admin', () => {
		const index = buildFeatureIndex(admin, null);
		const hrefs = new Set(index.map((h) => h.href));
		for (const tab of topNavItems) expect(hrefs.has(tab.href), tab.href).toBe(true);
		for (const items of Object.values(sideNavMap)) {
			for (const item of items) {
				// Capability rows (Acquisitions) are need-to-know: never indexed.
				if (item.capability) continue;
				expect(hrefs.has(item.href.replace('{me}', ME)), item.href).toBe(true);
			}
		}
	});

	it('every indexed href resolves to a real route', () => {
		const dead: string[] = [];
		for (const hit of buildFeatureIndex(admin, null)) {
			const pathname = hit.href.split('?')[0];
			// /soon/<slug> placeholders are a dynamic route by design (navConfig.COMING_SOON).
			if (!routeExists(pathname, hit.href.includes(ME) || hit.href.startsWith('/soon/'))) dead.push(`${hit.href} (${hit.label})`);
		}
		expect(dead, `indexed pages with no page.tsx:\n  ${dead.join('\n  ')}`).toEqual([]);
	});

	it('resolves {me} to the viewer and drops those entries before hydration', () => {
		const withProfile = buildFeatureIndex(admin, null);
		expect(withProfile.some((h) => h.href === `/team/${ME}`)).toBe(true);
		expect(withProfile.some((h) => h.href.includes('{me}'))).toBe(false);
		// Signed out / not hydrated: only the ungated Self tab and its static
		// shortcuts survive — same as the header renders.
		const anonymous = buildFeatureIndex(null, null);
		expect(anonymous.some((h) => h.href.includes('{me}') || h.href.includes('/team/'))).toBe(false);
		expect(anonymous.some((h) => h.href === '/admin' || h.href === '/clients')).toBe(false);
	});

	it('hides gated tabs and entries from a regular contributor', () => {
		const index = buildFeatureIndex(contributor, [...contributorModules]);
		const hrefs = index.map((h) => h.href);
		// Data + Admin modules are not in the contributor's matrix.
		expect(hrefs.some((h) => h === '/admin' || h.startsWith('/admin/'))).toBe(false);
		expect(hrefs.some((h) => h === '/data' || h.startsWith('/data/'))).toBe(false);
		// wip / admin / manager flags.
		expect(hrefs).not.toContain('/the-work/acquisitions');
		expect(hrefs).not.toContain('/team/pap');
		expect(hrefs).not.toContain('/media/autopitch');
		// Open pages stay.
		expect(hrefs).toContain('/team');
		expect(hrefs).toContain('/media/opps');
		expect(hrefs).toContain('/clients');
	});

	it('labels entries with their tab as the section', () => {
		const index = buildFeatureIndex(admin, null);
		const calibration = index.find((h) => h.href === '/team/calibration');
		expect(calibration?.section).toBe('Team');
		expect(index.find((h) => h.href === '/team')?.section).toBe('');
	});
});

describe('searchFeatures', () => {
	const index = buildFeatureIndex(admin, null);

	it('returns nothing for an empty query', () => {
		expect(searchFeatures(index, '', ME)).toEqual([]);
		expect(searchFeatures(index, '   ', ME)).toEqual([]);
	});

	it('ranks a label prefix above a substring and a section-only hit', () => {
		const hits = searchFeatures(index, 'cal', ME, 10);
		// Prefix matches (Call Tracker, Calibration, Calendar) outrank the
		// substring hit (Planning Calendars); equal scores keep nav order.
		expect(hits.slice(0, 3).map((h) => h.label)).toEqual(['Call Tracker', 'Calibration', 'Calibration Cycles']);
		expect(hits.map((h) => h.label)).toContain('Planning Calendars');
		expect(hits.findIndex((h) => h.label === 'Planning Calendars')).toBeGreaterThan(2);
		// /the-work/calendar is listed under Work ("Planning Calendars") and
		// top-right ("Calendar"); the index dedupes by href so it shows once.
		expect(hits.filter((h) => h.href === '/the-work/calendar')).toHaveLength(1);
	});

	it('finds pages by alias', () => {
		expect(searchFeatures(index, 'kpi', ME).map((h) => h.href)).toContain('/dashboard/metrics');
		expect(searchFeatures(index, 'wiki', ME).map((h) => h.href)).toContain('/team/knowledge-base');
		expect(searchFeatures(index, 'my profile', ME).map((h) => h.href)).toContain(`/team/${ME}`);
	});

	it('caps the result count', () => {
		expect(searchFeatures(index, 'a', ME, 3)).toHaveLength(3);
	});

	it('never returns a page the viewer cannot see', () => {
		const idx = buildFeatureIndex(contributor, [...contributorModules]);
		expect(searchFeatures(idx, 'admin', ME, 20)).toEqual([]);
		expect(searchFeatures(idx, 'pap', ME, 20).map((h) => h.href)).not.toContain('/team/pap');
	});
});

describe('sanitizeQuery', () => {
	it('turns PostgREST filter syntax into the single-char wildcard', () => {
		expect(sanitizeQuery(`a%b_c,d(e)f"g'h\\i*j`)).toBe('a_b_c_d_e_f_g_h_i_j');
	});
	it('keeps punctuated names findable', () => {
		expect(sanitizeQuery("L'Oréal")).toBe('L_Oréal');
		expect(sanitizeQuery("O'Brien")).toBe('O_Brien');
		expect(sanitizeQuery('Smith, Jones')).toBe('Smith_ Jones');
	});
	it('drops a query that is only punctuation', () => {
		expect(sanitizeQuery("''")).toBe('');
		expect(sanitizeQuery('(%)')).toBe('');
	});
	it('collapses whitespace and bounds the length', () => {
		expect(sanitizeQuery('  two   words ')).toBe('two words');
		expect(sanitizeQuery('x'.repeat(200))).toHaveLength(80);
	});
});
