// Design system settings (Admin › Design system, migration 0161). Pure
// module: the vocabulary, the defaults, validation, scale derivation, the
// CSS the app emits at runtime and the contrast guard. No server imports, so
// the admin page's client preview uses exactly the same code as the server.
//
// Model: the `design_settings.settings` row stores OVERRIDES only. The
// defaults below mirror globals.css (which stays the source of truth for the
// look when nothing is overridden); `designCss()` emits CSS variables for
// the overridden keys only, so an empty row emits nothing and Reset to
// defaults is removing keys.

import { z } from 'zod';
import { contrastRatio } from '@/lib/colors';

export const HEX = /^#[0-9a-fA-F]{6}$/;

// ------------------------------------------------------------------ tokens

export const LIGHT_KEYS = ['page', 'bg', 'soft', 'hover', 'selected', 'line', 'line2', 'tx', 'tx2', 'tx3'] as const;
export const DARK_KEYS = ['page', 'bg', 'card', 'soft', 'hover', 'selected', 'line', 'line2', 'tx', 'tx2', 'tx3'] as const;
export const BRAND_KEYS = ['primary', 'accent', 'success', 'warning', 'danger'] as const;
export type LightKey = (typeof LIGHT_KEYS)[number];
export type DarkKey = (typeof DARK_KEYS)[number];
export type BrandKey = (typeof BRAND_KEYS)[number];

export const TOKEN_LABELS: Record<string, { label: string; help: string }> = {
	page: { label: 'Outer page', help: 'Behind everything (the frame).' },
	bg: { label: 'Page background', help: 'Behind cards and lists.' },
	card: { label: 'Card surface', help: 'Cards, tables, the nav.' },
	soft: { label: 'Soft fill', help: 'Chips, inputs at rest, subtle fills.' },
	hover: { label: 'Row hover', help: 'List and table rows under the pointer.' },
	selected: { label: 'Selected row', help: 'Must read stronger than hover.' },
	line: { label: 'Hairline', help: 'Dividers and card borders.' },
	line2: { label: 'Control border', help: 'Inputs, selects, bordered buttons.' },
	tx: { label: 'Text', help: 'Body text and headings.' },
	tx2: { label: 'Secondary text', help: 'Descriptions, meta.' },
	tx3: { label: 'Muted', help: 'Icons and dividers only (not body text).' },
	primary: { label: 'Primary', help: 'Brand colour: buttons, links, focus, active nav. The 50–900 scale is derived.' },
	accent: { label: 'Accent', help: 'Brand highlight (logo mark). Never a status.' },
	success: { label: 'Success', help: 'Done, approved.' },
	warning: { label: 'Warning', help: 'In review, at risk.' },
	danger: { label: 'Danger', help: 'Blocked, overdue, destructive.' },
};

/** Mirrors globals.css. Light card is plain white (`bg-white` across the app). */
export const DEFAULTS = {
	light: { page: '#e9eded', bg: '#f6f7f7', soft: '#f2f3f3', hover: '#eef6f6', selected: '#daefef', line: '#e3e6e6', line2: '#c9cfcf', tx: '#202020', tx2: '#565656', tx3: '#8f9494' } as Record<LightKey, string>,
	dark: { page: '#141414', bg: '#1b1c1c', card: '#232424', soft: '#2b2c2c', hover: '#173232', selected: '#1d4a4a', line: '#333535', line2: '#474a4a', tx: '#f2f2f2', tx2: '#b8bcbc', tx3: '#848989' } as Record<DarkKey, string>,
	brand: { primary: '#069494', accent: '#88d03a', success: '#00a35c', warning: '#e8890c', danger: '#d83a52' } as Record<BrandKey, string>,
	lightCard: '#ffffff',
};

// ------------------------------------------------------------------ fonts

