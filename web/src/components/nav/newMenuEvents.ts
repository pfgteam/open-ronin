// Open the "+ New" palette from anywhere, preselecting one option and
// carrying page context (sheet: Contextual buttons — Client page → Request
// content / Log client ticket, Profile → Request time off, Hiring → Request
// a position, Planning → Request a project; each opens + New prefilled).
//
// The palette (NewMenu) listens for OPEN_NEW_EVENT. Context params ride on
// the chosen option's href as query params (?client=<id>), which the target
// page reads to prefill its form. No server imports: client components only.

export const OPEN_NEW_EVENT = 'or-open-new';

export interface NewMenuPreset {
	/** NewMenuOption.label to preselect (e.g. 'Content', 'Time off'). */
	option?: string;
	/** What the request is about: shown as a chip; params go on the option href. */
	context?: { label: string; params: Record<string, string> };
}

export function openNewMenu(preset: NewMenuPreset = {}): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent<NewMenuPreset>(OPEN_NEW_EVENT, { detail: preset }));
}

/** href + params, keeping any query the href already has. Empty values are skipped. */
export function withParams(href: string, params?: Record<string, string> | null): string {
	if (!params) return href;
	const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
	if (!entries.length) return href;
	const [path, query = ''] = href.split('?');
	const sp = new URLSearchParams(query);
	for (const [k, v] of entries) sp.set(k, v);
	return `${path}?${sp.toString()}`;
}
