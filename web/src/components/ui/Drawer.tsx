'use client';

// Drawer — the one side panel (style guide phase 1, rework §5.3). Sticky
// header, the body scrolls as one (no scroll trap inside a scroll trap),
// ESC and the scrim close it, focus moves in on open and back to the opener
// on close, Tab stays inside. Layer z-30 per the z scale (drawers sit under
// chrome z-40 and overlays z-50); `modal` raises it to z-50 for a drawer
// opened from inside an overlay.

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { isTopDialog, popDialog, pushDialog, trapTab } from './dialogStack';
import IconButton from './IconButton';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DrawerProps {
	open: boolean;
	onClose: () => void;
	/** Accessible name. */
	label: string;
	/** Header content (title, pickers). Defaults to the label as a heading. */
	header?: React.ReactNode;
	/** Right side of the header, before the close button. */
	actions?: React.ReactNode;
	/** Under the header, still sticky (tabs). */
	subheader?: React.ReactNode;
	children: React.ReactNode;
	footer?: React.ReactNode;
	width?: 'md' | 'lg' | 'xl';
	modal?: boolean;
}

const WIDTHS = { md: 'max-w-[480px]', lg: 'max-w-[640px]', xl: 'max-w-[820px]' };

export default function Drawer({ open, onClose, label, header, actions, subheader, children, footer, width = 'lg', modal = false }: DrawerProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const id = pushDialog();
		const opener = document.activeElement as HTMLElement | null;
		const onKey = (e: KeyboardEvent) => {
			if (!isTopDialog(id)) return;
			if (e.key === 'Escape') {
				// A popover inside the drawer is its own role=dialog and closes first.
				if (document.querySelectorAll('[data-popover-open="true"]').length) return;
				closeRef.current();
			} else if (e.key === 'Tab' && panelRef.current) {
				const els = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
				const next = trapTab(els.length, els.indexOf(document.activeElement as HTMLElement), e.shiftKey);
				if (next !== null) { e.preventDefault(); els[next].focus(); }
			}
		};
		window.addEventListener('keydown', onKey);
		panelRef.current?.focus();
		return () => {
			window.removeEventListener('keydown', onKey);
			popDialog(id);
			if (opener?.isConnected) opener.focus();
		};
	}, [open]);

	if (!open) return null;
	return (
		<div className={clsx('fixed inset-0 flex justify-end', modal ? 'z-50' : 'z-30')} role="presentation">
			<div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
			<div
				ref={panelRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className={clsx('relative flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-panel outline-none dark:border-slate-700 dark:bg-slate-800', WIDTHS[width])}
			>
				<div className="shrink-0 border-b border-slate-200 dark:border-slate-700">
					<div className="flex items-start gap-2 px-5 py-3">
						<div className="min-w-0 flex-1">{header ?? <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{label}</h2>}</div>
						{actions}
						<IconButton aria-label="Close" onClick={onClose} bordered={false}><X className="h-4 w-4" aria-hidden="true" /></IconButton>
					</div>
					{subheader}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
				{footer && <div className="shrink-0 border-t border-slate-200 px-5 py-3 dark:border-slate-700">{footer}</div>}
			</div>
		</div>
	);
}
