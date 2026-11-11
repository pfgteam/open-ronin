'use client';

// Popover — a small anchored card for acting on ONE list item without
// leaving the list (status chip, link, note). See the surface-hierarchy
// table in the home-v2/detail-redesign design spec: Popover is for a few
// fields anchored to a row; ModalCard is for full create/edit forms;
// Drawer is being retired as a click target.
//
// Positioned with getBoundingClientRect + fixed coordinates (no positioning
// library, per the plan's "no new dependencies" rule) and rendered through
// a portal to document.body so it can escape any `overflow:hidden`/
// `overflow:auto` ancestor a list row happens to sit inside — the same
// reason NotificationBell's old inline-absolute version was fine (it wasn't
// inside a scroll container) but a popover anchored to a virtualized/
// scrolling list row would clip without this.
//
// No backdrop and no scroll lock, unlike ModalCard: a popover is a sidecar
// to the list, not a screen takeover, so the list stays visible and
// scrollable underneath. That does mean the popover can end up visually
// detached from its anchor if the page scrolls a lot before we reposition
// (see the scroll listener below) — acceptable because the same scroll also
// carries the anchor toward/away from the viewport edge the popover was
// avoiding.
//
// Escape and outside-click close it, matching ModalCard's Escape handling
// and the outside-click pattern NotificationBell/MultiSelectFilter used to
// hand-roll individually. Focus moves into the popover on open (first
// focusable child, same courtesy ModalCard pays edit forms) and is restored
// to the anchor element on close so keyboard users don't lose their place
// in the list.
//
// The portal has a real, disclosed cost: the panel's focusable children now
// sit at the end of `<body>` in tab order, not right after their trigger.
// Left alone, a keyboard user tabbing off the last field would land on
// whatever happens to be last in the document rather than the next control
// next to the trigger. Tab is trapped inside the panel while open (see the
// keydown handler below) specifically to close that gap — Escape and
// outside-click remain the only ways out, same as before.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
	open: boolean;
	onClose: () => void;
	/** Element the popover is anchored to. Re-anchoring while open (e.g. arrow-key selection moving to a different row) repositions on the next render. */
	anchorRef: React.RefObject<HTMLElement | null>;
	placement?: 'bottom-start' | 'bottom-end';
	/** Tailwind width class, e.g. 'w-80'. Defaults to 'w-72'. */
	width?: string;
	children: React.ReactNode;
}

interface Coords {
	top: number;
	left: number;
}

// Keeps the popover fully inside the viewport: flips above the anchor when
// there isn't room below, and clamps left/right so it never overflows the
// window's edges.
//
// The very first computation has nothing to measure — the panel isn't in the
// DOM until `coords` exists — so it runs against ESTIMATED_HEIGHT. That
// estimate is WRONG for any panel taller than it (TaskQuickPopover with its
// due-date field is one), and a wrong height corrupts both the flip test and
// the bottom clamp below: a trigger low in the viewport gets a panel clipped
// off the bottom edge. The post-mount re-measure effect (see "Re-measure once
// the panel is really in the DOM" below) is what replaces the estimate with
// the panel's true offsetHeight; without it the first, blind guess would
// stand until an unrelated scroll or resize happened to recompute.
const ESTIMATED_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

function computeCoords(
	anchor: HTMLElement,
	panel: HTMLElement | null,
	placement: 'bottom-start' | 'bottom-end',
	widthPx: number,
): Coords {
	const rect = anchor.getBoundingClientRect();
	const panelHeight = panel?.offsetHeight || ESTIMATED_HEIGHT;
	const panelWidth = panel?.offsetWidth || widthPx;

	// Vertical: prefer below the anchor; flip above it if there isn't room
	// and there IS room above (a trigger near the bottom of the viewport).
	const spaceBelow = window.innerHeight - rect.bottom;
	const spaceAbove = rect.top;
	let top: number;
	if (spaceBelow >= panelHeight + VIEWPORT_MARGIN || spaceBelow >= spaceAbove) {
		top = rect.bottom + 4;
	} else {
		top = rect.top - panelHeight - 4;
	}
	// Clamp so a very tall popover never runs off the top/bottom edge.
	top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - panelHeight - VIEWPORT_MARGIN);

	// Horizontal: bottom-start aligns left edges, bottom-end aligns right
	// edges; either way, clamp into the viewport (the right-edge trigger
	// case) rather than letting the card overflow.
	let left = placement === 'bottom-end' ? rect.right - panelWidth : rect.left;
	left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - panelWidth - VIEWPORT_MARGIN);

	return { top, left };
}

const WIDTH_PX: Record<string, number> = {
	'w-56': 224,
	'w-64': 256,
	'w-72': 288,
	'w-80': 320,
	'w-96': 384,
};

