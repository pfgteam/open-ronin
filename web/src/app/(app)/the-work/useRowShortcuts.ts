'use client';

// Keyboard shortcuts shared across The Work's list views (Priorities,
// Client Work, My Work) and the Overview detail page — per Sam
// 2026-08-10:
//   C  create a new item (where the view has a create action)
//   E  edit the row currently under the mouse
//   A  edit the row under the mouse, cursor landing on Owner (assignee)
//   S  edit the row under the mouse, cursor landing on Status
//   /  focus this view's name search box
//   ?  open the shortcuts help modal (ShortcutsHelpModal) — discoverability
//      for the above, same "press ? for help" convention as Linear/Gmail/
//      Superhuman (chosen over a persistent hint bar or header button).
//
// There's no arrow-key row selection in The Work yet, so "the row under the
// mouse" (tracked via onMouseEnter on each <tr>) stands in for a selection —
// same lightweight pattern several list apps use before building real
// keyboard navigation. Shortcuts are ignored while typing in any input/
// textarea/select so they never fight with normal typing, and while a
// modifier key is held so they don't collide with browser/OS shortcuts.
// (Shift is deliberately not treated as a blocking modifier — '?' is
// Shift+/ on a US layout, and e.key reports it as '?' either way.)

import { useEffect } from 'react';

interface Options {
	hoveredId: string | null;
	onCreate?: () => void;
	onEdit?: (id: string) => void;
	onAssign?: (id: string) => void;
	onStatus?: (id: string) => void;
	onFocusSearch?: () => void;
	onHelp?: () => void;
	enabled?: boolean;
}

function isTypingTarget(el: Element | null): boolean {
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useRowShortcuts({ hoveredId, onCreate, onEdit, onAssign, onStatus, onFocusSearch, onHelp, enabled = true }: Options) {
	useEffect(() => {
		if (!enabled) return;

		function onKeyDown(e: KeyboardEvent) {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (isTypingTarget(document.activeElement)) return;

			switch (e.key) {
				case 'c': case 'C':
					if (onCreate) { e.preventDefault(); onCreate(); }
					break;
				case 'e': case 'E':
					if (onEdit && hoveredId) { e.preventDefault(); onEdit(hoveredId); }
					break;
				case 'a': case 'A':
					if (onAssign && hoveredId) { e.preventDefault(); onAssign(hoveredId); }
					break;
				case 's': case 'S':
					if (onStatus && hoveredId) { e.preventDefault(); onStatus(hoveredId); }
					break;
				case '/':
					if (onFocusSearch) { e.preventDefault(); onFocusSearch(); }
					break;
				case '?':
					if (onHelp) { e.preventDefault(); onHelp(); }
					break;
				default:
					break;
			}
		}

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [enabled, hoveredId, onCreate, onEdit, onAssign, onStatus, onFocusSearch, onHelp]);
}
