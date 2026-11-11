// Emits the design system overrides (Admin › Design system) as CSS
// variables, after globals.css, plus the font stylesheet when a Google font
// is chosen. Rendered once in the root layout. With no overrides it renders
// nothing at all, so the default look costs zero bytes.
//
// Safe to inline: designCss() only emits declarations built from validated
// hex values and preset keys (lib/design/settings.ts), never free text.

import { designCss, fontHref, type DesignSettings } from '@/lib/design/settings';

export default function DesignTokens({ settings }: { settings: DesignSettings }) {
	const css = designCss(settings);
	const href = fontHref(settings.font?.sans);
	if (!css && !href) return null;
	return (
		<>
			{href && (
				<>
					<link rel="preconnect" href="https://fonts.googleapis.com" />
					<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
					<link rel="stylesheet" href={href} />
				</>
			)}
			{css && <style id="design-tokens" dangerouslySetInnerHTML={{ __html: css }} />}
		</>
	);
}