// Shared with the focus-on-open effect below: what counts as "focusable"
// inside the panel. Kept broader than ModalCard's (which only looks for
// form fields) because a popover is as likely to open on a list of buttons/
// checkboxes as on a form.
//
// `:not([disabled])` on every element that can carry the attribute: a
// disabled control still matches a bare `button`/`input`/`select`/
// `textarea` selector but can't actually receive focus, so `.focus()` on it
// is a silent no-op — and inside the Tab trap below that means the cycle
// dead-stops instead of wrapping. Task 8 puts a Save button that's disabled
// mid-save inside this panel, so this isn't hypothetical. `a[href]` and the
// `[tabindex]` clause are left alone: anchors have no `disabled` attribute.
const FOCUSABLE_SELECTOR =
	'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Popover({
	open,
	onClose,
	anchorRef,
	placement = 'bottom-start',
	width = 'w-72',
	children,
}: PopoverProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [coords, setCoords] = useState<Coords | null>(null);

	// Reposition on open, and whenever the anchor itself changes identity
	// (Task 9 moves selection with arrow keys while staying open — the
	// anchorRef's current element changes but `open` doesn't retoggle).
	// A layout effect so the panel is measured and placed before paint,
	// avoiding a visible jump from the estimated to the real position.
	useLayoutEffect(() => {
		if (!open) return;
		const anchor = anchorRef.current;
		if (!anchor) return;
		setCoords(computeCoords(anchor, panelRef.current, placement, WIDTH_PX[width] ?? 288));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, anchorRef.current, placement, width]);

	// Re-measure once the panel is really in the DOM. The effect above ran
	// with panelRef.current === null (nothing renders until `coords` is set),
	// so it placed the panel using ESTIMATED_HEIGHT; its own deps don't change
	// when `coords` lands, so it never runs again. This one does, with the
	// panel's true height — which is what keeps a tall popover anchored to a
	// low row from being clipped off the bottom of the viewport. The equality
	// guard is load-bearing: without it, setting coords re-triggers this
	// effect forever.
	useLayoutEffect(() => {
		if (!open || !coords) return;
		const anchor = anchorRef.current;
		const panel = panelRef.current;
		if (!anchor || !panel) return;
		const next = computeCoords(anchor, panel, placement, WIDTH_PX[width] ?? 288);
		if (next.top !== coords.top || next.left !== coords.left) setCoords(next);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, coords, placement, width]);

	// Keep the popover glued to its anchor while the page scrolls or the
	// window resizes — otherwise it visually detaches from the row it's
	// supposed to belong to.
	useEffect(() => {
		if (!open) return;
		function reposition() {
			const anchor = anchorRef.current;
			if (!anchor) return;
			setCoords(computeCoords(anchor, panelRef.current, placement, WIDTH_PX[width] ?? 288));
		}
		window.addEventListener('scroll', reposition, true);
		window.addEventListener('resize', reposition);
		return () => {
			window.removeEventListener('scroll', reposition, true);
			window.removeEventListener('resize', reposition);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, placement, width]);

	// Close on outside click / Escape, and trap Tab inside the panel while
	// open — listeners attached only while open, same as the private
	// versions this replaces in NotificationBell and MultiSelectFilter.
	//
	// The Tab trap exists because the panel is portaled to the end of
	// `<body>` (see the module comment above): without it, Tab from the
	// last focusable child would fall through to whatever element happens
	// to be last in the document instead of cycling back to the first
	// field, and Shift+Tab from the first would fall through to whatever
	// is last, rather than back to the anchor's neighbours. ModalCard
	// doesn't need this — it renders its dialog at the click site inside
	// normal document flow and only ever holds a handful of fields — but a
	// popover's content is about to be a small FORM (status chips, a link
	// field, a note field), so the cycle matters here.
	useEffect(() => {
		if (!open) return;
		function onClick(e: MouseEvent) {
			const anchor = anchorRef.current;
			const panel = panelRef.current;
			const target = e.target as Node;
			if (panel && panel.contains(target)) return;
			if (anchor && anchor.contains(target)) return;
			onClose();
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				onClose();
				return;
			}
			if (e.key !== 'Tab') return;
			const panel = panelRef.current;
			if (!panel) return;
			const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
		document.addEventListener('mousedown', onClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onClick);
			document.removeEventListener('keydown', onKey);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, onClose]);

	// Focus in on open, restore to the anchor on close — the same courtesy
	// ModalCard pays edit forms, so keyboard users don't lose their place
	// in the list behind the popover.
	useEffect(() => {
		if (!open) return;
		const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
		first?.focus();
		const anchorAtOpen = anchorRef.current;
		return () => {
			anchorAtOpen?.focus();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	if (!open || !coords) return null;

	return createPortal(
		<div
			ref={panelRef}
			role="dialog"
			aria-modal="false"
			style={{ position: 'fixed', top: coords.top, left: coords.left }}
			className={`${width} bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-panel z-[60]`}
		>
			{children}
		</div>,
		document.body,
	);
}
