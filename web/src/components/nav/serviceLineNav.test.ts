import { describe, expect, it } from 'vitest';
import { navSections } from './navConfig';
import { withServiceLines } from './serviceLineNav';

const work = navSections.find((s) => s.key === 'work')!;
const clientWork = (groups: typeof work.groups) => groups.find((g) => g.title === 'Client Work')!;

describe('withServiceLines', () => {
	it('leaves the menu alone when no service lines are configured', () => {
		expect(withServiceLines(work.groups, [])).toBe(work.groups);
		expect(withServiceLines(work.groups, undefined)).toBe(work.groups);
	});

	it('keeps configured built-ins (with the configured label), drops the rest, adds new lines', () => {
		const groups = withServiceLines(work.groups, [
			{ key: 'pr', label: 'Public Relations' },
			{ key: 'social', label: 'Social' },
			{ key: 'seo', label: 'SEO / GEO' },
		]);
		const labels = clientWork(groups).items.map((i) => i.label);
		expect(labels).toContain('Public Relations');
		expect(labels).toContain('Social');
		expect(labels).toContain('SEO / GEO');
		expect(labels).not.toContain('Beacon');
		expect(labels).not.toContain('Flywheel');
		expect(labels).not.toContain('Writing');
		// non-service rows (media outlets etc.) stay
		expect(labels).toContain('Media Outlets');
		const seo = clientWork(groups).items.find((i) => i.label === 'SEO / GEO')!;
		expect(seo.children?.[0].href).toBe('/clients/deliverables?service=seo');
	});

	it('does not touch other groups', () => {
		const groups = withServiceLines(work.groups, [{ key: 'pr', label: 'PR' }]);
		groups.forEach((g, i) => {
			if (g.title !== 'Client Work') expect(g).toBe(work.groups[i]);
		});
	});
});