export interface FontDef { label: string; stack: string; google?: string }
export const FONTS: Record<string, FontDef> = {
	inter: { label: 'Inter (default)', stack: 'var(--font-inter), system-ui, sans-serif' },
	system: { label: 'System UI', stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
	'dm-sans': { label: 'DM Sans', stack: '"DM Sans", system-ui, sans-serif', google: 'DM+Sans:wght@400;500;600;700' },
	manrope: { label: 'Manrope', stack: 'Manrope, system-ui, sans-serif', google: 'Manrope:wght@400;500;600;700' },
	'ibm-plex-sans': { label: 'IBM Plex Sans', stack: '"IBM Plex Sans", system-ui, sans-serif', google: 'IBM+Plex+Sans:wght@400;500;600;700' },
	'source-sans-3': { label: 'Source Sans 3', stack: '"Source Sans 3", system-ui, sans-serif', google: 'Source+Sans+3:wght@400;500;600;700' },
	'work-sans': { label: 'Work Sans', stack: '"Work Sans", system-ui, sans-serif', google: 'Work+Sans:wght@400;500;600;700' },
	'nunito-sans': { label: 'Nunito Sans', stack: '"Nunito Sans", system-ui, sans-serif', google: 'Nunito+Sans:wght@400;500;600;700' },
	lato: { label: 'Lato', stack: 'Lato, system-ui, sans-serif', google: 'Lato:wght@400;700' },
	roboto: { label: 'Roboto', stack: 'Roboto, system-ui, sans-serif', google: 'Roboto:wght@400;500;700' },
	'open-sans': { label: 'Open Sans', stack: '"Open Sans", system-ui, sans-serif', google: 'Open+Sans:wght@400;500;600;700' },
	poppins: { label: 'Poppins', stack: 'Poppins, system-ui, sans-serif', google: 'Poppins:wght@400;500;600;700' },
	georgia: { label: 'Georgia (serif)', stack: 'Georgia, "Times New Roman", serif' },
};

export function fontHref(key: string | undefined): string | null {
	const f = key ? FONTS[key] : undefined;
	return f?.google ? `https://fonts.googleapis.com/css2?family=${f.google}&display=swap` : null;
}

// ------------------------------------------------------------- radius, buttons

export const RADIUS_PRESETS: Record<string, { label: string; sm: string; md: string; lg: string; xl: string }> = {
	none: { label: 'Square', sm: '0px', md: '0px', lg: '0px', xl: '0px' },
	sm: { label: 'Subtle', sm: '0.125rem', md: '0.25rem', lg: '0.375rem', xl: '0.5rem' },
	md: { label: 'Default', sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem' },
	lg: { label: 'Rounded', sm: '0.375rem', md: '0.5rem', lg: '0.75rem', xl: '1rem' },
	xl: { label: 'Very rounded', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.25rem' },
};
export const BUTTON_RADIUS = { match: 'Match corners', square: 'Square', pill: 'Pill' } as const;
export const BUTTON_WEIGHT = { medium: 'Medium (500)', semibold: 'Semibold (600)', bold: 'Bold (700)' } as const;

// --------------------------------------------------------------- the schema

const hex = z.string().regex(HEX);
const partial = <K extends string>(keys: readonly K[]) =>
	z.object(Object.fromEntries(keys.map((k) => [k, hex.optional()])) as Record<K, z.ZodOptional<typeof hex>>).strict();

const safeUrl = z.string().max(500).refine((v) => /^https:\/\/[^\s"'<>]+$/.test(v) || /^\/[A-Za-z0-9._\-/]+$/.test(v), 'Use an https:// URL or a /path on this site.');

export const designSettingsSchema = z.object({
	light: partial(LIGHT_KEYS).optional(),
	dark: partial(DARK_KEYS).optional(),
	brand: partial(BRAND_KEYS).optional(),
	font: z.object({ sans: z.enum(Object.keys(FONTS) as [string, ...string[]]).optional() }).strict().optional(),
	radius: z.enum(Object.keys(RADIUS_PRESETS) as [string, ...string[]]).optional(),
	button: z.object({
		radius: z.enum(Object.keys(BUTTON_RADIUS) as [string, ...string[]]).optional(),
		border: z.boolean().optional(),
		weight: z.enum(Object.keys(BUTTON_WEIGHT) as [string, ...string[]]).optional(),
	}).strict().optional(),
	identity: z.object({
		app_name: z.string().trim().min(1).max(40).optional(),
		org_name: z.string().trim().min(1).max(80).optional(),
		logo_light_url: safeUrl.optional(),
		logo_dark_url: safeUrl.optional(),
	}).strict().optional(),
}).strict();

export type DesignSettings = z.infer<typeof designSettingsSchema>;

/** Parse a stored row defensively: drop anything invalid instead of failing the render. */
export function parseDesignSettings(raw: unknown): DesignSettings {
	const r = designSettingsSchema.safeParse(raw ?? {});
	if (r.success) return prune(r.data);
	// Salvage section by section so one bad key does not wipe the theme.
	const out: Record<string, unknown> = {};
	if (raw && typeof raw === 'object') {
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			const one = designSettingsSchema.safeParse({ [k]: v });
			if (one.success) Object.assign(out, one.data);
		}
	}
	return prune(out as DesignSettings);
}

/** Remove empty sections and undefined keys (what gets stored). */
export function prune(s: DesignSettings): DesignSettings {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(s)) {
		if (v === undefined || v === null) continue;
		if (typeof v === 'object' && !Array.isArray(v)) {
			const inner = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== ''));
			if (Object.keys(inner).length) out[k] = inner;
		} else out[k] = v;
	}
	return out as DesignSettings;
}

// ------------------------------------------------------------ identity

export interface Identity { appName: string; orgName: string; logoLight: string; logoDark: string }
export const DEFAULT_IDENTITY: Identity = {
	appName: 'Open Ronin',
	orgName: 'Open Ronin',
	logoLight: '/logo-mark.svg',
	logoDark: '/logo-mark.svg',
};
export function identityOf(s: DesignSettings): Identity {
	return {
		appName: s.identity?.app_name ?? DEFAULT_IDENTITY.appName,
		orgName: s.identity?.org_name ?? DEFAULT_IDENTITY.orgName,
		logoLight: s.identity?.logo_light_url ?? DEFAULT_IDENTITY.logoLight,
		logoDark: s.identity?.logo_dark_url ?? DEFAULT_IDENTITY.logoDark,
	};
}

// ----------------------------------------------------------- colour math

function rgb(hexStr: string): [number, number, number] {
	const n = parseInt(hexStr.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: [number, number, number]): string {
	return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}
/** `amount` of `a` over `b` (sRGB). */
export function mix(a: string, b: string, amount: number): string {
	const x = rgb(a), y = rgb(b);
	return toHex([x[0] * amount + y[0] * (1 - amount), x[1] * amount + y[1] * (1 - amount), x[2] * amount + y[2] * (1 - amount)]);
}

/** A 50–900 scale with `base` at 600 (tints toward white, shades toward black). */
export function deriveScale(base: string): Record<number, string> {
	const W = '#ffffff', K = '#000000';
	return {
		50: mix(base, W, 0.08), 100: mix(base, W, 0.15), 200: mix(base, W, 0.3), 300: mix(base, W, 0.5),
		400: mix(base, W, 0.78), 500: mix(base, W, 0.9), 600: base,
		700: mix(base, K, 0.85), 800: mix(base, K, 0.7), 900: mix(base, K, 0.55), 950: mix(base, K, 0.4),
	};
}

// -------------------------------------------------------------- the CSS

/** Effective value of every token (defaults merged with overrides). */
export function resolveTokens(s: DesignSettings) {
	return {
		light: { ...DEFAULTS.light, ...(s.light ?? {}) } as Record<LightKey, string>,
		dark: { ...DEFAULTS.dark, ...(s.dark ?? {}) } as Record<DarkKey, string>,
		brand: { ...DEFAULTS.brand, ...(s.brand ?? {}) } as Record<BrandKey, string>,
	};
}

/**
 * CSS for the overrides only. Empty settings -> empty string (globals.css
 * already has the defaults). Values are validated hex / preset keys, so the
 * output cannot carry anything but declarations.
 */
export function designCss(s: DesignSettings, scope: { light: string; dark: string } = { light: ':root', dark: '.dark' }): string {
	const light: string[] = [];
	const dark: string[] = [];
	for (const [k, v] of Object.entries(s.light ?? {})) if (v && HEX.test(v)) light.push(`--${k}:${v}`);
	for (const [k, v] of Object.entries(s.dark ?? {})) if (v && HEX.test(v)) dark.push(`--${k}:${v}`);

	const b = s.brand ?? {};
	if (b.primary && HEX.test(b.primary)) {
		const sc = deriveScale(b.primary);
		for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) light.push(`--c-primary-${step}:${sc[step]}`);
		light.push(`--pri:${sc[600]}`, `--pri600:${sc[700]}`, `--pri50:${sc[50]}`, `--pri100:${sc[100]}`, `--pri-t:${sc[900]}`, `--c-primary-950:${sc[950]}`);
		const darkBg = s.dark?.page && HEX.test(s.dark.page) ? s.dark.page : DEFAULTS.dark.page;
		dark.push(`--pri50:${mix(b.primary, darkBg, 0.2)}`, `--pri100:${mix(b.primary, darkBg, 0.3)}`, `--pri-t:${sc[300]}`);
	}
	if (b.accent && HEX.test(b.accent)) {
		const sc = deriveScale(b.accent);
		for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) light.push(`--c-accent-${step}:${sc[step]}`);
		light.push(`--lime:${b.accent}`);
	}
	if (b.success && HEX.test(b.success)) light.push(`--c-success:${b.success}`);
	if (b.warning && HEX.test(b.warning)) light.push(`--c-warning:${b.warning}`);
	if (b.danger && HEX.test(b.danger)) light.push(`--c-danger:${b.danger}`, `--danger:${b.danger}`);

	const font = s.font?.sans ? FONTS[s.font.sans] : undefined;
	if (font && s.font?.sans !== 'inter') light.push(`--font-app:${font.stack}`);

	const r = s.radius ? RADIUS_PRESETS[s.radius] : undefined;
	if (r && s.radius !== 'md') light.push(`--radius-sm:${r.sm}`, `--radius-md:${r.md}`, `--radius-lg:${r.lg}`, `--radius-xl:${r.xl}`);

	if (s.button?.radius === 'square') light.push('--btn-radius:0px');
	else if (s.button?.radius === 'pill') light.push('--btn-radius:9999px');
	if (s.button?.border === false) light.push('--btn-border-w:0px');
	if (s.button?.weight === 'semibold') light.push('--btn-weight:600');
	else if (s.button?.weight === 'bold') light.push('--btn-weight:700');

	let css = '';
	if (light.length) css += `${scope.light}{${light.join(';')}}`;
	if (dark.length) css += `${scope.dark}{${dark.join(';')}}`;
	return css;
}

