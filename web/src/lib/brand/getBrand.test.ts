import { describe, expect, it } from 'vitest';
import { brandFromRow, type BrandRow } from './getBrand';
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, HEX_COLOR, TYPOGRAPHY, TYPOGRAPHY_LABELS, TYPOGRAPHY_STACKS, normalizeHandle } from './constants';

const row: BrandRow = {
	id: 'b7a3c1d0-0000-4000-8000-000000000076',
	brand_name: 'Open Ronin',
	website_url: 'https://example.com',
	logo_light_path: null,
	logo_dark_path: null,
	primary_color: '#123456',
	accent_color: 'not a color',
	typography: 'georgia',
	email_footer: 'Open Ronin · Washington, DC',
	social_handles: { instagram: '@org', x: '', linkedin: 'publicity-for-good', bogus: 'ignored' },
	updated_at: '2026-09-12T00:00:00Z',
};

describe('brandFromRow', () => {
	it('falls back to the Tailwind tokens when there is no row', () => {
		const b = brandFromRow(null);
		expect(b.primaryColor).toBe(DEFAULT_PRIMARY);
		expect(b.accentColor).toBe(DEFAULT_ACCENT);
		expect(b.typography).toBe('inter');
		expect(b.logoLightUrl).toBeNull();
		expect(b.emailFooter).toBe('');
		expect(b.socialHandles).toEqual({});
	});

	it('keeps valid values and replaces invalid ones', () => {
		const b = brandFromRow(row);
		expect(b.primaryColor).toBe('#123456');
		// An invalid hex must never reach a style attribute.
		expect(b.accentColor).toBe(DEFAULT_ACCENT);
		expect(b.typography).toBe('georgia');
		expect(b.fontStack).toBe(TYPOGRAPHY_STACKS.georgia);
		expect(b.emailFooter).toBe('Open Ronin · Washington, DC');
	});

	it('keeps only known, non empty social handles', () => {
		const b = brandFromRow(row);
		expect(b.socialHandles).toEqual({ instagram: '@org', linkedin: 'publicity-for-good' });
	});

	it('rejects an unknown typography', () => {
		expect(brandFromRow({ ...row, typography: 'comic-sans' }).typography).toBe('inter');
	});
});

describe('brand constants', () => {
	it('labels and stacks every typography choice', () => {
		for (const t of TYPOGRAPHY) {
			expect(TYPOGRAPHY_LABELS[t]).toBeTruthy();
			expect(TYPOGRAPHY_STACKS[t]).toBeTruthy();
		}
	});

	it('accepts six digit hex only', () => {
		expect(HEX_COLOR.test('#069494')).toBe(true);
		expect(HEX_COLOR.test('#fff')).toBe(false);
		expect(HEX_COLOR.test('069494')).toBe(false);
		expect(HEX_COLOR.test('#06949g')).toBe(false);
	});

	it('normalises handles by stripping the at sign', () => {
		expect(normalizeHandle('  @org ')).toBe('org');
		expect(normalizeHandle('@@org')).toBe('org');
	});
});
