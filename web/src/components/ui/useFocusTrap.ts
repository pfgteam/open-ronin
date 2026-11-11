'use client';

// Keep Tab / Shift+Tab inside a dialog while it is open (WCAG 2.4.3). Focus
// moves to the first focusable child on open and back to the previously
// focused element on close. Popovers inside the dialog are portalled to
// <body>, so they are outside `ref`; they manage their own focus.

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, opts: { autoFocus?: boolean } = {}) {
	useEffect(() => {
		if (!active) return;
		const root = ref.current;
		if (!root) return;
		const previous = document.activeElement as HTMLElement | null;
		if (opts.autoFocus !== false) {
			const first = root.querySelector<HTMLElement>(FOCUSABLE);
			if (first && !root.contains(document.activeElement)) first.focus();
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') return;
			const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
			if (!items.length) return;
			const first = items[0], last = items[items.length - 1];
			const current = document.activeElement as HTMLElement | null;
			// Focus is in a portalled popover (outside root): leave it alone.
			if (current && !root.contains(current)) return;
			if (e.shiftKey && (current === first || !current)) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus(); }
		};
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('keydown', onKey);
			previous?.focus?.();
		};
	}, [ref, active, opts.autoFocus]);
}