// --------------------------------------------------------- preview CSS

const LIGHT_ALIASES = '--card:#ffffff;--c-slate-50:var(--bg);--c-slate-100:var(--soft);--c-slate-200:var(--line);--c-slate-300:var(--line2);--c-slate-400:var(--tx3);--c-slate-500:#6f7474;--c-slate-600:var(--tx2);--c-slate-700:#3a3c3c;--c-slate-800:#2b2c2c;--c-slate-900:var(--tx);--c-slate-950:#141414;--c-hover:var(--hover);--c-selected:var(--selected);--shadow:0 12px 32px rgba(20,30,30,.16);color-scheme:light';
const DARK_ALIASES = '--c-slate-50:#f6f7f7;--c-slate-100:var(--tx);--c-slate-200:#e0e2e2;--c-slate-300:#cfd2d2;--c-slate-400:var(--tx2);--c-slate-500:var(--tx3);--c-slate-600:var(--line2);--c-slate-700:var(--line);--c-slate-800:var(--card);--c-slate-900:var(--bg);--c-slate-950:var(--page);--c-primary-950:var(--pri50);--c-hover:var(--hover);--c-selected:var(--selected);--shadow:0 12px 32px rgba(0,0,0,.5);color-scheme:dark';

/**
 * Self-contained CSS for the admin page's live preview: two containers
 * (`.ds-preview-light`, `.ds-preview-dark.dark`) that each carry the FULL
 * resolved token set, so the preview is right whatever mode the admin's own
 * page is in, and nothing leaks to the rest of the page before Save.
 */
