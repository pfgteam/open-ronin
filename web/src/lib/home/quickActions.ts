// Home's "Quick actions" card — the catalog and the pure resolver.
//
// The card used to be a fixed list of three buttons. Per the Home v2 spec
// ("Quick actions become user-chosen"), each person now picks their own from
// this catalog and the choice persists per user in public.user_quick_actions
// (migration 0053). The DB stores only the KEYS — this file is the single
// place that knows what a key means, so adding or renaming an action is a
// code change, never a migration.
//
// Deliberately dependency-free (no React, no lucide, no Supabase): HomeView
// owns the icons and the rendering, this owns the rules, and the rules are
// unit-testable on their own.

export interface QuickAction {
	key: string;
	label: string;
	/** Destination. `{me}` is substituted with the viewer's id — see
	 *  quickActionHref. Absent means the action DOES something instead of
	 *  going somewhere (today: new_task fires the quick-add event). */
	href?: string;
	/** Hidden from viewers who lack access to where it points, both in the
	 *  picker and on the card. Today only run_scraper sets it, and the access
	 *  it tracks is the run_scrapers capability (0055) — NOT the admin role,
	 *  which is what it used to mean before the scraper moved out of /admin.
	 *  The resolver takes that decision as a boolean so this file stays
	 *  dependency-free; the caller resolves it. */
	restricted?: boolean;
}

// Catalog order is the picker's order, and the order of a brand-new user's
// card. The first four are the defaults.
export const QUICK_ACTIONS: QuickAction[] = [
	// No href: this one opens the boards' NewItemModal (kinds = task) where it
	// is rendered (Self → Overview, My work). It is not a route and must not become one.
	{ key: 'new_task', label: 'New task' },
	{ key: 'weekly_checkin', label: 'Weekly check-in', href: '/team/{me}?tab=checkins' },
	{ key: 'my_metrics', label: 'My metrics', href: '/team/{me}?tab=metrics' },
	{ key: 'open_calendar', label: 'Open calendar', href: '/the-work/calendar' },
	{ key: 'new_client_note', label: 'New client note', href: '/clients' },
	{ key: 'run_scraper', label: 'Run scraper', href: '/media/lead-scraper', restricted: true },
	// Self → Sales (2026-10-15): not restricted; a viewer without Prospects gets the ModuleGate card.
	{ key: 'add_prospect', label: 'Add prospect', href: '/prospects/deals/new' },
];

/** What someone who has never opened the picker sees. */
export const DEFAULT_QUICK_ACTION_KEYS: string[] = QUICK_ACTIONS.slice(0, 4).map((a) => a.key);

const BY_KEY = new Map(QUICK_ACTIONS.map((a) => [a.key, a]));

/** The catalog this viewer is allowed to pick from. `canUseRestricted` is
 *  "may this person reach the restricted destinations" — for run_scraper that
 *  is admin/exec OR the run_scrapers capability, resolved by the caller. */
export function availableQuickActions(canUseRestricted: boolean): QuickAction[] {
	return QUICK_ACTIONS.filter((a) => !a.restricted || canUseRestricted);
}

/**
 * Saved keys → the actions to render.
 *
 * `saved` is EXACTLY what came out of user_quick_actions, and the difference
 * between its two empty-ish shapes is the whole reason the table exists:
 *
 *   null → there is no row: the person never opened the picker. Show the
 *          default four.
 *   []   → there IS a row and it is empty: the person opened the picker and
 *          unchecked everything. Show NOTHING (the card keeps only its gear).
 *
 * Collapsing those two would either force actions back onto someone who
 * explicitly removed them, or hide the card from every user who never touched
 * it. Unknown keys (a retired catalog entry still sitting in someone's row)
 * are dropped, and dropping the last one leaves an empty card rather than
 * silently resurrecting the defaults — the person's row still says "I chose",
 * only their choices no longer exist.
 */
export function resolveQuickActions(saved: string[] | null, canUseRestricted: boolean): QuickAction[] {
	const keys = saved ?? DEFAULT_QUICK_ACTION_KEYS;
	const out: QuickAction[] = [];
	const seen = new Set<string>();
	for (const key of keys) {
		if (seen.has(key)) continue;
		seen.add(key);
		const action = BY_KEY.get(key);
		if (!action) continue;                       // retired / typo'd key
		if (action.restricted && !canUseRestricted) continue;  // runs on the default path too
		out.push(action);
	}
	return out;
}

/** The action's destination for this viewer, or null if it isn't a link. */
export function quickActionHref(action: QuickAction, viewerId: string): string | null {
	if (!action.href) return null;
	return action.href.replace('{me}', viewerId);
}
