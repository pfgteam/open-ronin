'use client';

// Dialog — the ModalCard look driven by state instead of the URL: edit forms
// and confirmations (Admin → Prospects, the deal page's Closing tab). ESC and the backdrop
// close it; focus moves to the first field on open, Tab stays inside, the
// page behind does not scroll, and focus returns to the opener on close.

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { isTopDialog, popDialog, pushDialog, trapTab } from './dialogStack';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({ open, onClose, title, subtitle, children, footer, maxWidth = 'max-w-2xl' }: {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: string;
	children: React.ReactNode;
	footer?: React.ReactNode;
	maxWidth?: string;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		if (!open) return;
		const id = pushDialog();
		const opener = document.activeElement as HTMLElement | null;
		// LIFO with nested dialogs: the inner one saves and restores "hidden", the outer the original.
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		// Only the innermost dialog reacts to ESC (a confirmation inside an edit dialog must not close both).
		const onKey = (e: KeyboardEvent) => {
			if (!isTopDialog(id)) return;
			if (e.key === 'Escape') closeRef.current();
			else if (e.key === 'Tab' && panelRef.current) {
				const els = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
				const next = trapTab(els.length, els.indexOf(document.activeElement as HTMLElement), e.shiftKey);
				if (next !== null) {
					e.preventDefault();
					els[next].focus();
				}
			}
		};
		window.addEventListener('keydown', onKey);
		const first = panelRef.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[data-autofocus]');
		first?.focus();
		return () => {
			window.removeEventListener('keydown', onKey);
			popDialog(id);
			document.body.style.overflow = prevOverflow;
			if (opener?.isConnected) opener.focus();
		};
	}, [open]);
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
			<div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
			<div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className={`relative my-auto w-full ${maxWidth} rounded-lg border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-800`}>
				<div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
					<div className="min-w-0">
						<h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
						{subtitle && <p className="mt-0.5 text-2xs text-slate-600 dark:text-slate-400">{subtitle}</p>}
					</div>
					<button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-hover hover:text-slate-700 dark:hover:text-slate-200">
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="px-5 py-4">{children}</div>
				{footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">{footer}</div>}
			</div>
		</div>
	);
}
