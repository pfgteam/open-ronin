'use client';

// Details (spec 2026-10-20 §4.3): scoring, GHL sync, lane history, source and
// dates, collapsed by default and visible to everyone. Whether it is open is a
// per-viewer convenience in localStorage, read after mount (no hydration
// mismatch) and ignored when storage is unavailable.

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const KEY = 'deal.details.open';

export default function DetailsSection({ children }: { children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		try {
			if (window.localStorage.getItem(KEY) === '1') setOpen(true);
		} catch {
			// Private mode or blocked storage: stay collapsed.
		}
	}, []);
	const toggle = () => {
		const next = !open;
		setOpen(next);
		try {
			window.localStorage.setItem(KEY, next ? '1' : '0');
		} catch {
			// Not remembered; the toggle still works.
		}
	};
	return (
		<section className="space-y-3">
			<button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 py-2 text-left text-xs text-slate-600 hover:bg-hover dark:border-slate-600 dark:text-slate-400">
				{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
				<span className="font-medium text-slate-800 dark:text-slate-200">Details</span>
				<span>· scoring, GHL sync, lane history, source</span>
			</button>
			{open && <div className="space-y-4">{children}</div>}
		</section>
	);
}
