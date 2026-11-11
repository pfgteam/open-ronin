// The two focus recipes. Every focusable thing uses exactly one of them.
//
// FIELD — text inputs, selects, textareas: the bordered controls. Focus shows
// as a solid 2px primary-500 ring over a primary-500 border: ~3.3:1 on the
// white card, ~5.6:1 for primary-400 on the dark card. The reskin's 3px
// primary-50 halo was ~1.05:1, i.e. invisible (WCAG 2.4.7 / 1.4.11), and
// ring-1 is banned by scripts/ui-audit.sh. An errored field keeps a red ring
// while focused instead of turning teal, so the error cue survives typing.
//
// CONTROL — buttons, pills, cells, links styled as buttons: anything without
// a resting border. `focus-visible` so mouse clicks don't paint a ring.
// Never put the FIELD recipe on a borderless element: there is no border to
// recolour and the ring is the only cue.

export const fieldFocus =
	'focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400';

export const fieldFocusError =
	'focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500 dark:focus:border-red-400 dark:focus:ring-red-400';

export const controlFocus =
	'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800';
