// Colour vocabulary that is NOT a Tailwind class (style guide decisions 7 + 8).
//
// Two kinds of colour reach a `style={}` attribute: DB-driven colours (a
// department tag, a calendar category, a dropdown option) and the small
// palettes the board uses for avatars and groups. Both live here so no
// component carries its own hex list:
//
//   - FALLBACK_COLOR is the ONE hex used when a DB colour is missing. It is
//     the light `--tx3` token (#8f9494), readable on both card surfaces.
//   - VIZ is a token-backed palette: each entry is a CSS variable defined in
//     globals.css with a light and a dark value (and overridable from
//     Admin › Design system), so avatars and group bars follow the theme
//     instead of hard-coding monday.com blues.

/** Fallback for a missing DB-driven colour (style guide decision 7). */
export const FALLBACK_COLOR = '#8f9494';

/** Token-backed categorical palette (style guide decision 8). */
export const VIZ = [
	'var(--viz-1)',
	'var(--viz-2)',
	'var(--viz-3)',
	'var(--viz-4)',
	'var(--viz-5)',
	'var(--viz-6)',
	'var(--viz-7)',
	'var(--viz-8)',
] as const;

/** Stable palette pick for an id (avatars, owner chips). */
export function vizFor(id: string | null | undefined): string {
	if (!id) return FALLBACK_COLOR;
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
	return VIZ[Math.abs(h) % VIZ.length];
}

/** Palette pick by position (group bars, chart series). */
export function vizAt(i: number): string {
	return VIZ[((i % VIZ.length) + VIZ.length) % VIZ.length];
}

/** Six-digit hex only (DB colours are validated to this shape). */
export const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex);
	if (!m) return 0;
	const n = parseInt(m[1], 16);
	const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a), lb = luminance(b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}
