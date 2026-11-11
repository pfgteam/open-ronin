'use client';

// Keyboard-shortcuts cheat sheet, opened by pressing '?' (see
// useRowShortcuts's onHelp) — per Sam 2026-08-10: users had no way to
// know C/E/A/S/​/ exist. Chosen over a persistent hint bar or a header
// button so it doesn't take up permanent screen space; each view passes its
// own `items` since not every view supports every shortcut (My Work has no
// create action, the Overview page has no list to search).

import { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ShortcutItem {
	keys: string;
	label: string;
}

interface Props {
	open: boolean;
	onClose: () => void;
	items: ShortcutItem[];
	title?: string;
}

export default function ShortcutsHelpModal({ open, onClose, items, title = 'Keyboard shortcuts' }: Props) {
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
			<div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-panel w-full max-w-sm">
				<div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
					<button
						onClick={onClose}
						className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
					 aria-label="Close">
						<X className="w-4 h-4" />
					</button>
				</div>
				<ul className="p-4 space-y-2.5">
					{items.map((it) => (
						<li key={it.keys} className="flex items-center justify-between gap-3 text-sm">
							<span className="text-slate-600 dark:text-slate-400">{it.label}</span>
							<kbd className="text-2xs font-mono px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
								{it.keys}
							</kbd>
						</li>
					))}
				</ul>
				<div className="px-4 pb-4 text-2xs text-slate-600 dark:text-slate-400">
					Row shortcuts (E/A/S) act on whichever row your mouse is over — it&apos;s highlighted while you hover.
					Press <kbd className="font-mono px-1 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">?</kbd> anytime to see this again.
				</div>
			</div>
		</div>
	);
}