export function previewCss(s: DesignSettings): string {
	const t = resolveTokens(s);
	const p = deriveScale(t.brand.primary);
	const a = deriveScale(t.brand.accent);
	const brand: string[] = [];
	const useDefaultPrimary = !s.brand?.primary;
	const defaultPrimary: Record<number, string> = { 50: '#ebf6f6', 100: '#daefef', 200: '#b4dfdf', 300: '#82caca', 400: '#38a9a9', 500: '#1a9d9d', 600: '#069494', 700: '#057e7e', 800: '#046868', 900: '#035151' };
	for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) brand.push(`--c-primary-${step}:${useDefaultPrimary ? defaultPrimary[step] : p[step]}`);
	if (s.brand?.accent) for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) brand.push(`--c-accent-${step}:${a[step]}`);
	brand.push(`--c-success:${t.brand.success}`, `--c-warning:${t.brand.warning}`, `--c-danger:${t.brand.danger}`);
	const font = FONTS[s.font?.sans ?? 'inter'] ?? FONTS.inter;
	brand.push(`--font-app:${font.stack}`, `font-family:${font.stack}`);
	const r = RADIUS_PRESETS[s.radius ?? 'md'] ?? RADIUS_PRESETS.md;
	brand.push(`--radius-sm:${r.sm}`, `--radius-md:${r.md}`, `--radius-lg:${r.lg}`, `--radius-xl:${r.xl}`);
	brand.push(`--btn-radius:${s.button?.radius === 'square' ? '0px' : s.button?.radius === 'pill' ? '9999px' : 'var(--radius-md)'}`);
	brand.push(`--btn-border-w:${s.button?.border === false ? '0px' : '1px'}`);
	brand.push(`--btn-weight:${s.button?.weight === 'bold' ? 700 : s.button?.weight === 'semibold' ? 600 : 500}`);

	const lightTokens = Object.entries(t.light).map(([k, v]) => `--${k}:${v}`);
	lightTokens.push(`--pri50:${useDefaultPrimary ? '#ebf6f6' : p[50]}`, `--pri100:${useDefaultPrimary ? '#daefef' : p[100]}`, `--pri-t:${useDefaultPrimary ? '#035151' : p[900]}`, `--c-primary-950:${useDefaultPrimary ? '#023b3b' : p[950]}`);
	const darkTokens = Object.entries(t.dark).map(([k, v]) => `--${k}:${v}`);
	darkTokens.push(
		`--pri50:${useDefaultPrimary ? '#0f2e2e' : mix(t.brand.primary, t.dark.page, 0.2)}`,
		`--pri100:${useDefaultPrimary ? '#134040' : mix(t.brand.primary, t.dark.page, 0.3)}`,
		`--pri-t:${useDefaultPrimary ? '#82caca' : p[300]}`,
	);
	return `.ds-preview-light{${[...lightTokens, LIGHT_ALIASES, ...brand].join(';')};background:var(--bg);color:var(--tx)}`
		+ `.ds-preview-dark.dark{${[...darkTokens, DARK_ALIASES, ...brand].join(';')};background:var(--bg);color:var(--tx)}`;
}

