import { describe, expect, it } from 'vitest';
import { contrastChecks, deriveScale, designCss, identityOf, parseDesignSettings, previewCss, prune, DEFAULT_IDENTITY } from './settings';

describe('design system settings', () => {
	it('no overrides emit no CSS (globals.css stays the source of the default look)', () => {
		expect(designCss({})).toBe('');
	});

	it('emits only the overridden tokens, per mode', () => {
		const css = designCss({ light: { tx: '#111111' }, dark: { card: '#222222' } });
		expect(css).toBe(':root{--tx:#111111}.dark{--card:#222222}');
	});

	it('a primary override derives the whole scale and the dark tints', () => {
		const css = designCss({ brand: { primary: '#3366cc' } });
		expect(css).toContain('--c-primary-600:#3366cc');
		expect(css).toContain('--c-primary-50:');
		expect(css).toMatch(/\.dark\{--pri50:#[0-9a-f]{6};--pri100:#[0-9a-f]{6};--pri-t:#[0-9a-f]{6}\}/);
		expect(deriveScale('#3366cc')[600]).toBe('#3366cc');
	});

	it('radius, font and button settings become variables; defaults emit nothing', () => {
		expect(designCss({ radius: 'md', font: { sans: 'inter' } })).toBe('');
		const css = designCss({ radius: 'lg', font: { sans: 'dm-sans' }, button: { radius: 'pill', border: false, weight: 'semibold' } });
		expect(css).toContain('--radius-md:0.5rem');
		expect(css).toContain('--font-app:"DM Sans"');
		expect(css).toContain('--btn-radius:9999px');
		expect(css).toContain('--btn-border-w:0px');
		expect(css).toContain('--btn-weight:600');
	});

	it('never lets free text into the CSS', () => {
		const s = parseDesignSettings({ light: { tx: 'red;}body{display:none' }, radius: 'huge', font: { sans: 'Comic Sans' }, identity: { app_name: 'Acme' } });
		expect(s.light).toBeUndefined();
		expect(s.radius).toBeUndefined();
		expect(s.font).toBeUndefined();
		expect(identityOf(s).appName).toBe('Acme');
		expect(designCss(s)).toBe('');
	});

	it('logo URLs must be https or a site path', () => {
		expect(parseDesignSettings({ identity: { logo_light_url: 'javascript:alert(1)' } }).identity).toBeUndefined();
		expect(parseDesignSettings({ identity: { logo_light_url: 'https://cdn.example.com/logo.png' } }).identity?.logo_light_url).toBe('https://cdn.example.com/logo.png');
		expect(identityOf({})).toEqual(DEFAULT_IDENTITY);
	});

	it('prune drops empty sections (what Reset stores)', () => {
		expect(prune({ light: {}, brand: { primary: undefined }, radius: undefined })).toEqual({});
	});

	it('the contrast guard reproduces the style guide numbers on the defaults', () => {
		const c = Object.fromEntries(contrastChecks({}).map((x) => [x.id, x]));
		expect(c['l-tx2-card'].ratio).toBeCloseTo(7.3, 0);
		expect(c['l-tx3-card'].ratio).toBeCloseTo(3.1, 0);
		expect(c['l-line2-card'].ok).toBe(false); // known, flagged in the guide
		expect(c['l-danger'].ratio).toBeGreaterThanOrEqual(4.5);
		expect(c['l-btn'].ok).toBe(true);
	});

	it('warns when a chosen pair fails', () => {
		const c = contrastChecks({ light: { tx: '#bbbbbb' } }).find((x) => x.id === 'l-tx-card')!;
		expect(c.ok).toBe(false);
	});

	it('the preview CSS is scoped to the two preview containers', () => {
		const css = previewCss({ brand: { primary: '#3366cc' } });
		expect(css.startsWith('.ds-preview-light{')).toBe(true);
		expect(css).toContain('.ds-preview-dark.dark{');
		expect(css).not.toContain(':root');
	});
});
