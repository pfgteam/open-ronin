'use client';

// ModalCard — a centred card over the screen, for edit/create forms that used
// to render inline in the page flow (Sam, 19/08/2026: "ao clicar para
// editar uma métrica e/ou uma posição, deve-se abrir um card para edição sobre
// a tela").
//
// The open/closed state stays in the URL (?edit=… / ?new=1), which is what the
// admin catalogs already used: the forms keep posting to the same server
// actions, the modal is deep-linkable, and nothing had to be re-plumbed into
// client state. Cost of that choice: opening costs one soft navigation, so the
// modal appears a beat after the click instead of instantly — fine on an admin
// screen, and worth the simplicity.
//
// Closing uses router.replace so the modal doesn't pile up history entries,
// and scroll: false so the list underneath doesn't jump to the top.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export default function ModalCard({
	title,
	subtitle,
	closeHref,
	children,
	maxWidth = 'max-w-2xl',
}: {
	title: string;
	subtitle?: string;
	/** Where to go when the modal closes — the list route without the edit param. */
	closeHref: string;
	children: React.ReactNode;
	maxWidth?: string;
}) {
	const router = useRouter();
	const panelRef = useRef<HTMLDivElement>(null);

	const close = () => router.replace(closeHref, { scroll: false });

	// ESC closes, matching WorkItemDrawer.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') close();
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [closeHref]);

	// Move focus into the panel so the form is immediately keyboard-usable.
	useEffect(() => {
		const first = panelRef.current?.querySelector<HTMLElement>(
			'input:not([type=hidden]), select, textarea',
		);
		first?.focus();
	}, []);

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
			<div
				className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]"
				onClick={close}
				aria-hidden="true"
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className={`relative w-full ${maxWidth} bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-panel my-auto`}
			>
				<div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
					<div className="min-w-0">
						<h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
						{subtitle && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">{subtitle}</p>}
					</div>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="px-5 py-4">{children}</div>
			</div>
		</div>
	);
}