// ------------------------------------------------------------ contrast guard

export interface ContrastCheck {
	id: string;
	mode: 'light' | 'dark';
	label: string;
	fg: string;
	bg: string;
	ratio: number;
	min: number;
	ok: boolean;
	note?: string;
}

/**
 * The pairs the style guide measures (openronin-style-guide-adoption.md,
 * "Contrast notes"): body + secondary text on cards (4.5:1), muted on cards
 * (3:1, icons only), control borders on cards (3:1 WCAG 1.4.11; the default
 * palette already fails this and the guide keeps it, so it warns), white on
 * the primary button (4.5:1), text on success / warning fills and white on
 * danger (4.5:1), primary link text on cards.
 */
export function contrastChecks(s: DesignSettings): ContrastCheck[] {
	const t = resolveTokens(s);
	const p = deriveScale(t.brand.primary);
	const white = '#ffffff';
	const pairs: Omit<ContrastCheck, 'ratio' | 'ok'>[] = [
		{ id: 'l-tx-card', mode: 'light', label: 'Text on card', fg: t.light.tx, bg: DEFAULTS.lightCard, min: 4.5 },
		{ id: 'l-tx-bg', mode: 'light', label: 'Text on page background', fg: t.light.tx, bg: t.light.bg, min: 4.5 },
		{ id: 'l-tx2-card', mode: 'light', label: 'Secondary text on card', fg: t.light.tx2, bg: DEFAULTS.lightCard, min: 4.5 },
		{ id: 'l-tx3-card', mode: 'light', label: 'Muted on card', fg: t.light.tx3, bg: DEFAULTS.lightCard, min: 3, note: 'Icons and dividers only; never body text.' },
		{ id: 'l-line2-card', mode: 'light', label: 'Control border on card', fg: t.light.line2, bg: DEFAULTS.lightCard, min: 3, note: 'WCAG 1.4.11 asks 3:1 for control boundaries. The default palette is 1.6:1 and relies on the focus ring.' },
		{ id: 'l-btn', mode: 'light', label: 'White on primary button', fg: white, bg: p[700], min: 4.5 },
		{ id: 'l-link', mode: 'light', label: 'Primary link on card', fg: p[700], bg: DEFAULTS.lightCard, min: 4.5 },
		{ id: 'l-success', mode: 'light', label: 'Text on success fill', fg: t.light.tx, bg: t.brand.success, min: 4.5, note: 'Use text, not white, on success fills.' },
		{ id: 'l-warning', mode: 'light', label: 'Text on warning fill', fg: t.light.tx, bg: t.brand.warning, min: 4.5, note: 'Use text, not white, on warning fills.' },
		{ id: 'l-danger', mode: 'light', label: 'White on danger fill', fg: white, bg: t.brand.danger, min: 4.5 },
		{ id: 'd-tx-card', mode: 'dark', label: 'Text on card', fg: t.dark.tx, bg: t.dark.card, min: 4.5 },
		{ id: 'd-tx-bg', mode: 'dark', label: 'Text on page background', fg: t.dark.tx, bg: t.dark.bg, min: 4.5 },
		{ id: 'd-tx2-card', mode: 'dark', label: 'Secondary text on card', fg: t.dark.tx2, bg: t.dark.card, min: 4.5 },
		{ id: 'd-tx3-card', mode: 'dark', label: 'Muted on card', fg: t.dark.tx3, bg: t.dark.card, min: 3, note: 'Icons and dividers only; never body text.' },
		{ id: 'd-line2-card', mode: 'dark', label: 'Control border on card', fg: t.dark.line2, bg: t.dark.card, min: 3, note: 'WCAG 1.4.11 asks 3:1 for control boundaries. The default palette is 1.7:1.' },
		{ id: 'd-link', mode: 'dark', label: 'Primary link on card', fg: p[300], bg: t.dark.card, min: 4.5 },
		{ id: 'd-btn', mode: 'dark', label: 'White on primary button', fg: white, bg: p[700], min: 4.5 },
	];
	return pairs.map((c) => {
		const ratio = Math.round(contrastRatio(c.fg, c.bg) * 100) / 100;
		return { ...c, ratio, ok: ratio >= c.min };
	});
}
