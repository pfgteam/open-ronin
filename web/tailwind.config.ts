import type { Config } from 'tailwindcss';

// Neutral scale = the Work Revamp design tokens (prototype 2026-10-01). Each
// step is a CSS variable defined in globals.css with one value per mode, so
// the same class resolves to the prototype's light token in light mode and
// its dark token under `.dark`:
//
//   slate-50  page bg (--bg)      slate-600  secondary text (--tx2)
//   slate-100 soft fills (--soft) slate-700  dark borders / hover fills
//   slate-200 hairlines (--line)  slate-800  dark card surface (--card)
//   slate-300 control borders     slate-900  text (--tx) / dark page (--bg)
//   slate-400 muted text (--tx3)  slate-950  outer page (--page)
//
// Opacity modifiers (`bg-slate-700/45`) keep working: Tailwind 4 emits
// color-mix() for variable-backed colors. style={} hex fallbacks for
// DB-driven colors should use the light values listed in globals.css.
const slate = {
	50: 'var(--c-slate-50)',
	100: 'var(--c-slate-100)',
	200: 'var(--c-slate-200)',
	300: 'var(--c-slate-300)',
	400: 'var(--c-slate-400)',
	500: 'var(--c-slate-500)',
	600: 'var(--c-slate-600)',
	700: 'var(--c-slate-700)',
	800: 'var(--c-slate-800)',
	900: 'var(--c-slate-900)',
	950: 'var(--c-slate-950)',
};

const scale = (name: string, steps: number[]): Record<number, string> =>
	Object.fromEntries(steps.map((s) => [s, `var(--c-${name}-${s})`]));

const config: Config = {
	darkMode: 'class',
	content: ['./src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			fontFamily: {
				// Style guide decision 1: next/font registers Inter as the
				// --font-inter variable, never under the name "Inter", so the old
				// literal rendered the system font wherever Inter wasn't installed.
				// --font-app defaults to var(--font-inter) (globals.css) and is the
				// knob Admin › Design system turns.
				sans: ['var(--font-app)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
			},
			fontSize: {
				// Single micro size below text-xs. Replaces ad-hoc text-[9px]/[10px]/[11px];
				// arbitrary px font sizes are banned — see UI_GUIDELINES.md.
				'2xs': ['11px', { lineHeight: '14px' }],
				// Prototype body size (13px): nav tabs, sidebar items, dense tables.
				'13': ['13px', { lineHeight: '18px' }],
			},
			boxShadow: {
				// The prototype's one elevation (--shadow): side panels, modals,
				// popovers, the bulk bar. Flips with the theme.
				panel: 'var(--shadow)',
			},
			colors: {
				// Open Ronin brand palette (2026 refresh). primary = Teal, accent = Lime, ink/slate = Dark Gray.
				// Semantic status colors use Tailwind defaults: green = success, amber = warning, red = danger.
				slate,
				// Since 2026-11-05 the brand and status scales are CSS variables
				// (defaults in globals.css) so Admin > Design system can re-theme
				// the app at runtime. Lime (accent) is a BRAND accent, never a status.
				primary: {
					...scale('primary', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
					// Active-nav tint in dark mode (dark:bg-primary-950) = the
					// prototype's dark --pri50 (#0f2e2e); #023b3b in light mode.
					950: 'var(--c-primary-950)',
				},
				accent: scale('accent', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
				// Status solids at the two steps the app paints fills with; the rest
				// of each scale stays Tailwind's.
				red: { 500: 'var(--c-danger)', 600: 'var(--c-danger)' },
				amber: { 500: 'var(--c-warning)', 600: 'var(--c-warning)' },
				green: { 500: 'var(--c-success)', 600: 'var(--c-success)' },
				// Row hover from the prototype (--hover): the one teal-tinted
				// neutral. `hover:bg-hover` on list and table rows, both modes.
				hover: 'var(--c-hover)',
				// Selected row/item (--selected): always stronger than hover. Use
				// `bg-selected` for the active row in lists, popovers and boards.
				selected: 'var(--c-selected)',
				ink: slate,
				surface: {
					DEFAULT: '#ffffff',
					secondary: 'var(--c-slate-50)',
					tertiary: 'var(--c-slate-100)',
					dark: 'var(--c-slate-900)',
					'dark-secondary': 'var(--c-slate-800)',
					'dark-tertiary': 'var(--c-slate-700)',
				},
			},
		},
	},
	plugins: [],
};

export default config;
