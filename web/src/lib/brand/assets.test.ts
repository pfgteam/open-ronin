import { describe, expect, it } from 'vitest';
import { parseTags, safeFileName, formatBytes, BRAND_ASSETS_PREFIX } from './assets';
import { PLATFORM_BRAND_ID } from './constants';

describe('brand assets helpers', () => {
	it('parseTags lowercases, dedupes, hyphenates, caps at 12', () => {
		expect(parseTags('Logo, dark , Web, logo\nprint')).toEqual(['logo', 'dark', 'web', 'print']);
		expect(parseTags('a b')).toEqual(['a-b']);
		expect(parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(','))).toHaveLength(12);
	});
	it('safeFileName keeps the extension and strips the rest', () => {
		expect(safeFileName('Open Ronin Logo (Final) v2.PNG')).toBe('open-ronin-logo-final-v2.png');
		const hostile = safeFileName('../../etc/passwd');
		expect(hostile).not.toContain('/');
		expect(hostile).not.toContain('..');
		expect(safeFileName('noext')).toBe('noext');
	});
	it('prefix matches the 0076 seed id and the 0111 CHECK', () => {
		expect(PLATFORM_BRAND_ID).toBe('b7a3c1d0-0000-4000-8000-000000000076');
		expect(BRAND_ASSETS_PREFIX).toBe(`brand/${PLATFORM_BRAND_ID}/`);
		expect(BRAND_ASSETS_PREFIX.startsWith('brand/')).toBe(true);
	});
	it('formatBytes', () => {
		expect(formatBytes(null)).toBeNull();
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2 KB');
		expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
	});
});
